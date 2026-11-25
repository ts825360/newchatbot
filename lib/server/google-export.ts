import {createHash,randomBytes} from "node:crypto";
import type {CalendarEvent} from "../types";
import {normalizeCalendarTime,resolveCalendarHours} from "../calendar-time";
import {requirePermission,type Actor} from "./auth";
import {getDatabase} from "./database";
import {getGoogleExportConnection} from "./google-calendar";
import {ApiError} from "./http";

type ExportRow={room_id:string;event_id:string;remote_id:string;payload_hash:string;status:string;error:string};
const base="https://www.googleapis.com/calendar/v3/calendars";
const key=(room:string,event:string)=>JSON.stringify([room,event]);
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const addDay=(date:string)=>new Date(Date.parse(date+"T00:00:00Z")+86400000).toISOString().slice(0,10);
function payload(event:CalendarEvent,room:{name:string;location?:string}) {
  let start:Record<string,string>,end:Record<string,string>;
  if(event.endTime!==undefined){
    const range=resolveCalendarHours(event.time,event.endTime);
    if(!range)throw new ApiError(400,"일정 시작·종료 시간을 확인해 주세요.");
    start={dateTime:`${event.date}T${range.start}:00+09:00`,timeZone:"Asia/Seoul"};
    end={dateTime:`${range.nextDay?addDay(event.date):event.date}T${range.end}:00+09:00`,timeZone:"Asia/Seoul"};
  } else {
    // Do not change old Google events until an editor saves them with the new time fields.
    const localTime=normalizeCalendarTime(event.time);
    if(localTime===null) throw new ApiError(400,"일정 시간을 다시 선택해 주세요.");
    if(!localTime) {start={date:event.date};end={date:addDay(event.date)};}
    else {
      const time=`${event.date}T${localTime}:00+09:00`;
      start={dateTime:time,timeZone:"Asia/Seoul"};
      end={dateTime:new Date(Date.parse(time)+60000).toISOString(),timeZone:"Asia/Seoul"};
    }
  }
  return {summary:`[${room.name}] ${event.title}`,location:event.location||"",description:event.memo,start,end};
}
function desired(db:ReturnType<typeof getDatabase>,roomId?:string) {
  const result=new Map<string,{roomId:string;eventId:string;body:ReturnType<typeof payload>|null;error:string}>();
  const sql="SELECT r.room_id,r.data_json,rooms.data_json AS room_json FROM records r JOIN rooms ON rooms.id=r.room_id WHERE r.kind='events' AND r.owner_id IS NULL";
  const rows=roomId ? db.prepare(sql+" AND r.room_id=?").all(roomId) : db.prepare(sql).all();
  for(const row of rows) for(const event of JSON.parse(String(row.data_json)).items as CalendarEvent[]) {
    if(event.status!=="confirmed")continue;
    const room=JSON.parse(String(row.room_json));let body=null,error="";
    try{body=payload(event,room);}catch(cause){error=cause instanceof ApiError?cause.message:"일정 내용을 확인해 주세요.";}
    result.set(key(String(row.room_id),event.id),{roomId:String(row.room_id),eventId:event.id,body,error});
  }
  return result;
}
export type GoogleEventExportStatus =
  | {state:"notScheduled"|"pending"|"synced"}
  | {state:"unavailable"|"failed";error:string};
