export type ConversationScope = { accountId: string; roomId: string; conversationId: string };

export const privateToolKinds = ["checklist", "risks", "transport", "location", "documents", "decisions", "timetable"] as const;
export type PrivateToolKind = typeof privateToolKinds[number];

const tuple = (...parts: string[]) => parts.map(encodeURIComponent).join(":");
export const scopeId = (scope: ConversationScope) => tuple(scope.accountId, scope.roomId, scope.conversationId);
export const privateToolKey = (scope: ConversationScope, kind: PrivateToolKind) => `church-private-v1:${scopeId(scope)}:${kind}`;
export const conversationHistoryKey = (accountId: string, roomId: string) => `church-planner-conversations-v1:${tuple(accountId, roomId)}`;
export const initialConversationId = (roomId: string) => `initial-${roomId}`;
