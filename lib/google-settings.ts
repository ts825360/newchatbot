export type GoogleConnectionService = "calendar" | "forms" | "account";
export type GoogleConnectionOutcome = "connected" | "partial" | "cancelled" | "failed";
export const googleConnectionFeatures = ["calendar", "formsRead", "formsCreate"] as const;
export type GoogleConnectionFeature = typeof googleConnectionFeatures[number];
export type GoogleAccountStatus = Partial<Record<GoogleConnectionFeature, { configured: boolean; connected: boolean; needsReconnect?: boolean }>>;

const section = "/settings?section=connections";
export const googleSettingsHref = (service: Exclude<GoogleConnectionService, "account">) => `${section}#google-${service}`;
export const googleConnectionResultHref = (service: GoogleConnectionService, result: GoogleConnectionOutcome) =>
  `${section}&connection=${service}&result=${result}`;
