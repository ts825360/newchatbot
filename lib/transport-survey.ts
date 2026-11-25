import { parse } from "csv-parse/browser/esm/sync";
import { personTripPatch, resolveTransportEntries, type TransportInput, type TransportPerson } from "./transport";

export const MAX_SURVEY_BYTES = 128 * 1024;
export type SurveyData = { headers: string[]; rows: string[][] };
export const surveyFields = { attendance: "참석 여부", name: "이름", department: "소속", family: "가족 ID", outbound: "출발 팀", return: "귀가편", outboundCompanion: "출발 필수 동반", returnCompanion: "귀가 필수 동반", movement: "이동수단", lodging: "숙소 배정", notes: "기타 특이사항" } as const;
type Field = keyof typeof surveyFields;
export type SurveyMapping = Record<"attendance" | "name", number> & Partial<Record<Field, number>>;
export type TransportSurvey = { data: SurveyData; mapping: SurveyMapping; source?: { formId: string; personIds: string[] } };

const fields = Object.keys(surveyFields) as Field[];
const aliases: Record<Field, string[]> = {
  attendance: ["참석여부", "참가여부", "수련회참석여부", "수련회참가여부", "참석하시나요", "참석여부를선택해주세요", "attendance"],
  name: ["이름", "성명", "참가자이름", "참석자이름", "name"],
  department: ["소속", "기관", "소속기관", "부서", "department"],
  outbound: ["출발", "출발팀", "출발편", "출발그룹", "출발팀구성", "팀", "팀명", "팀구성", "team", "outbound"],
  return: ["귀가", "귀가편", "귀가팀", "복귀", "복귀편", "return"],
  family: ["가족id", "가족코드", "가족식별코드", "familyid"],
  outboundCompanion: ["출발필수동반", "출발동반묶음"],
  returnCompanion: ["귀가필수동반", "귀가동반묶음"],
  movement: ["이동수단", "교통수단", "자차이동여부", "이동방법", "transport"],
  lodging: ["숙소배정", "숙소", "숙소배정방식", "숙소배정희망"],
  notes: ["기타", "특이사항", "기타특이사항", "비고", "이동특이사항", "notes"],
};
const normalized = (word: string) => word.normalize("NFKC").trim().toLowerCase().replace(/[\s?!._:·*-]/g, "");
const boundedText = (value: unknown, limit: number): value is string => typeof value === "string" && value.length <= limit && !value.includes("\u0000");

export function isSurveyData(value: unknown): value is SurveyData {
  if (!value || typeof value !== "object") return false;
  const { headers, rows } = value as SurveyData;
  return Array.isArray(headers) && headers.length >= 2 && headers.length <= 40
    && headers.every((cell) => boundedText(cell, 500))
    && Array.isArray(rows) && rows.length > 0 && rows.length <= 500
    && rows.every((row) => Array.isArray(row) && row.length === headers.length && row.every((cell) => boundedText(cell, 4000)))
    && new TextEncoder().encode(JSON.stringify({ headers, rows })).length <= 2 * MAX_SURVEY_BYTES;
}

export function parseSurveyCsv(csv: string): SurveyData {
  let table: string[][];
  try {
    table = parse(csv, { bom: true, skip_empty_lines: true, max_record_size: 16000 });
  } catch {
    throw new Error("CSV 열 개수나 따옴표 형식이 올바르지 않습니다.");
  }
  const [headers, ...rows] = table;
  const data = { headers, rows: rows.filter((row) => row.some((cell) => cell.trim())) };
  if (!isSurveyData(data)) throw new Error("질문 열 2~40개, 응답 1~500개인 UTF-8 CSV인지 확인해 주세요.");
  return data;
}

export function defaultSurveyMapping(headers: string[]): SurveyMapping {
  return Object.fromEntries(fields.map((field) => {
    const matches = headers.map((name, index) => aliases[field].includes(normalized(name)) ? index : -1).filter((i) => i >= 0);
    return [field, matches.length === 1 ? matches[0] : -1];
  })) as SurveyMapping;
}

function surveyStatus(value: string): "attending" | "absent" | "unresolved" {
  const answer = normalized(value);
  if (["o", "○", "⭕", "예", "네", "참가", "참석", "참가합니다", "참석합니다", "참가예정", "참석예정", "yes"].includes(answer)) return "attending";
  if (["x", "×", "❌", "아니오", "아니요", "불참", "불참합니다", "참석안함", "참가안함", "참석하지않습니다", "참가하지않습니다", "미참석", "미참가", "no"].includes(answer)) return "absent";
  return "unresolved";
}

