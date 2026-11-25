import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { OAuth2Client, CodeChallengeMethod, type Credentials } from "google-auth-library";
import { requirePermission, type Actor } from "./auth";
import { getDatabase, transaction } from "./database";
import { ApiError } from "./http";

export const GOOGLE_EXPORT_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
const SCOPE = GOOGLE_EXPORT_SCOPE;
function allowed(actor: Actor) {
  requirePermission(actor, "viewCalendar");
}
function config() {
  const clientId=process.env.GOOGLE_CLIENT_ID, secret=process.env.GOOGLE_CLIENT_SECRET;
  const calendarId=process.env.GOOGLE_CALENDAR_ID, redirect=process.env.GOOGLE_OAUTH_REDIRECT_URI;
  const base=process.env.APP_BASE_URL;
  if (!clientId || !secret || !redirect || !base) throw new ApiError(503,"구글 캘린더 환경설정을 확인해 주세요.");
  try {
    const url=new URL(redirect), origin=new URL(base);
    if (url.origin!==origin.origin || url.pathname!=="/api/integrations/google/callback" || url.search || url.hash || url.username || url.password || origin.username || origin.password || !["http:","https:"].includes(url.protocol) || url.protocol!=="https:" && !["localhost","127.0.0.1","[::1]"].includes(url.hostname)) throw Error();
  } catch { throw new ApiError(503,"구글 콜백 주소와 사이트 주소 설정을 확인해 주세요."); }
  return {clientId,secret,calendarId,redirect,base};
}
function oauth() { const c=config(); return new OAuth2Client({clientId:c.clientId,clientSecret:c.secret,redirectUri:c.redirect,transporterOptions:{timeout:15000,retry:false}}); }
function seal(value: unknown, context = "church-google-readonly-v1") {
  const salt=randomBytes(32), iv=randomBytes(12);
  const key=Buffer.from(hkdfSync("sha256",config().secret,salt,context,32));
  const cipher=createCipheriv("aes-256-gcm",key,iv);
  const bytes=Buffer.concat([cipher.update(JSON.stringify(value),"utf8"),cipher.final()]);
  return [salt,iv,cipher.getAuthTag(),bytes].map(v=>v.toString("base64url")).join(".");
}
function open(value: string, context = "church-google-readonly-v1") {
  try {
    const [salt,iv,tag,bytes]=value.split(".").map(v=>Buffer.from(v,"base64url"));
    const key=Buffer.from(hkdfSync("sha256",config().secret,salt,context,32));
    const decipher=createDecipheriv("aes-256-gcm",key,iv); decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(bytes),decipher.final()]).toString("utf8"));
  } catch { throw new ApiError(409,"구글 연결 정보를 읽지 못했습니다. 연결을 해제하고 다시 연결해 주세요."); }
}
export { oauth as googleOAuthClient, seal as sealGoogleData, open as openGoogleData };
const digest=(value:string)=>createHash("sha256").update(value).digest("hex");
function nextGeneration(userId:string,db:ReturnType<typeof getDatabase>) {
  return Number(db.prepare("INSERT INTO google_connection_generations(user_id,generation) VALUES(?,1) ON CONFLICT(user_id) DO UPDATE SET generation=generation+1 RETURNING generation").get(userId)!.generation);
}
export function saveGoogleExportCredentials(userId: string, tokens: Credentials, accountHash: string, db: ReturnType<typeof getDatabase>) {
  nextGeneration(userId, db);
  db.prepare("INSERT INTO google_connections(user_id,credentials,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET credentials=excluded.credentials,updated_at=excluded.updated_at")
    .run(userId, seal({ tokens, accountHash }), new Date().toISOString());
}
export function clearGoogleExportCredentials(userId: string, db: ReturnType<typeof getDatabase>) {
  nextGeneration(userId, db);
  db.prepare("DELETE FROM google_connections WHERE user_id=?").run(userId);
}
export function googleSession(request: Request) {
  const cookie=(request.headers.get("cookie") ?? "").split(";").map(v=>v.trim()).find(v=>v.startsWith("church_session="));
  if (!cookie) throw new ApiError(401,"로그인이 필요합니다.");
  return digest(cookie);
}
export async function startGoogle(actor: Actor, session: string, db=getDatabase()) {
  allowed(actor); const client=oauth(); const pkce=await client.generateCodeVerifierAsync();
  const state=randomBytes(32).toString("base64url");
  transaction(db,()=>{
    const generation=nextGeneration(actor.id,db);
    db.prepare("DELETE FROM google_oauth_attempts WHERE expires_at<=? OR user_id=?").run(Date.now(),actor.id);
    db.prepare("INSERT INTO google_oauth_attempts(state_hash,user_id,session_hash,verifier,expires_at) VALUES(?,?,?,?,?)").run(digest(state),actor.id,session,seal({verifier:pkce.codeVerifier,generation}),Date.now()+600000);
  });
  return client.generateAuthUrl({scope:[SCOPE,"openid"],state,access_type:"offline",prompt:"consent",include_granted_scopes:false,code_challenge:pkce.codeChallenge,code_challenge_method:CodeChallengeMethod.S256});
}
export async function finishGoogle(actor: Actor, session: string, state: string, code: string, db=getDatabase(), recheck:()=>void=()=>{}) {
  allowed(actor);
  if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !code || code.length>4096) throw new ApiError(400,"구글 인증 요청을 확인해 주세요.");
  const row=transaction(db,()=>{
    const r=db.prepare("SELECT * FROM google_oauth_attempts WHERE state_hash=? AND user_id=? AND session_hash=? AND expires_at>?").get(digest(state),actor.id,session,Date.now());
    if (!r) throw new ApiError(400,"구글 인증 요청이 만료되었거나 다른 세션입니다. 다시 연결해 주세요.");
    db.prepare("DELETE FROM google_oauth_attempts WHERE state_hash=?").run(digest(state)); return r;
  });
  const attempt=open(String(row.verifier)) as {verifier:string;generation:number};
  if(typeof attempt.verifier!=="string" || !Number.isSafeInteger(attempt.generation)) throw new ApiError(409,"구글 인증 요청이 변경되었습니다. 다시 연결해 주세요.");
  let tokens: Credentials;
  try { ({tokens}=await oauth().getToken({code,codeVerifier:attempt.verifier})); }
  catch { throw new ApiError(502,"구글 인증을 완료하지 못했습니다. 계정·동의 화면·콜백 설정을 확인하고 다시 연결해 주세요."); }
  if (!tokens.access_token || !tokens.refresh_token || !tokens.id_token || !tokens.scope?.split(" ").includes(SCOPE)) throw new ApiError(403,"전용 캘린더 관리 권한 또는 재접속 권한이 없습니다. 다시 연결해 주세요.");
  let accountHash:string;
  try {
    const ticket=await oauth().verifyIdToken({idToken:tokens.id_token,audience:config().clientId});
    const subject=ticket.getPayload()?.sub;
    if(!subject) throw Error();
    accountHash=digest(subject);
  } catch {throw new ApiError(403,"연결할 구글 계정을 확인하지 못했습니다. 다시 연결해 주세요.");}
  recheck();
  transaction(db,()=>{
    const current=db.prepare("SELECT generation FROM google_connection_generations WHERE user_id=?").get(actor.id);
    if(current?.generation!==attempt.generation) throw new ApiError(409,"구글 연결 요청이 취소되거나 변경되었습니다. 다시 연결해 주세요.");
    // Replacing credentials also invalidates jobs acquired during the consent window.
    saveGoogleExportCredentials(actor.id, tokens, accountHash, db);
  });
}
export function googleStatus(actor: Actor, db=getDatabase()) {
  allowed(actor); let configured=true; try { config(); } catch { configured=false; }
  const row=db.prepare("SELECT credentials FROM google_connections WHERE user_id=?").get(actor.id);
  let needsReconnect=false;
  if(row) {try {const data=open(String(row.credentials));needsReconnect=!data.accountHash || !data.tokens?.scope?.split(" ").includes(SCOPE);}catch{needsReconnect=true;}}
  return {configured,connected:!!row,needsReconnect,readOnly:false,direction:"outbound"};
}
export function disconnectGoogle(actor: Actor, db=getDatabase()) {
  allowed(actor); transaction(db,()=>{
    clearGoogleExportCredentials(actor.id, db);
    db.prepare("DELETE FROM google_oauth_attempts WHERE user_id=?").run(actor.id);
  });
}
export async function readGoogleEvents(actor: Actor, db=getDatabase(), recheck:()=>void=()=>{}) {
  allowed(actor); throw new ApiError(410,"개인 구글 일정 가져오기는 사용하지 않습니다. 웹 일정을 전용 캘린더로 전송해 주세요.");
}

