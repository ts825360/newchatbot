import type { DatabaseSync } from "node:sqlite";
import { readConversationPlaces, verifiedPublicPlace } from "../conversation-places";
import type { ConversationScope } from "../conversation-scope";
import { canonicalWorkspaceTool, inheritWorkspaceRecords, requireOwnedConversation } from "./conversation-scope";

export const eventVenueTool = {
  type: "function", name: "get_current_event_venue", strict: true,
  description: "Read the current event's verified public primary venue. Use when the user refers to our lodging or event venue, asks about nearby food or activities, or needs the venue name or address. No web search.",
  parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
} as const;

export function readPublicEventVenue(db: DatabaseSync, scope: ConversationScope) {
  requireOwnedConversation(db, scope);
  inheritWorkspaceRecords(db, scope);
  const row = db.prepare("SELECT data_json FROM records WHERE key=? AND owner_id=? AND room_id=? AND kind='location'")
    .get(canonicalWorkspaceTool(scope, "location"), scope.accountId, scope.roomId);
  if (!row) return null;
  try {
    const place = verifiedPublicPlace(readConversationPlaces(JSON.parse(String(row.data_json)))[0] ?? "");
    // Never forward edited addresses, notes, alternative locations, or internal IDs.
    return place ? { name: place.name, address: place.address, source: place.source } : null;
  } catch { return null; }
}