export function analyzeSurvey(data: SurveyData, mapping: SurveyMapping) {
  const selected = fields.map((key) => mapping[key] ?? -1).filter((i) => i >= 0);
  const mapped = mapping.name >= 0 && mapping.attendance >= 0 && new Set(selected).size === selected.length;
  const counts = { attending: 0, absent: 0, unresolved: 0 };
  const identities = new Map<string, number>();
  const entries = data.rows.map((cells, index) => {
    const cell = (key: Field) => cells[mapping[key] ?? -1]?.trim() ?? "";
    const name = cell("name"), department = cell("department") || "미분류", familyId = cell("family");
    const outbound = cell("outbound"), returnPlan = cell("return"), movement = cell("movement"), lodging = cell("lodging"), notes = cell("notes");
    const outboundCompanion = cell("outboundCompanion"), returnCompanion = cell("returnCompanion");
    const independent = ["왕복자차", "왕복개별이동"].includes(normalized(movement));
    const movementReview = !!movement && !independent && !["교회차량", "버스", "교회버스", "단체이동"].includes(normalized(movement));
    const attendance = surveyStatus(cell("attendance"));
    const status = attendance === "attending" && (!name || name.length > 80 || [department, familyId, outboundCompanion, returnCompanion].some((value) => value.length > 40)
      || [outbound, returnPlan].some((value) => value.length > 120) || [movement, lodging].some((value) => value.length > 200)) ? "unresolved" : attendance;
    const identity = JSON.stringify([normalized(name), normalized(department)]);
    if (status === "attending") identities.set(identity, (identities.get(identity) ?? 0) + 1);
    counts[status]++;
    return { cells, index, status, name, department, familyId, outbound, returnPlan, outboundCompanion, returnCompanion, movement, lodging, notes, independent, movementReview, identity };
  });
  return { counts, canImport: mapped && !counts.unresolved && counts.attending <= 250,
    entries: entries.map(({ identity, ...entry }) => ({ ...entry, duplicate: entry.status === "attending" && (identities.get(identity) ?? 0) > 1 })) };
}

export function isTransportSurvey(value: unknown): value is TransportSurvey {
  if (!value || typeof value !== "object") return false;
  const { data, mapping, source } = value as TransportSurvey;
  return isSurveyData(data) && !!mapping && fields.every((field) => {
    const index = mapping[field] ?? -1;
    return Number.isInteger(index) && index >= -1 && index < data.headers.length;
  }) && (source === undefined || validGoogleSurveySource(source, data.rows.length))
    && analyzeSurvey(data, mapping).canImport;
}

export function validGoogleSurveySource(source: unknown, count: number): source is NonNullable<TransportSurvey["source"]> {
  if (!source || typeof source !== "object") return false;
  const { formId, personIds } = source as NonNullable<TransportSurvey["source"]>;
  return typeof formId === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(formId) && Array.isArray(personIds) && personIds.length === count
    && new Set(personIds).size === count && personIds.every((key) => typeof key === "string" && /^GF-[a-f0-9]{44}$/.test(key));
}

function surveyPerson(input: TransportInput, entry: ReturnType<typeof analyzeSurvey>["entries"][number], id: string): TransportPerson {
  return {
    id, name: entry.name, department: entry.department, familyId: entry.familyId, companionGroup: "",
    outboundTripId: entry.independent ? null : input.trips.find((t) => t.id === "main" && t.direction === "outbound")?.id ?? input.extraOutboundTripId,
    returnTripId: entry.independent ? null : input.trips.find((t) => t.id === "normal" && t.direction === "return")?.id ?? input.extraReturnTripId,
    ...(entry.outbound ? personTripPatch(input.trips, "outbound", entry.outbound) : {}),
    ...(entry.returnPlan ? personTripPatch(input.trips, "return", entry.returnPlan) : {}),
    outboundCompanionGroup: entry.outboundCompanion, returnCompanionGroup: entry.returnCompanion,
    movement: entry.movement, lodging: entry.lodging, notes: entry.notes,
  };
}

export function mergeGoogleSurvey(input: TransportInput, survey: TransportSurvey): TransportInput {
  if (!survey.source || !isTransportSurvey(survey)) throw new Error("연결한 설문과 문항을 확인해 주세요.");
  const existing = new Set(input.people.map((p) => p.id));
  const additions = analyzeSurvey(survey.data, survey.mapping).entries.flatMap((entry) => {
    const id = survey.source!.personIds[entry.index];
    return entry.status === "attending" && !existing.has(id) ? [surveyPerson(input, entry, id)] : [];
  });
  if (input.people.length + additions.length > 250) throw new Error("기존 명단과 합쳐 최대 250명까지 배정할 수 있습니다.");
  if (!additions.length) return input;
  return resolveTransportEntries({ ...input, revision: input.revision + 1, people: [...input.people, ...additions], previousAssignments: [] });
}

export function surveyTransportInput(input: TransportInput, survey: ReturnType<typeof analyzeSurvey>, makeId = () => crypto.randomUUID()): TransportInput {
  if (!survey.canImport) throw new Error("확인 필요한 응답과 참석 인원 범위를 확인해 주세요.");
  const people = survey.entries.filter((entry) => entry.status === "attending").map((entry) => surveyPerson(input, entry, makeId()));
  // A newly imported roster cannot safely inherit old person IDs or individual driver assignments.
  const vehicles = input.vehicles.map((vehicle) => vehicle.driverId === null ? vehicle : { ...vehicle, driverId: null, externalDriverConfirmed: false });
  return resolveTransportEntries({ ...input, revision: input.revision + 1, people, vehicles, locks: [], previousAssignments: [] });
}
