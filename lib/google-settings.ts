export type GoogleConnectionService = "calendar" | "forms" | "account";
export type GoogleConnectionOutcome = "connected" | "partial" | "cancelled" | "failed";
export const googleConnectionFeatures = ["calendar", "formsRead", "formsCreate"] as const;
export type GoogleConnectionFeature = typeof googleConnectionFeatures[number];
export const googleRequiredSettings = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_OAUTH_REDIRECT_URI", "APP_BASE_URL"] as const;
export type GoogleSetupStatus = { missing: (typeof googleRequiredSettings)[number][]; invalidRedirect: boolean };
export type GoogleAccountStatus = Partial<Record<GoogleConnectionFeature, { configured: boolean; connected: boolean; needsReconnect?: boolean }>> & { setup?: GoogleSetupStatus };
export type GoogleDiagnosticState = "server_setup" | "unconnected" | "reconnect" | "expired" | "insufficient_scope" | "error" | "verified";
export type GoogleDiagnostics = Partial<Record<GoogleConnectionFeature, GoogleDiagnosticState>>;

const section = "/settings?section=connections";
export const googleSettingsHref = (service: Exclude<GoogleConnectionService, "account">) => `${section}#google-${service}`;
export const googleConnectionResultHref = (service: GoogleConnectionService, result: GoogleConnectionOutcome) =>
  `${section}&connection=${service}&result=${result}`;
