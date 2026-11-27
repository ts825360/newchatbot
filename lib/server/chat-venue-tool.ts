import type { DatabaseSync } from "node:sqlite";
import { verifiedPublicPlace } from "../conversation-places";
import type { ConversationScope } from "../conversation-scope";
import { requireOwnedConversation } from "./conversation-scope";
import { readWorkspacePrimaryPlace } from "./workspace-primary-place";

export const eventVenueTool = {
  type: "function", name: "get_current_event_venue", strict: true,
  description: "Read the current event's verified public primary venue. Use when the user refers to our lodging or event venue, asks about nearby food or activities, or needs the venue name or address. No web search.",
  parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
} as const;

export function readPublicEventVenue(db: DatabaseSync, scope: ConversationScope) {
  requireOwnedConversation(db, scope);
  const primary = readWorkspacePrimaryPlace(db, scope);
  const place = primary.state === "saved" ? verifiedPublicPlace(primary.name) : null;
  return place ? { name: place.name, address: place.address, source: place.source } : null;
}
