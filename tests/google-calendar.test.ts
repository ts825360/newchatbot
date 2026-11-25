// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "@/lib/server/database";
import type { DatabaseSync } from "node:sqlite";
import type { Actor } from "@/lib/server/auth";
import { createHash } from "node:crypto";
import { getDatabase } from "@/lib/server/database";
import { GET, POST } from "@/app/api/integrations/google/[action]/route";
import { GET as callback } from "@/app/api/integrations/google/callback/route";
import { POST as formSettingsAction } from "@/app/api/integrations/google-forms/route";
import { startGoogle, finishGoogle, readGoogleEvents, googleStatus, disconnectGoogle, getGoogleExportConnection } from "@/lib/server/google-calendar";
import { disconnectGoogleForms, finishGoogleForms, googleFormsStatus, previewConversationGoogleForm, startGoogleForms } from "@/lib/server/google-forms";

const mocks = vi.hoisted(() => ({ exchange: vi.fn(), request: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/server/database", async original => ({...await original<typeof import("@/lib/server/database")>(),getDatabase:vi.fn()}));
vi.mock("next/server",()=>({after:vi.fn()}));
vi.mock("google-auth-library", () => ({ CodeChallengeMethod: { S256: "S256" }, OAuth2Client: class {
  credentials: Record<string, unknown> = {};
  generateCodeVerifierAsync = async () => ({ codeVerifier: "private-verifier", codeChallenge: "challenge" });
  generateAuthUrl = (options: Record<string, string>) => { mocks.auth(options); return "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams(options); };
  getToken = mocks.exchange;
  verifyIdToken = async()=>({getPayload:()=>({sub:"verified-google-subject"})});
  setCredentials(value: Record<string, unknown>) { this.credentials = value; }
  request = mocks.request;
} }));
let db: DatabaseSync;
const actor: Actor = { id:"manager", name:"Test", username:"manager", grade:2, role:"manager", permissions:["viewRoom","viewCalendar","manageMembers"], accessExpiresAt:null, sessionVersion:0 };
const session = "test-session-digest";
beforeEach(() => {
  vi.stubEnv("APP_BASE_URL", "http://127.0.0.1:3001"); vi.stubEnv("GOOGLE_OAUTH_REDIRECT_URI", "http://127.0.0.1:3001/api/integrations/google/callback");
  vi.stubEnv("GOOGLE_CLIENT_ID", "test-client"); vi.stubEnv("GOOGLE_CLIENT_SECRET", "private-server-client-secret"); vi.stubEnv("GOOGLE_CALENDAR_ID", "primary");
  db=createDatabase(":memory:");
  vi.mocked(getDatabase).mockReturnValue(db);
  db.prepare("INSERT INTO users(id,name,username,grade,role,permissions_json,salt,password_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run(actor.id,actor.name,actor.username,2,actor.role,JSON.stringify(actor.permissions),"unused","unused",new Date().toISOString());
  mocks.exchange.mockResolvedValue({ tokens:{ access_token:"private-access-token",refresh_token:"private-refresh-token",id_token:"private-id-token",scope:"openid https://www.googleapis.com/auth/calendar.app.created",expiry_date:Date.now()+3600000 } });
  mocks.request.mockResolvedValue({ data:{ items:[{ id:"event-1",summary:"Test event",start:{date:"2026-11-20"},end:{date:"2026-11-21"},description:"Not exposed",attendees:[{email:"not-exposed@example.com"}] }] } });
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.resetAllMocks(); });
const connect = async () => { const url=await startGoogle(actor,session,db); return new URL(url).searchParams.get("state")!; };
describe("separate read-only Google Forms authorization", () => {
  const editor: Actor = { ...actor, permissions: ["chat", "viewRoom", "editChecklist"] };
  const scope = { roomId: "fake-room", conversationId: "initial-fake-room", url: "https://docs.google.com/forms/d/mock_form01/edit" };
  const formsScopes = ["https://www.googleapis.com/auth/forms.body.readonly", "https://www.googleapis.com/auth/forms.responses.readonly"];
  it("cannot reuse calendar consent and binds form consent to one account/session", async () => {
    await finishGoogle(actor, session, await connect(), "code", db);
    expect(googleFormsStatus(editor, db).connected).toBe(false);
    const state = new URL(await startGoogleForms(editor, session, db)).searchParams.get("state")!;
    expect(mocks.auth).toHaveBeenLastCalledWith(expect.objectContaining({ scope: formsScopes, code_challenge_method: "S256" }));
    await expect(finishGoogleForms(editor, "wrong-session", state, "code", vi.fn(), db)).rejects.toThrow();
    mocks.exchange.mockResolvedValueOnce({ tokens: { access_token: "fixture", refresh_token: "fixture-refresh", scope: formsScopes.join(" ") } });
    await finishGoogleForms(editor, session, state, "code", vi.fn(), db);
    await expect(finishGoogleForms(editor, session, state, "code", vi.fn(), db)).rejects.toThrow();
    expect(googleFormsStatus(editor, db).connected).toBe(true);
    expect(db.prepare("SELECT credentials FROM google_forms_auth").get()?.credentials).not.toContain("fixture-refresh");
    disconnectGoogleForms(editor, db);
    expect(googleFormsStatus(editor, db).connected).toBe(false);
    expect(googleStatus(actor, db).connected).toBe(true);
  });

  it("reads all bounded pages from the fixed provider only for an owned conversation", async () => {
    db.prepare("INSERT INTO rooms(id,data_json) VALUES (?,?)").run(scope.roomId, "{}");
    const state = new URL(await startGoogleForms(editor, session, db)).searchParams.get("state")!;
    mocks.exchange.mockResolvedValueOnce({ tokens: { access_token: "fixture", refresh_token: "fixture-refresh", scope: formsScopes.join(" ") } });
    await finishGoogleForms(editor, session, state, "code", vi.fn(), db);
    await expect(previewConversationGoogleForm(editor, { ...scope, conversationId: "other" }, vi.fn(), db)).rejects.toThrow();
    expect(mocks.request).not.toHaveBeenCalled();
    mocks.request.mockResolvedValueOnce({ data: { items: [
      { title: "참석 여부", questionItem: { question: { questionId: "a" } } },
      { title: "이름", questionItem: { question: { questionId: "b" } } }
    ] } }).mockResolvedValueOnce({ data: { nextPageToken: "next", responses: [{ responseId: "first" }] } })
      .mockResolvedValueOnce({ data: { responses: [{ responseId: "second" }] } });
    const { survey } = await previewConversationGoogleForm(editor, scope, vi.fn(), db);
    expect(survey?.data.rows).toHaveLength(2);
    expect(mocks.request).toHaveBeenLastCalledWith(expect.objectContaining({ url: "https://forms.googleapis.com/v1/forms/mock_form01/responses", params: { pageSize: 100, pageToken: "next" } }));
  });

  it("returns Forms OAuth to the connections settings without exposing callback parameters", async () => {
    db.prepare("UPDATE users SET permissions_json=? WHERE id=?").run(JSON.stringify(editor.permissions), editor.id);
    const token = "B".repeat(43);
    db.prepare("INSERT INTO sessions(token_hash,user_id,session_version,expires_at,created_at) VALUES(?,?,?,?,?)")
      .run(createHash("sha256").update(token).digest("hex"), editor.id, 0, new Date(Date.now()+3600000).toISOString(), new Date().toISOString());
    const headers = { cookie: `church_session=${token}`, "content-type": "application/json" };
    const start = () => formSettingsAction(new Request("http://127.0.0.1:3001/api/integrations/google-forms", {
      method: "POST", headers, body: JSON.stringify({ action: "connect" }),
    }));
    let state = new URL((await (await start()).json()).url).searchParams.get("state");
    const cancelled = await callback(new Request(`http://127.0.0.1:3001/api/integrations/google/callback?state=${state}&error=access_denied&error_description=secret-marker`, { headers }));
    expect(cancelled.status).toBe(303);
    expect(cancelled.headers.get("location")).toBe("/settings?section=connections&connection=forms&result=cancelled");
    expect(mocks.exchange).not.toHaveBeenCalled();
    state = new URL((await (await start()).json()).url).searchParams.get("state");
    mocks.exchange.mockResolvedValueOnce({ tokens: { access_token: "fixture", refresh_token: "fixture-refresh", scope: formsScopes.join(" ") } });
    const result = await callback(new Request(`http://127.0.0.1:3001/api/integrations/google/callback?state=${state}&code=test`, { headers }));
    expect(result.status).toBe(303);
    expect(result.headers.get("location")).toBe("/settings?section=connections&connection=forms&result=connected");
    expect(result.headers.get("referrer-policy")).toBe("no-referrer");
    expect(googleFormsStatus(editor, db).connected).toBe(true);
  });
});
describe("private outbound Google Calendar authorization", () => {
  it("requests app-created calendar access and verified identity with PKCE", async () => {
    const first=await connect(); const second=await connect(); expect(first).not.toBe(second); expect(first.length).toBeGreaterThan(40);
    expect(mocks.auth).toHaveBeenCalledWith(expect.objectContaining({ scope:["https://www.googleapis.com/auth/calendar.app.created","openid"],code_challenge_method:"S256",code_challenge:"challenge" }));
    expect(googleStatus(actor,db)).toMatchObject({ connected:false });
  });
  it("binds one-use state to the initiating account/session and expiration", async () => {
    const state=await connect();
    await expect(finishGoogle(actor,"other-session",state,"code",db)).rejects.toThrow(); expect(mocks.exchange).not.toHaveBeenCalled();
    await finishGoogle(actor,session,state,"code",db);
    await expect(finishGoogle(actor,session,state,"code",db)).rejects.toThrow();
    const old=await connect(); db.prepare("UPDATE google_oauth_attempts SET expires_at=0").run();
    await expect(finishGoogle(actor,session,old,"code",db)).rejects.toThrow();
  });
  it("encrypts credentials and exposes neither tokens nor private extra event fields", async () => {
    await finishGoogle(actor,session,await connect(),"code",db);
    const raw=JSON.stringify(db.prepare("SELECT * FROM google_connections").all());
    expect(raw).not.toContain("private-access-token"); expect(raw).not.toContain("private-refresh-token");
    await expect(readGoogleEvents(actor,db)).rejects.toThrow(/가져오기/);
    expect(JSON.stringify(googleStatus(actor,db))).not.toMatch(/private-access-token|private-refresh-token|not-exposed|description/);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(googleStatus({...actor,id:"another-manager"},db)).toMatchObject({ connected:false });
  });
  it("allows a grade 3 viewer to connect and export only with their own credentials", async () => {
    const member: Actor = { ...actor, id: "member", username: "member", grade: 3, permissions: ["viewRoom", "viewCalendar"] };
    db.prepare("INSERT INTO users(id,name,username,grade,role,permissions_json,salt,password_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(member.id,member.name,member.username,member.grade,member.role,JSON.stringify(member.permissions),"unused","unused",new Date().toISOString());
    const state = new URL(await startGoogle(member, session, db)).searchParams.get("state")!;
    await expect(finishGoogle(actor, session, state, "code", db)).rejects.toThrow();
    await finishGoogle(member, session, state, "code", db);
    expect(googleStatus(member, db).connected).toBe(true);
    expect(googleStatus(actor, db).connected).toBe(false);
    const connection = getGoogleExportConnection(member, db);
    expect(() => connection.assertCurrent()).not.toThrow();
    db.prepare("UPDATE users SET permissions_json=? WHERE id=?").run(JSON.stringify("viewCalendar"),member.id);
    expect(() => connection.assertCurrent()).toThrow(/권한/);
    db.prepare("UPDATE users SET suspended=1 WHERE id=?").run(member.id);
    expect(() => connection.assertCurrent()).toThrow(/변경/);
  });
  it("rejects insufficient permissions before contacting Google", async () => {
    await expect(startGoogle({...actor,permissions:[]},session,db)).rejects.toThrow();
    expect(mocks.auth).not.toHaveBeenCalled();
  });
  it("sanitizes provider errors and consumes state even when exchange fails", async () => {
    const state=await connect(); mocks.exchange.mockRejectedValue(new Error("private-server-client-secret private-access-token"));
    await expect(finishGoogle(actor,session,state,"code",db)).rejects.toThrow("구글 인증");
    mocks.exchange.mockResolvedValue({tokens:{access_token:"token"}});
    await expect(finishGoogle(actor,session,state,"code",db)).rejects.toThrow();
  });
  it("deletes local tokens without modifying any Google event", async () => {
    await finishGoogle(actor,session,await connect(),"code",db);
    disconnectGoogle(actor,db); expect(googleStatus(actor,db)).toMatchObject({connected:false});
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("preserves existing connection if consent grants insufficient scope", async()=>{
    await finishGoogle(actor,session,await connect(),"code",db);
    mocks.exchange.mockResolvedValue({tokens:{access_token:"bad",refresh_token:"bad",scope:"openid"}});
    await expect(finishGoogle(actor,session,await connect(),"code",db)).rejects.toThrow(/권한/);
    expect(googleStatus(actor,db).connected).toBe(true);
  });
  it("invalidates jobs acquired with old credentials while reconnect consent is pending",async()=>{
    await finishGoogle(actor,session,await connect(),"code",db);
    const state=await connect();let old:ReturnType<typeof getGoogleExportConnection>|undefined;
    mocks.exchange.mockImplementationOnce(async()=>{
      old=getGoogleExportConnection(actor,db);
      return {tokens:{access_token:"new-access",refresh_token:"new-refresh",id_token:"new-id",scope:"openid https://www.googleapis.com/auth/calendar.app.created"}};
    });
    await finishGoogle(actor,session,state,"code",db);
    expect(()=>old!.assertCurrent()).toThrow(/변경/);
  });
  it("does not recreate tokens after a disconnect while a request is in flight",async()=>{
    await finishGoogle(actor,session,await connect(),"code",db);
    const connection=getGoogleExportConnection(actor,db);disconnectGoogle(actor,db);
    expect(()=>connection.save()).toThrow(/변경/);
    expect(googleStatus(actor,db).connected).toBe(false);
  });
  it.each(["disconnect","new-attempt"])("rejects a callback invalidated during token exchange by %s",async(action)=>{
    const state=await connect();
    const tokens={access_token:"private-access-token",refresh_token:"private-refresh-token",id_token:"private-id-token",scope:"openid https://www.googleapis.com/auth/calendar.app.created"};
    mocks.exchange.mockImplementationOnce(async()=>{
      if(action==="disconnect") disconnectGoogle(actor,db); else await connect();
      return {tokens};
    });
    await expect(finishGoogle(actor,session,state,"code",db)).rejects.toThrow(/변경|취소|다시/);
    expect(googleStatus(actor,db).connected).toBe(false);
  });
  it("serves authenticated route status and denies anonymous or cross-site access",async()=>{
    const token="A".repeat(43);
    db.prepare("INSERT INTO sessions(token_hash,user_id,session_version,expires_at,created_at) VALUES(?,?,?,?,?)").run(createHash("sha256").update(token).digest("hex"),actor.id,0,new Date(Date.now()+3600000).toISOString(),new Date().toISOString());
    const url="http://127.0.0.1:3001/api/integrations/google/status";
    const context={params:Promise.resolve({action:"status"})};
    expect((await GET(new Request(url),context)).status).toBe(401);
    const headers={cookie:`church_session=${token}`};
    expect((await GET(new Request(url,{headers}),context)).status).toBe(200);
    const cross=await POST(new Request(url,{method:"POST",headers:{...headers,origin:"https://other.example"}}),{params:Promise.resolve({action:"connect"})});
    expect(cross.status).toBe(403);expect(mocks.auth).not.toHaveBeenCalled();
    const accepted=await POST(new Request(url,{method:"POST",headers:{...headers,origin:"http://127.0.0.1:3001"}}),{params:Promise.resolve({action:"connect"})});
    const auth=await accepted.json(); expect(accepted.status).toBe(200);
    const state=new URL(auth.url).searchParams.get("state");
    const result=await callback(new Request(`http://127.0.0.1:3001/api/integrations/google/callback?state=${state}&code=test`,{headers}));
    expect(result.status).toBe(303); expect(result.headers.get("location")).toBe("/settings?section=connections&connection=calendar&result=connected");
    const output=await (await GET(new Request(url,{headers}),context)).text(); expect(output).not.toContain("token");
  });
});
