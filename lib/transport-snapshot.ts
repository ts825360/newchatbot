import { isTransportComparison, type TransportComparison } from "./transport-comparison";
import { isTransportSurvey, type TransportSurvey } from "./transport-survey";
import { isTransportResult, validateTransportInput, validateTransportResult, type TransportInput, type TransportResult } from "./transport";
import { isLodgingPlan, type LodgingPlan } from "./lodging-plan";
import { isTransportVersionLedger, type TransportVersionLedger } from "./transport-versions";

export type TransportSnapshot = { input: TransportInput; result: TransportResult | null; baseline: TransportResult | null; approved: boolean; demo?: boolean; survey?: TransportSurvey; comparison?: TransportComparison; lodgingPlan?: LodgingPlan; rosterConfirmation?: string; versions?: TransportVersionLedger };

export function parseTransportSnapshot(raw: string): TransportSnapshot {
  const value = JSON.parse(raw) as TransportSnapshot;
  if (validateTransportInput(value?.input, { draft: true }).length || (value.result && !isTransportResult(value.result)) || (value.baseline && !isTransportResult(value.baseline)) || typeof value.approved !== "boolean" || (value.survey !== undefined && !isTransportSurvey(value.survey))) throw new Error("저장 형식 오류");
  if (value.comparison !== undefined && !isTransportComparison(value.comparison)) throw new Error("저장된 비교안 형식 오류");
  if (value.lodgingPlan !== undefined && !isLodgingPlan(value.lodgingPlan)) throw new Error("숙소 배정 저장 형식 오류");
  if (value.rosterConfirmation !== undefined && (typeof value.rosterConfirmation !== "string" || value.rosterConfirmation.length > 65000)) throw new Error("명단 확인 기록 형식 오류");
  if (value.versions !== undefined && !isTransportVersionLedger(value.versions)) throw new Error("배정 버전 기록 형식 오류");
  const demo = value.demo ?? value.input.people.some((person) => /^가상참가자 \d+$/.test(person.name));
  const approved = value.approved && !!value.result && validateTransportResult(value.input, value.result).length === 0;
  return { ...value, demo, baseline: value.baseline ?? null, approved };
}
