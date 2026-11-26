// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDatabase } from "@/lib/server/database";
import { canonicalWorkspaceTool } from "@/lib/server/conversation-scope";
import { handleTransportComparison } from "@/lib/server/transport-comparison";
import { createTransportComparisonFacts, type TransportPlan } from "@/lib/transport-comparison";

const roomId = "retreat";
const conversationId = "initial-retreat";
const plan: TransportPlan = {
  revision: 1, demand: "f".repeat(64), state: "ready", extra: 0, quote: 0, assemblyPoints: 1,
  vehicleLabels: ["PRIVATE_VEHICLE"], outbound: { demand: 4, missing: 0, extraMissing: 0 },
  return: { demand: 4, missing: 0, extraMissing: 0 },
};
const pair: { a: TransportPlan; b: TransportPlan } = { a: plan, b: { ...plan, quote: 3000, assemblyPoints: 2 } };
const expected = JSON.stringify(createTransportComparisonFacts(pair));
const fetchProvider = vi.fn();
let db: ReturnType<typeof createDatabase>;

function session(account: string, permissions = ["viewRoom", "chat", "editChecklist"]) {
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const token = createHash("sha256").update(account).digest("base64url");
  db.prepare("INSERT INTO users(id,name,username,grade,role,permissions_json,salt,password_hash,created_at) VALUES(?,?,?,3,'test',?,'x','x',?)")
    .run(account, account, account, JSON.stringify(permissions), new Date().toISOString());
  db.prepare("INSERT INTO sessions(token_hash,user_id,session_version,expires_at,created_at) VALUES(?,?,0,?,?)")
    .run(hash(token), account, new Date(Date.now() + 300_000).toISOString(), new Date().toISOString());
  return `church_session=${token}`;
}

const request = (cookie: string, patch = {}, headers = {}) => new Request("http://localhost/api/transport/compare", {
  method: "POST", headers: { "content-type": "application/json", cookie, ...headers },
  body: JSON.stringify({ accountId: "alice", roomId, conversationId, expected, ...patch }),
});
const run = (req: Request) => handleTransportComparison(req, db);

function store(comparison = pair) {
  db.prepare("INSERT OR REPLACE INTO records(key,owner_id,room_id,kind,data_json,updated_at) VALUES(?,?,?,'transport',?,?)")
    .run(canonicalWorkspaceTool({ accountId: "alice", roomId, conversationId }, "transport"), "alice", roomId,
      JSON.stringify({ comparison, input: { people: [{ name: "PRIVATE_MEMBER" }] } }), new Date().toISOString());
}

let alice: string;
beforeEach(() => {
  db = createDatabase(":memory:");
  db.prepare("INSERT INTO rooms(id,data_json) VALUES(?,?)").run(roomId, JSON.stringify({ date: "2027-01-01" }));
  alice = session("alice");
  store();
  vi.stubGlobal("fetch", fetchProvider.mockReset().mockRejectedValue(new Error("Unexpected model request")));
});
afterEach(() => { vi.unstubAllGlobals(); db.close(); });

it("renders all confirmed differences without contacting a model or writing", async () => {
  const before = db.prepare("SELECT total_changes() AS tally").get()?.tally;
  const response = await run(request(alice));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const { text } = await response.json();
  expect(text).toContain("B 3,000원");
  expect(text).toContain("출발 집합 지점은 A 1곳, B 2곳입니다.");
  expect(text).not.toMatch(/PRIVATE_|alice|initial-retreat|f{64}/);
  expect(fetchProvider).not.toHaveBeenCalled();
  expect(db.prepare("SELECT total_changes() AS tally").get()?.tally).toBe(before);
});

it("rejects cross-site, wrong account, wrong conversation or stale comparisons", async () => {
  const bob = session("bob");
  expect((await run(request(alice, {}, { origin: "https://example.org" }))).status).toBe(403);
  expect((await run(request(bob))).status).toBe(409);
  expect((await run(request(bob, { accountId: "bob" }))).status).toBe(409);
  expect((await run(request(alice, { conversationId: "other" }))).status).toBe(404);
  expect((await run(request(alice, { expected: "{}" }))).status).toBe(409);
  expect(fetchProvider).not.toHaveBeenCalled();
});

it("rejects stale comparison facts after a saved edit", async () => {
  store({ ...pair, b: { ...pair.b, quote: 5000 } });
  expect((await run(request(alice))).status).toBe(409);
  expect(fetchProvider).not.toHaveBeenCalled();
});

it("explains a single actual difference directly instead of highlighting identical coverage", async () => {
  const quoteOnly = { a: pair.a, b: { ...pair.b, assemblyPoints: pair.a.assemblyPoints } };
  store(quoteOnly);
  const response = await run(request(alice, { expected: JSON.stringify(createTransportComparisonFacts(quoteOnly)) }));
  expect(response.status).toBe(200);
  expect((await response.json()).text).toContain("B 3,000원");
  expect(fetchProvider).not.toHaveBeenCalled();
});
