const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function normalizeInvitationCode(value: string) {
  return value.toUpperCase().replace(/[\s-]/g, "");
}

export function generateInvitationCode() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const raw = Array.from(bytes, byte => ALPHABET[byte & 31]).join("");
  return raw.match(/.{4}/g)!.join("-");
}

export async function hashInvitationCode(value: string) {
  const bytes = new TextEncoder().encode(normalizeInvitationCode(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function nextAnnualExpiry(now: Date) {
  const korean = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  let year = korean.getUTCFullYear();
  let cutoff = Date.UTC(year, 11, 1) - 9 * 60 * 60 * 1000;
  if (now.getTime() >= cutoff) cutoff = Date.UTC(++year, 11, 1) - 9 * 60 * 60 * 1000;
  return new Date(cutoff).toISOString();
}
