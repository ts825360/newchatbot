import { pbkdf2, randomBytes, timingSafeEqual } from "node:crypto";

export const PASSWORD_ITERATIONS = 600_000;

function derive(password: string, salt: string, iterations: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    pbkdf2(password, Buffer.from(salt, "hex"), iterations, 32, "sha256", (error, key) => error ? reject(error) : resolve(key));
  });
}

export async function hashPassword(password: string): Promise<{ salt: string; passwordHash: string }> {
  if (typeof password !== "string" || password.length < 8 || password.length > 72) throw new Error("Password must contain 8 to 72 characters.");
  const salt = randomBytes(32).toString("hex");
  const hash = await derive(password, salt, PASSWORD_ITERATIONS);
  return { salt, passwordHash: `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${hash.toString("hex")}` };
}

export async function verifyPassword(password: string, salt: string, passwordHash: string): Promise<boolean> {
  if (typeof password !== "string" || password.length > 72 || !/^[a-f0-9]{64}$/.test(salt)) return false;
  const parsed = /^pbkdf2-sha256\$(\d+)\$([a-f0-9]{64})$/.exec(passwordHash);
  if (!parsed) return false;
  const iterations = Number(parsed[1]);
  if (!Number.isSafeInteger(iterations) || iterations < PASSWORD_ITERATIONS || iterations > 2_000_000) return false;
  const actual = await derive(password, salt, iterations);
  return timingSafeEqual(actual, Buffer.from(parsed[2], "hex"));
}
