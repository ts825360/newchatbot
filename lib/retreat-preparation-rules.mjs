const fields = [
  ["date", "행사 날짜"],
  ["venue", "행사 장소"],
  ["transport", "차량 배정"],
  ["lodging", "숙소 배정"],
  ["meals", "식사"],
  ["agenda", "행사 일정"],
  ["water-activity", "물놀이 계획"],
  ["water-safety", "물놀이 안전 담당"],
];

const tasks = [
  { id: "check-water-safety", label: "물놀이 안전 담당과 운영 가능 여부 확인", resolves: "water-safety", needs: ["water-activity"] },
  { id: "confirm-date", label: "회의에서 올해 행사 날짜 확정", resolves: "date", needs: ["meeting"] },
  { id: "draft-confirmed-notice", label: "확정 날짜와 장소를 반영한 공지문 초안 작성", needs: ["date", "venue"] },
  { id: "draft-survey", label: "확정되지 않은 정보를 비워 둔 참석 설문 초안 작성", needs: [] },
  { id: "compare-venues", label: "확정 날짜를 기준으로 장소 후보 검토", resolves: "venue", needs: ["date"] },
  { id: "review-minutes", label: "이전 행사 자료에서 올해 확인할 항목 정리", needs: [] },
];

const fieldKeys = new Set(fields.map(([key]) => key));
const taskIds = new Set(tasks.map(({ id }) => id));
const recordStatuses = new Set(["confirmed", "unverified", "deferred", "not_applicable"]);
const meetingStatuses = new Set(["available", "unavailable", "unknown"]);
const sources = new Set(["confirmed_record", "draft_note"]);
const recordId = value => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(value);

function requireInput(input) {
  if (!input || typeof input !== "object" || !recordId(input.editionId)) throw new TypeError("Invalid editionId");
  if (!Number.isInteger(input.year) || input.year < 1900 || input.year > 9999) throw new TypeError("Invalid year");
  if (!meetingStatuses.has(input.meeting)) throw new TypeError("Invalid meeting status");
  if (!Array.isArray(input.facts)) throw new TypeError("Invalid facts");
  if (!Array.isArray(input.completedTaskIds) || !input.completedTaskIds.every(id => taskIds.has(id))) {
    throw new TypeError("Invalid completedTaskIds");
  }
  if (input.referenceEditionIds !== undefined && (!Array.isArray(input.referenceEditionIds) ||
      !input.referenceEditionIds.every(id => recordId(id) && id !== input.editionId))) {
    throw new TypeError("Invalid referenceEditionIds");
  }
  for (const item of input.facts) {
    if (!item || !fieldKeys.has(item.key) || !recordId(item.editionId) || !recordId(item.ref) ||
        !sources.has(item.source) || !recordStatuses.has(item.status)) throw new TypeError("Invalid fact");
    if (item.status !== "confirmed") continue;
    const valid = item.key === "water-activity" ? typeof item.value === "boolean" :
      typeof item.value === "string" && item.value.trim().length > 0 && item.value.length <= 240;
    if (!valid) throw new TypeError(`Invalid value for ${item.key}`);
  }
}

const refsOf = records => [...new Set(records.map(({ ref }) => ref))].sort();
const clean = value => typeof value === "string" ? value.normalize("NFC").trim().replace(/\s+/g, " ") : value;

function validDate(value, year) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) !== year) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function stateFor(key, label, records, year) {
  const result = (status, reason, refs = []) => ({ key, label, status, reason, refs });
  const authoritative = records.filter(item => item.source === "confirmed_record" && item.status !== "unverified");
  const confirmed = authoritative.filter(item => item.status === "confirmed");
  const values = [...new Set(confirmed.map(item => clean(item.value)))];
  const states = new Set(authoritative.map(item => item.status));

  if (states.size > 1 || values.length > 1) return result("needs_review", "conflicting_records", refsOf(authoritative));
  if (values.length === 1) {
    if (key === "date" && !validDate(values[0], year)) return result("needs_review", "invalid_date", refsOf(confirmed));
    return { ...result("confirmed", "confirmed", refsOf(confirmed)), value: values[0] };
  }
  if (states.has("deferred")) return result("deferred", "administrative_hold", refsOf(authoritative));
  if (states.has("not_applicable")) return result("needs_review", "required_field", refsOf(authoritative));
  return records.length ? result("needs_review", "unverified", refsOf(records)) : result("needs_review", "missing");
}

export function evaluateRetreatPreparation(input) {
  requireInput(input);
  const { editionId, year, meeting } = input;
  const current = input.facts.filter(fact => fact.editionId === editionId);
  const approvedReference = new Set(input.referenceEditionIds ?? []);
  const hasReference = input.facts.some(fact => approvedReference.has(fact.editionId));
  const completed = new Set(input.completedTaskIds);
  const fieldStates = fields.map(([key, label]) => stateFor(key, label, current.filter(fact => fact.key === key), year));
  const water = fieldStates.find(item => item.key === "water-activity");
  const safety = fieldStates.find(item => item.key === "water-safety");
  if (water.status !== "confirmed" || water.value === false) {
    const notApplicable = water.status === "confirmed";
    // The activity decision is the evidence for whether the safety requirement applies.
    delete safety.value;
    Object.assign(safety, {
      status: notApplicable ? "not_applicable" : "deferred",
      reason: notApplicable ? "no_water_activity" : "water_plan_unconfirmed",
      refs: water.refs,
    });
  }

  const byKey = new Map(fieldStates.map(item => [item.key, item]));
  const available = [], deferred = [];
  for (const { id, label, needs, resolves } of tasks) {
    const field = resolves && byKey.get(resolves);
    if (field?.status === "confirmed" || field?.status === "not_applicable") continue;
    if (id === "review-minutes" && !hasReference) continue;
    // A prior completion marker cannot certify a missing date or a safety assignment.
    if (completed.has(id) && id !== "confirm-date" && id !== "check-water-safety") continue;

    const blockedBy = needs.flatMap(key => {
      if (key === "meeting") return meeting === "available" ? [] : [{ key, reason: `meeting_${meeting}` }];
      const state = byKey.get(key);
      return state.status === "confirmed" ? [] : [{ key, reason: state.reason }];
    });
    if (field?.reason === "administrative_hold") blockedBy.push({ key: resolves, reason: field.reason });
    if (blockedBy.length) deferred.push({ id, label, blockedBy });
    else available.push({ id, label });
  }

  return { fields: fieldStates, available, deferred, next: available.slice(0, 2) };
}
