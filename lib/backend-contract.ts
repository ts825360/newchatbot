import type { OwnerOverview } from "./invitation-types";
import type { UserProfile } from "./types";

export type ServerRecord = { key: string; value: string | null; version: string };
export type ServerWrite = { key: string; value: string; version: string };
export type ServerSnapshot = { records: ServerRecord[]; profile: UserProfile; activeRoomId: string | null; written?: ServerRecord[] };
export type ServerAuthCache = { profile: UserProfile | null; management: OwnerOverview | null };
