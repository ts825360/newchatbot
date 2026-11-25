// @vitest-environment node
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {createDatabase} from "@/lib/server/database";
import type {DatabaseSync} from "node:sqlite";
import {syncAllGoogleExports,syncGoogleExports,exportStatus,eventExportStatus} from "@/lib/server/google-export";
const fake=vi.hoisted(()=>({request:vi.fn(),assert:vi.fn(),save:vi.fn()}));
vi.mock("@/lib/server/google-calendar",()=>({getGoogleExportConnection:()=>({client:{request:fake.request},accountHash:"google-account",assertCurrent:fake.assert,save:fake.save})}));
let db:DatabaseSync;
const actor={id:"manager",name:"Test",username:"manager",grade:2 as const,role:"manager",permissions:["viewRoom","viewCalendar","manageMembers"] as any,accessExpiresAt:null,sessionVersion:0};
function events(items:any[]){db.prepare("INSERT INTO records(key,room_id,kind,data_json,updated_at) VALUES('preparation:room:events','room','events',?,?) ON CONFLICT(key) DO UPDATE SET data_json=excluded.data_json").run(JSON.stringify({version:1,items}),new Date().toISOString());}
const event={id:"event",title:"준비 회의",date:"2026-12-01",time:"오후 7:00",location:"배재대학교",memo:"",status:"confirmed",author:"Test",lastEditor:"Test",changeLog:""};
beforeEach(()=>{
  db=createDatabase(":memory:");
  db.prepare("INSERT INTO users(id,name,username,grade,role,permissions_json,salt,password_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run(actor.id,actor.name,actor.username,2,"manager",JSON.stringify(actor.permissions),"x","x",new Date().toISOString());
  db.prepare("INSERT INTO rooms(id,data_json) VALUES('room',?)").run(JSON.stringify({id:"room",name:"수련회",location:"배재대학교"}));
  fake.assert.mockReset();fake.save.mockReset();fake.request.mockReset().mockImplementation(async(options:any)=>{
    if(options.url.endsWith('/calendars'))return {data:{id:"app-calendar"}};
    return {data:{id:options.data?.id}};
  });
});
afterEach(()=>db.close());
describe("website authoritative outbound Google calendar",()=>{
  it("queues export for a connected grade 3 member without member management", async () => {
    const member = { ...actor, id: "member", username: "member", grade: 3 as const, permissions: ["viewRoom", "viewCalendar"] as typeof actor.permissions };
    db.prepare("INSERT INTO users(id,name,username,grade,role,permissions_json,salt,password_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(member.id,member.name,member.username,member.grade,member.role,JSON.stringify(member.permissions),"x","x",new Date().toISOString());
    db.prepare("INSERT INTO google_connections(user_id,credentials,updated_at) VALUES(?,?,?)").run(member.id,"fixture",new Date().toISOString());
    events([event]);
    await syncAllGoogleExports(db);
    expect(exportStatus(member,db)).toMatchObject({pending:0,synced:1});
    expect(exportStatus(actor,db)).toMatchObject({pending:1,synced:0});
  });
  it("exports only confirmed entries to an app-created calendar and never lists personal events",async()=>{
    events([event,{...event,id:"candidate",status:"needsReview"}]);
    await syncGoogleExports(actor,db);
    expect(fake.request).toHaveBeenCalledWith(expect.objectContaining({method:"POST",url:"https://www.googleapis.com/calendar/v3/calendars",data:expect.objectContaining({summary:"교회 행사"})}));
    const eventCall=fake.request.mock.calls.map(c=>c[0]).find(o=>o.url.includes('/events'));
    expect(eventCall.url).toContain('/calendars/app-calendar/events');
    expect(eventCall.data).toMatchObject({summary:"[수련회] 준비 회의",start:{dateTime:"2026-12-01T19:00:00+09:00"},end:{dateTime:"2026-12-01T10:01:00.000Z"},reminders:{useDefault:true}});
    expect(eventCall.data).not.toHaveProperty("endTimeUnspecified");
    expect(fake.request.mock.calls.some(c=>c[0].method==='GET')).toBe(false);
    expect(exportStatus(actor,db)).toMatchObject({pending:0,synced:1});
  });
  it("reports saved, pending and failed independently of other events and hides raw provider errors", async () => {
    events([event,{...event,id:"candidate",status:"needsReview"}]);
    expect(eventExportStatus(actor,"room","candidate",db)).toEqual({state:"notScheduled"});
    expect(eventExportStatus(actor,"room","event",db)).toEqual({state:"pending"});
    fake.request.mockImplementation(async (o:any) => {
      if(o.url.endsWith("/calendars"))return {data:{id:"app-calendar"}};
      throw {response:{status:400,data:{error:{message:"private provider string"}}}};
    });
    await syncGoogleExports(actor,db);
    expect(eventExportStatus(actor,"room","event",db)).toEqual({state:"failed",error:expect.stringContaining("400")});
    expect(JSON.stringify(eventExportStatus(actor,"room","event",db))).not.toContain("private provider string");
    fake.request.mockResolvedValue({data:{}});
    await syncGoogleExports(actor,db);
    expect(eventExportStatus(actor,"room","event",db)).toEqual({state:"synced"});
  });
  it("exports older unspecified times as all-day events",async()=>{
    events([{...event,time:"미정"}]);
    await syncGoogleExports(actor,db);
    expect(fake.request).toHaveBeenCalledWith(expect.objectContaining({method:"POST",data:expect.objectContaining({start:{date:event.date},end:{date:"2026-12-02"}})}));
    expect(exportStatus(actor,db).pending).toBe(0);
  });
  it("exports new default and explicit ranges, including a one-hour range across midnight",async()=>{
    events([
      {...event,id:"default",time:"",endTime:""},
      {...event,id:"midnight",time:"23:30",endTime:""},
      {...event,id:"explicit",time:"09:00",endTime:"11:30"},
      {...event,id:"on-hold",status:"pending",endTime:""},
      {...event,id:"other",status:"other",endTime:""}
    ]);
    await syncGoogleExports(actor,db);
    const sent=fake.request.mock.calls.map(([request])=>request).filter(request=>request.url.endsWith("/events"));
    expect(sent.map(request=>[request.data.start.dateTime,request.data.end.dateTime])).toEqual([
      ["2026-12-01T00:00:00+09:00","2026-12-01T22:00:00+09:00"],
      ["2026-12-01T23:30:00+09:00","2026-12-02T00:30:00+09:00"],
      ["2026-12-01T09:00:00+09:00","2026-12-01T11:30:00+09:00"]
    ]);
  });
  it("reuses event identity for edits and removes only tracked events on cancellation",async()=>{
    events([event]);await syncGoogleExports(actor,db);const row=db.prepare("SELECT remote_id FROM google_exports").get()!;
    fake.request.mockClear();events([{...event,title:"수정 회의",endTime:"20:30"}]);await syncGoogleExports(actor,db);
    expect(fake.request).toHaveBeenCalledWith(expect.objectContaining({method:"PATCH",url:expect.stringContaining(String(row.remote_id))}));
    expect(fake.request.mock.calls[0][0].data.end.dateTime).toBe("2026-12-01T20:30:00+09:00");
    expect(fake.request.mock.calls[0][0].data).not.toHaveProperty("reminders");
    expect(fake.request.mock.calls[0][0].data).not.toHaveProperty("attendees");
    expect(fake.request.mock.calls[0][0].data).not.toHaveProperty("recurrence");
    fake.request.mockClear();events([]);await syncGoogleExports(actor,db);
    expect(fake.request).toHaveBeenCalledWith(expect.objectContaining({method:"DELETE",url:expect.stringContaining(String(row.remote_id))}));
  });
  it("keeps an uncertain event insert retryable with the same remote ID",async()=>{
    events([event]);fake.request.mockImplementation(async(o:any)=>{if(o.url.endsWith('/calendars'))return {data:{id:'app-calendar'}};throw new Error('secret-token-not-printed');});
    await syncGoogleExports(actor,db);const first=db.prepare("SELECT remote_id FROM google_exports").get()!;
    expect(exportStatus(actor,db)).toMatchObject({pending:1});
    fake.request.mockResolvedValue({data:{}});await syncGoogleExports(actor,db);
    expect(db.prepare("SELECT remote_id FROM google_exports").get()!.remote_id).toBe(first.remote_id);
    expect(exportStatus(actor,db)).toMatchObject({pending:0});
    expect(JSON.stringify(exportStatus(actor,db))).not.toContain('secret-token');
  });
  it("does not blindly create a duplicate calendar after an uncertain create response",async()=>{
    events([event]);fake.request.mockRejectedValue(new Error('timeout'));await syncGoogleExports(actor,db);await syncGoogleExports(actor,db);
    expect(fake.request).toHaveBeenCalledTimes(1);
    expect(exportStatus(actor,db).error).toMatch(/생성|확인/);
  });
  it("does not invent an ambiguous time or export unconfirmed private text",async()=>{
    events([{...event,time:"저녁쯤"}]);await syncGoogleExports(actor,db);
    expect(fake.request.mock.calls.some(c=>c[0].url.includes('/events'))).toBe(false);
    expect(exportStatus(actor,db).pending).toBe(1);
  });
  it("skips external calls when the authoritative snapshot is already exported",async()=>{
    events([event]);await syncGoogleExports(actor,db);fake.request.mockClear();await syncGoogleExports(actor,db);
    expect(fake.request).not.toHaveBeenCalled();
  });
  it("reconciles a successful but unacknowledged insert via update on retry",async()=>{
    events([event]);let created=false;
    fake.request.mockImplementation(async(o:any)=>{
      if(o.url.endsWith('/calendars'))return {data:{id:'app-calendar'}};
      if(o.method==='POST'){created=true;throw new Error('timeout');}
      if(o.method==='PATCH'&&created)return {data:{}};
      throw new Error('unexpected operation');
    });
    await syncGoogleExports(actor,db);await syncGoogleExports(actor,db);
    expect(fake.request.mock.calls.filter(c=>c[0].url.endsWith('/events')&&c[0].method==='POST')).toHaveLength(1);
    expect(exportStatus(actor,db).pending).toBe(0);
  });
  it("does not retry an export after the event is no longer confirmed", async () => {
    events([event]);
    fake.request.mockImplementation(async (o: any) => {
      if (o.url.endsWith("/calendars")) return { data: { id: "app-calendar" } };
      if (o.method === "POST") {
        events([{ ...event, status: "needsReview" }]);
        throw { response: { status: 409 } };
      }
      return { data: {} };
    });
    await syncGoogleExports(actor, db);
    expect(fake.request.mock.calls.map(([o]) => o.method)).toEqual(["POST", "POST"]);
  });
  it("re-exports a reconfirmed entry after an unacknowledged remote deletion",async()=>{
    events([event]);await syncGoogleExports(actor,db);
    const original=db.prepare("SELECT remote_id FROM google_exports").get()!.remote_id;
    events([]);fake.request.mockRejectedValueOnce(new Error('delete response timeout'));await syncGoogleExports(actor,db);
    events([event]);expect(exportStatus(actor,db).pending).toBe(1);
    fake.request.mockImplementation(async(o:any)=>{if(o.method==='PATCH')throw {response:{status:410}};return {data:{}};});
    await syncGoogleExports(actor,db);
    expect(exportStatus(actor,db).pending).toBe(0);
    expect(db.prepare("SELECT remote_id FROM google_exports").get()!.remote_id).not.toBe(original);
  });
  it("retains deletion uncertainty across a failed reconfirmation attempt",async()=>{
    events([event]);await syncGoogleExports(actor,db);
    const original=String(db.prepare("SELECT remote_id FROM google_exports").get()!.remote_id);
    events([]);fake.request.mockRejectedValueOnce(new Error('lost delete'));await syncGoogleExports(actor,db);
    events([event]);fake.request.mockRejectedValueOnce(new Error('lost update'));await syncGoogleExports(actor,db);
    fake.request.mockImplementation(async(o:any)=>{
      if(o.method==='PATCH')throw {response:{status:404}};
      if(o.data?.id===original)throw {response:{status:409}};
      return {data:{}};
    });
    await syncGoogleExports(actor,db);
    expect(exportStatus(actor,db).pending).toBe(0);
    expect(db.prepare("SELECT remote_id FROM google_exports").get()!.remote_id).not.toBe(original);
  });
});
