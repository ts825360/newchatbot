import type { DatabaseSync } from "node:sqlite";
import { readConversationPlaces, verifiedPublicPlace } from "../conversation-places";
import type { ConversationScope } from "../conversation-scope";
import { canonicalWorkspaceTool, requireOwnedConversation } from "./conversation-scope";

export const eventVenueTool = {
  type: "function", name: "get_current_event_venue", strict: true,
  description: "Read the current event's verified public primary venue. Use when the user refers to our lodging or event venue, asks about nearby food or activities, or needs the venue name or address. No web search.",
  parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
} as const;

export function readPublicEventVenue(db: DatabaseSync, scope: ConversationScope) {
  requireOwnedConversation(db, scope);
  const canonical = canonicalWorkspaceTool(scope, "location");
  const row = db.prepare("SELECT data_json FROM records WHERE key=? AND owner_id=? AND room_id=? AND kind='location'")
    .get(canonical, scope.accountId, scope.roomId);
  const legacy = `private-v1:${encodeURIComponent(scope.accountId)}:${encodeURIComponent(scope.roomId)}:`;
  const candidates = row ? [row] : db.prepare(`SELECT data_json FROM records WHERE owner_id=? AND room_id=? AND kind='location'
    AND substr(key,1,?)=? ORDER BY updated_at DESC, revision DESC, key`).all(scope.accountId, scope.roomId, legacy.length, legacy);
  for (const candidate of candidates) {
    try {
      const name = readConversationPlaces(JSON.parse(String(candidate.data_json)))[0];
      if (!name) continue;
      const place = verifiedPublicPlace(name);
      return place ? { name: place.name, address: place.address, source: place.source } : null;
    } catch { /* An unreadable legacy row is not a usable location. */ }
  }
  return null;
}