export function getGoogleExportConnection(actor:Actor,db=getDatabase()) {
  allowed(actor);
  const row=db.prepare("SELECT credentials FROM google_connections WHERE user_id=?").get(actor.id);
  if(!row) throw new ApiError(409,"구글 캘린더를 연결해 주세요.");
  const saved=open(String(row.credentials)) as {tokens:Credentials;accountHash:string};
  if(!saved.accountHash || !saved.tokens.scope?.split(" ").includes(SCOPE)) throw new ApiError(409,"전용 캘린더 전송 권한으로 다시 연결해 주세요.");
  const generation=db.prepare("SELECT generation FROM google_connection_generations WHERE user_id=?").get(actor.id)?.generation;
  const client=oauth();client.setCredentials(saved.tokens);
  const assertCurrent=()=>{
    const user=db.prepare("SELECT * FROM users WHERE id=?").get(actor.id);
    const current=db.prepare("SELECT generation FROM google_connection_generations WHERE user_id=?").get(actor.id)?.generation;
    if(!user || user.suspended || user.session_version!==actor.sessionVersion || user.access_expires_at!==null && !(Date.parse(String(user.access_expires_at))>Date.now()) || current!==generation || !db.prepare("SELECT 1 FROM google_connections WHERE user_id=?").get(actor.id)) throw new ApiError(409,"구글 연결 또는 계정 상태가 변경되었습니다.");
    let permissions:unknown;
    try{permissions=JSON.parse(String(user.permissions_json));}catch{ /* An invalid account never exports. */ }
    if(!Array.isArray(permissions) || !permissions.includes("viewCalendar")) throw new ApiError(403,"구글 전송 권한이 없습니다.");
  };
  return {client,accountHash:saved.accountHash,assertCurrent,save:()=>{
    assertCurrent();db.prepare("UPDATE google_connections SET credentials=?,updated_at=? WHERE user_id=? AND credentials=?").run(seal({...saved,tokens:{...saved.tokens,...client.credentials}}),new Date().toISOString(),actor.id,row.credentials);
  }};
}
