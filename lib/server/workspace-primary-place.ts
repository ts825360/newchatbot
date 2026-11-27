import type { DatabaseSync } from "node:sqlite";
import { isConversationPlaceRecord, readConversationPlaces, type ConversationPlaceRecord } from "../conversation-places";
import type { ConversationScope } from "../conversation-scope";
import { workspaceToolPrefix } from "./conversation-scope";

type WorkspacePrimaryPlace = { state: "saved"; name: string } | { state: "absent" | "unreadable" };
type WorkspacePlaces = { state: "saved"; names: string[]; record: ConversationPlaceRecord } | { state: "absent" | "unreadable" };

// Callers authorize access to the account's own workspace before projecting its primary name.
export function readWorkspacePrimaryPlace(db: DatabaseSync, scope: Pick<ConversationScope, "accountId" | "roomId">): WorkspacePrimaryPlace {
  const places = readWorkspacePlaces(db, scope);
  return places.state === "saved" ? { state: "saved", name: places.names[0] } : places;
}

export function readWorkspacePlaces(db: DatabaseSync, scope: Pick<ConversationScope, "accountId" | "roomId">): WorkspacePlaces {
  const canonical = db.prepare("SELECT data_json FROM records WHERE key=? AND owner_id=? AND room_id=? AND kind='location'")
    .get(workspaceToolPrefix(scope) + "location", scope.accountId, scope.roomId);
  const parse = (raw: unknown): WorkspacePlaces => {
    const record: unknown = JSON.parse(String(raw));
    if (!isConversationPlaceRecord(record)) throw new Error("Invalid location record");
    const names = readConversationPlaces(record);
    return names.length ? { state: "saved", names, record } : { state: "absent" };
  };
  if (canonical) {
    try {
      return parse(canonical.data_json);
    } catch { return { state: "unreadable" }; }
  }

  const prefix = `private-v1:${encodeURIComponent(scope.accountId)}:${encodeURIComponent(scope.roomId)}:`;
  const rows = db.prepare(`SELECT data_json FROM records WHERE owner_id=? AND room_id=? AND kind='location'
    AND substr(key,1,?)=? ORDER BY updated_at DESC, revision DESC, key`).iterate(scope.accountId, scope.roomId, prefix.length, prefix);
  let unreadable = false;
  for (const row of rows) {
    try {
      const place = parse(row.data_json);
      if (place.state === "saved") return place;
    } catch { unreadable = true; }
  }
  return unreadable ? { state: "unreadable" } : { state: "absent" };
}