export function eventExportStatus(actor:Actor,roomId:string,eventId:string,db=getDatabase()):GoogleEventExportStatus {
  requirePermission(actor,"viewRoom");
  requirePermission(actor,"viewCalendar");
  const item=desired(db,roomId).get(key(roomId,eventId));
  if(!item)return {state:"notScheduled"};
  let accountHash:string;
  try {
    const connection=getGoogleExportConnection(actor,db);connection.assertCurrent();
    accountHash=connection.accountHash;
  }catch(cause){
    return {state:"unavailable",error:cause instanceof ApiError?cause.message:"구글 연결 상태를 확인해 주세요."};
  }
  if(!item.body)return {state:"failed",error:item.error};
  const row=db.prepare("SELECT status,error,payload_hash FROM google_exports WHERE user_id=? AND account_hash=? AND room_id=? AND event_id=?").get(actor.id,accountHash,roomId,eventId);
  if(row?.payload_hash===hash(item.body)){
    if(row.status==="synced")return {state:"synced"};
    if(row.error)return {state:"failed",error:String(row.error)};
  }
  const target=db.prepare("SELECT error FROM google_export_targets WHERE user_id=? AND account_hash=?").get(actor.id,accountHash);
  return target?.error ? {state:"failed",error:String(target.error)} : {state:"pending"};
}
function exportError(cause:unknown):string {
  const status=(cause as {response?:{status?:number}} | null)?.response?.status;
  if(status===400)return "구글이 일정 요청을 거절했습니다. 일시와 내용을 확인해 주세요. (400)";
  if(status===401||status===403)return `구글 전송 권한을 확인한 뒤 다시 연결해 주세요. (${status})`;
  if(status===404)return "구글에서 전용 캘린더 또는 일정을 찾지 못했습니다. (404)";
  if(status===429||typeof status==="number"&&status>=500)return "구글 응답이 일시적으로 지연됩니다. 잠시 후 자동으로 다시 시도합니다.";
  return "구글에 일정을 전송하지 못했습니다. 잠시 후 자동으로 다시 시도합니다.";
}
export function exportStatus(actor:Actor,db=getDatabase()) {
  try {
    const connection=getGoogleExportConnection(actor,db);connection.assertCurrent();
    const rows=db.prepare("SELECT * FROM google_exports WHERE user_id=? AND account_hash=?").all(actor.id,connection.accountHash) as ExportRow[];
    const next=desired(db);let pending=0,synced=0;
    for(const item of next.values()) {
      const row=rows.find(r=>r.room_id===item.roomId&&r.event_id===item.eventId);
      if(item.body && row?.status==="synced" && row.payload_hash===hash(item.body))synced++;else pending++;
    }
    pending+=rows.filter(r=>r.status!=="deleted"&&!next.has(key(r.room_id,r.event_id))).length;
    const target=db.prepare("SELECT error FROM google_export_targets WHERE user_id=? AND account_hash=?").get(actor.id,connection.accountHash);
    return {pending,synced,error:String(target?.error||rows.find(r=>r.error)?.error||""),canSync:true};
  } catch(cause){return {pending:0,synced:0,error:cause instanceof ApiError?cause.message:"구글 연결 상태를 확인해 주세요.",canSync:false};}
}
const running=new WeakMap<ReturnType<typeof getDatabase>,Set<string>>();
export async function syncGoogleExports(actor:Actor,db=getDatabase()) {
  const active=running.get(db)??new Set<string>();running.set(db,active);
  if(active.has(actor.id))return exportStatus(actor,db);
  active.add(actor.id);
  try {
    const connection=getGoogleExportConnection(actor,db);connection.assertCurrent();
    const args=[actor.id,connection.accountHash];
    const next=desired(db);
    const old=db.prepare("SELECT * FROM google_exports WHERE user_id=? AND account_hash=?").all(...args) as ExportRow[];
    if(!next.size && !old.some(r=>r.status!=="deleted"))return exportStatus(actor,db);
    let target=db.prepare("SELECT calendar_id,error FROM google_export_targets WHERE user_id=? AND account_hash=?").get(...args);
    if(!target) {
      db.prepare("INSERT INTO google_export_targets(user_id,account_hash,calendar_id,error) VALUES(?,?,'',?)").run(...args,"전용 캘린더 생성 결과를 확인해야 합니다. 중복 생성을 막기 위해 자동 재생성을 보류했습니다.");
      try {
        connection.assertCurrent();
        const response=await connection.client.request<{id:string}>({method:"POST",url:base,data:{summary:"교회 행사",timeZone:"Asia/Seoul"},timeout:15000,retry:false});
        if(!response.data.id)throw Error();
        db.prepare("UPDATE google_export_targets SET calendar_id=?,error='' WHERE user_id=? AND account_hash=?").run(response.data.id,...args);
        target={calendar_id:response.data.id,error:""};
        connection.assertCurrent();
      } catch(cause) {
        const status=(cause as {response?:{status?:number}})?.response?.status;
        if(status && status>=400 && status<500 && status!==408 && status!==429) db.prepare("DELETE FROM google_export_targets WHERE user_id=? AND account_hash=? AND calendar_id=''").run(...args);
        return {...exportStatus(actor,db),error:status===403?"구글 전용 캘린더 권한을 확인하고 다시 연결해 주세요.":"전용 캘린더 생성 결과를 확인해 주세요. 자동 중복 생성은 하지 않습니다."};
      }
    }
    if(!target.calendar_id)return exportStatus(actor,db);
    const calendarUrl=base+"/"+encodeURIComponent(String(target.calendar_id));
    let processed=0;
    for(const item of next.values()) {
      if(processed>=100)break;
      connection.assertCurrent();
      let row=old.find(r=>r.room_id===item.roomId&&r.event_id===item.eventId);
      const bodyHash=item.body?hash(item.body):"";
      if(row?.status==="synced" && row.payload_hash===bodyHash && item.body)continue;
      let remoteId=row && row.status!=="deleted" ? row.remote_id : randomBytes(16).toString("hex");
      const isNew=!row || row.status==="deleted";
      db.prepare("INSERT INTO google_exports(user_id,account_hash,room_id,event_id,remote_id,payload_hash,status,error) VALUES(?,?,?,?,?,?,'pending',?) ON CONFLICT(user_id,account_hash,room_id,event_id) DO UPDATE SET remote_id=excluded.remote_id,payload_hash=excluded.payload_hash,status=CASE WHEN google_exports.status='deleting' THEN 'deleting' ELSE 'pending' END,error=excluded.error").run(...args,item.roomId,item.eventId,remoteId,bodyHash,item.error);
      if(!item.body)continue;
      try {
        // A source edit while a network call is pending is reconciled on the next run.
        const isCurrent=()=>{
          const current=desired(db).get(key(item.roomId,item.eventId));
          return !!current?.body && hash(current.body)===bodyHash;
        };
        if(!isCurrent())continue;
        const request={params:{sendUpdates:"none"},timeout:15000,retry:false};
        const insert=()=>connection.client.request({...request,method:"POST",url:calendarUrl+"/events",data:{...item.body,id:remoteId,reminders:{useDefault:true}}});
        // Only update the fields owned by the website; keep Google's attendee and notification settings.
        const patch=()=>connection.client.request({...request,method:"PATCH",url:calendarUrl+"/events/"+remoteId,data:item.body});
        try{await (isNew?insert():patch());}catch(cause){
          const status=(cause as {response?:{status?:number}})?.response?.status;
          connection.assertCurrent();
          if(!isCurrent())continue;
          if(isNew && status===409)await patch();
          else if(!isNew && (status===410 || status===404 && row?.status==="deleting")) {
            remoteId=randomBytes(16).toString("hex");
            db.prepare("UPDATE google_exports SET remote_id=?,status='pending' WHERE user_id=? AND account_hash=? AND room_id=? AND event_id=?").run(remoteId,...args,item.roomId,item.eventId);
            await insert();
          }
          else if(!isNew && status===404)await insert();
          else throw cause;
        }
        connection.assertCurrent();
        db.prepare("UPDATE google_exports SET payload_hash=?,status='synced',error='' WHERE user_id=? AND account_hash=? AND room_id=? AND event_id=?").run(bodyHash,...args,item.roomId,item.eventId);
      }catch(cause){
        db.prepare("UPDATE google_exports SET error=? WHERE user_id=? AND account_hash=? AND room_id=? AND event_id=?").run(exportError(cause),...args,item.roomId,item.eventId);
      }
      processed++;
    }
    for(const row of old.filter(r=>r.status!=="deleted"&&!next.has(key(r.room_id,r.event_id)))) {
      if(processed++>=100)break;
      connection.assertCurrent();
      // Do not delete an event re-confirmed since the snapshot.
      if(desired(db).has(key(row.room_id,row.event_id)))continue;
      db.prepare("UPDATE google_exports SET status='deleting',error='' WHERE user_id=? AND account_hash=? AND room_id=? AND event_id=?").run(...args,row.room_id,row.event_id);
      try {
        try{await connection.client.request({method:"DELETE",url:calendarUrl+"/events/"+row.remote_id,params:{sendUpdates:"none"},timeout:15000,retry:false});}
        catch(cause){if(![404,410].includes(Number((cause as {response?:{status?:number}})?.response?.status)))throw cause;}
        connection.assertCurrent();db.prepare("UPDATE google_exports SET status='deleted',error='' WHERE user_id=? AND account_hash=? AND room_id=? AND event_id=?").run(...args,row.room_id,row.event_id);
      }catch{db.prepare("UPDATE google_exports SET error=? WHERE user_id=? AND account_hash=? AND room_id=? AND event_id=?").run("구글 취소 반영 실패. 다시 시도해 주세요.",...args,row.room_id,row.event_id);}
    }
    connection.save();return exportStatus(actor,db);
  }finally{active.delete(actor.id);}
}
export async function syncAllGoogleExports(db=getDatabase()) {
  const users=db.prepare("SELECT u.id,u.name,u.username,u.grade,u.role,u.permissions_json,u.access_expires_at,u.session_version FROM users u JOIN google_connections c ON c.user_id=u.id WHERE u.suspended=0 AND u.grade IN (1,2,3)").all();
  for(const user of users) {
    if(process.env.NODE_ENV!=="development" && ["development-manager","development-member"].includes(String(user.id)))continue;
    try{
      const permissions:unknown=JSON.parse(String(user.permissions_json));
      if(!Array.isArray(permissions) || !permissions.includes("viewCalendar"))continue;
      const actor:Actor={id:String(user.id),name:String(user.name),username:String(user.username),grade:Number(user.grade) as Actor["grade"],role:String(user.role),permissions,accessExpiresAt:user.access_expires_at as string|null,sessionVersion:Number(user.session_version)};
      const status=exportStatus(actor,db);if(status.canSync&&status.pending)await syncGoogleExports(actor,db);
    }catch{/* Failed jobs remain derived from durable source/mappings; never log provider secrets. */}
  }
}
