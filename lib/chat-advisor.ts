import { validDate } from "./room-timing";

export type AdvisorProposal = { kind: "checklist" | "calendar"; title: string; date: string };
export type AdvisorPresentation = {
  version?: 2;
  kind: "chat" | "plan" | "list";
  title: string;
  rows: { label: string; detail: string }[];
  rationale: string;
  proposals: AdvisorProposal[];
};
export type AdvisorReply = AdvisorPresentation & { summary: string };

const limits = { summary: 1200, planSummary: 240, title: 100, label: 36, detail: 180, rationale: 480, proposalTitle: 120, count: 4, listCount: 12 };
const line = (value: unknown, max: number, empty = false): value is string =>
  typeof value === "string" && value.length <= max && (empty || !!value.trim()) && !/[\x00-\x1f\x7f]/.test(value);
function fields(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

export function isAdvisorPresentation(value: unknown): value is AdvisorPresentation {
  const keys = ["kind", "title", "rows", "rationale", "proposals"];
  if (!fields(value, keys) && !(fields(value, [...keys, "version"]) && value.version === 2)) return false;
  const list = value.version === 2 && value.kind === "list";
  if (!(value.kind === "chat" || value.kind === "plan" || list)
    || !line(value.title, limits.title, value.kind === "chat") || !line(value.rationale, limits.rationale, true)
    || !Array.isArray(value.rows) || value.rows.length > (list ? limits.listCount : limits.count)
    || !value.rows.every(row => fields(row, ["label", "detail"]) && line(row.label, limits.label) && line(row.detail, limits.detail))
    || !Array.isArray(value.proposals) || value.proposals.length > limits.count
    || !value.proposals.every(proposal => fields(proposal, ["kind", "title", "date"]) && line(proposal.title, limits.proposalTitle)
      && (proposal.kind === "checklist" && proposal.date === ""
        || proposal.kind === "calendar" && typeof proposal.date === "string" && validDate(proposal.date)))) return false;
  if (list) return value.rows.length > 0 && !value.rationale && !value.proposals.length
    && new Set(value.rows.map(row => row.label.normalize("NFKC").trim().toLowerCase())).size === value.rows.length;
  return value.kind === "plan" || value.title === "" && value.rationale === "" && !value.rows.length && !value.proposals.length;
}

export function parseAdvisorReply(raw: string): AdvisorReply | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Object.hasOwn(parsed, "summary")) return null;
  if (!("summary" in parsed)) return null;
  const { summary, ...presentation } = parsed;
  if (!isAdvisorPresentation(presentation) || !line(summary, presentation.kind === "chat" ? limits.summary : limits.planSummary)) return null;
  return { ...presentation, summary };
}

// Keep provider schema portable; semantic checks and display limits are enforced after decoding.
const string = { type: "string" };
const object = (properties: Record<string, unknown>) => ({
  type: "object", additionalProperties: false, required: Object.keys(properties), properties,
});
export const advisorReplyFormat = {
  type: "json_schema", name: "event_advisor_reply_v1", strict: true,
  schema: object({
    kind: { type: "string", enum: ["chat", "plan"] }, summary: string, title: string,
    rows: { type: "array", items: object({ label: string, detail: string }) },
    rationale: string,
    proposals: { type: "array", items: object({ kind: { type: "string", enum: ["checklist", "calendar"] }, title: string, date: string }) },
  }),
};

export const advisorReplyFormatV2 = {
  type: "json_schema", name: "event_advisor_reply_v2", strict: true,
  schema: object({
    ...advisorReplyFormat.schema.properties, version: { type: "integer", enum: [2] },
    kind: { type: "string", enum: ["chat", "plan", "list"] },
  }),
};
