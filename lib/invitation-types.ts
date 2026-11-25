export type AdminGrade = 1 | 2 | 3;
export type InvitationDraft = {
  label: string;
  grade: 2 | 3;
  role: string;
  signupExpiresAt: string;
  accessExpiresAt: string | null;
  access?: "viewer" | "chat" | "edit";
};
export type InvitationView = Omit<InvitationDraft, "signupExpiresAt"> & {
  id: string;
  signupExpiresAt: string | null;
  createdAt: string;
  issuerName: string;
  status: "unused" | "used" | "expired" | "revoked";
  usedByName: string | null;
};
export type CreatedInvitation = { invitation: InvitationView; code: string; signupPath: string };
export type MemberView = {
  id: string;
  name: string;
  username: string;
  grade: AdminGrade;
  role: string;
  accessExpiresAt: string | null;
  status: "active" | "suspended" | "expired";
  fixed: boolean;
};
export type ManagementActivity = { id: string; at: string; actor: string; action: string; target: string };
export type OwnerOverview = { members: MemberView[]; invitations: InvitationView[]; activities: ManagementActivity[]; reports?: { id: string; reporter: string; category: string; description: string; createdAt: string; notification?: string; context?: { screenName: string; roomName?: string; width: number; height: number } }[] };
