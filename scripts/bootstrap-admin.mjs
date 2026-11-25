import { randomUUID } from "node:crypto";
import { chmodSync } from "node:fs";
import path from "node:path";
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { createDatabase, transaction, bumpRevision } from "../lib/server/database.ts";
import { hashPassword } from "../lib/server/password.ts";

const ownerPermissions = ["viewRoom", "chat", "viewCalendar", "createEvent", "editEvent", "deleteEvent", "viewChecklist", "editChecklist", "uploadDocument", "addLink", "editLink", "inviteMember", "manageMembers", "createRoom", "editRoom", "viewHistory", "admin"];
const help = `Offline owner provisioning (Node 24+). Stop the server before running.
  node scripts/bootstrap-admin.mjs --create-owner

An interactive terminal prompts for identity and a hidden password (16-72 characters).
Private automation must explicitly set CHURCH_BOOTSTRAP_USERNAME,
CHURCH_BOOTSTRAP_NAME, CHURCH_BOOTSTRAP_PASSWORD, and
CHURCH_BOOTSTRAP_CONFIRM=CREATE_OWNER. No .env files are loaded.
CHURCH_DATA_DIR optionally selects the same private database directory as the server.
No default owner exists. Credentials are never printed or written to a setup file.
Existing owners are never overwritten; this is not a password-reset command.
`;

function hiddenPassword(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("A private interactive terminal is required.");
  return new Promise((resolve, reject) => {
    let value = "";
    const previousRaw = process.stdin.isRaw;
    emitKeypressEvents(process.stdin);
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const finish = (error) => {
      process.stdin.off("keypress", onKey);
      process.stdin.setRawMode(previousRaw ?? false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error); else resolve(value);
    };
    const onKey = (character, key = {}) => {
      if (key.ctrl && key.name === "c") return finish(new Error("Setup cancelled."));
      if (key.name === "return" || key.name === "enter") return finish();
      if (key.name === "backspace") { value = Array.from(value).slice(0, -1).join(""); return; }
      if (character && !key.ctrl && !key.meta && !character.startsWith("\u001b")) {
        value += character;
        if (value.length > 72) finish(new Error("Owner passwords must contain 16 to 72 characters."));
      }
    };
    process.stdin.on("keypress", onKey);
  });
}

async function setupInput() {
  const supplied = {
    username: process.env.CHURCH_BOOTSTRAP_USERNAME ?? "",
    name: process.env.CHURCH_BOOTSTRAP_NAME ?? "",
    password: process.env.CHURCH_BOOTSTRAP_PASSWORD ?? "",
    confirmation: process.env.CHURCH_BOOTSTRAP_CONFIRM ?? "",
  };
  delete process.env.CHURCH_BOOTSTRAP_PASSWORD;
  if (Object.values(supplied).some(Boolean)) {
    if (Object.values(supplied).some(value => !value) || supplied.confirmation !== "CREATE_OWNER") throw new Error("Private setup requires all CHURCH_BOOTSTRAP fields and explicit CREATE_OWNER confirmation.");
    return supplied;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Private setup is required. Run --help for the prompt or environment-based setup.");
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  let username, name, confirmation;
  try {
    username = await terminal.question("Owner username (not admin): ");
    name = await terminal.question("Owner display name: ");
    confirmation = await terminal.question("Type CREATE_OWNER to provision the first owner: ");
  } finally { terminal.close(); }
  if (confirmation !== "CREATE_OWNER") throw new Error("Setup cancelled.");
  const password = await hiddenPassword("Owner password (hidden): ");
  const repeated = await hiddenPassword("Repeat password (hidden): ");
  if (password !== repeated) throw new Error("Passwords do not match.");
  return { username, name, password, confirmation };
}

export async function provisionOwner({ username, name, password, confirmation }, filename) {
  if (confirmation !== "CREATE_OWNER") throw new Error("Explicit owner confirmation is required.");
  if (typeof username !== "string" || !/^[a-zA-Z0-9_-]{4,24}$/.test(username.trim()) || ["admin", "development-manager", "development-member"].includes(username.trim().toLowerCase())) throw new Error("Choose a private, non-reserved username containing 4 to 24 letters, digits, underscores or hyphens.");
  if (typeof name !== "string" || !name.trim() || name.trim().length > 20) throw new Error("Owner display name must contain 1 to 20 characters.");
  if (typeof password !== "string" || password.length < 16 || password.length > 72 || /^admin1234/i.test(password)) throw new Error("Choose a private owner password containing 16 to 72 characters, not a demo password.");
  if (typeof filename !== "string" || !path.isAbsolute(filename)) throw new Error("An absolute private database path is required.");
  const hash = await hashPassword(password);
  process.umask(0o077);
  const db = createDatabase(filename);
  try {
    transaction(db, () => {
      if (db.prepare("SELECT id FROM users WHERE grade=1 LIMIT 1").get()) throw new Error("An owner already exists. No account was changed.");
      if (db.prepare("SELECT id FROM users WHERE username=? COLLATE NOCASE").get(username.trim())) throw new Error("This username is already in use. No account was changed.");
      const id = randomUUID(); const at = new Date().toISOString();
      db.prepare("INSERT INTO users(id,name,username,grade,role,permissions_json,salt,password_hash,created_at) VALUES (?,?,?,1,?,?,?,?,?)")
        .run(id, name.trim(), username.trim().toLowerCase(), "Owner", JSON.stringify(ownerPermissions), hash.salt, hash.passwordHash, at);
      db.prepare("INSERT INTO activities(id,actor_id,action,target,at) VALUES (?,?,?,?,?)").run(randomUUID(), id, "Owner provisioned offline", id, at);
      bumpRevision(db);
    });
    if (process.platform !== "win32") chmodSync(filename, 0o600);
  } finally { db.close(); }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") { process.stdout.write(help); return; }
  if (args.length !== 1 || args[0] !== "--create-owner") throw new Error("Explicit --create-owner setup is required. Run --help for private setup instructions.");
  const input = await setupInput();
  const filename = path.join(path.resolve(process.env.CHURCH_DATA_DIR || path.join(process.cwd(), ".local", "server")), "church.sqlite");
  await provisionOwner(input, filename);
  process.stdout.write("Owner account created. Start the server and sign in with the privately chosen credentials.\n");
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    // Only deliberate validation messages are public; database/stack details may contain private data.
    const message = error instanceof Error && !error.message.includes("SQLITE") && !error.message.includes("constraint") ? error.message : "Owner setup failed. Check the private database and input.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
