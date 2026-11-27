import { isAdvisorPresentation } from "./chat-advisor";
import { chatWorkResultText, isChatWorkResult, toolWorkflowLimited, toolWorkflowLimitedText } from "./chat-work-result";
import { isDiningRecommendations } from "./chat-dining";
import { retreatSurveyTemplate } from "./retreat-survey-template";
import { timetableTime } from "./timetable";
import type { ChatMessage } from "./types";

export function chatCopyText(message: ChatMessage) {
  if (message.sender !== "assistant") return message.text;
  const lines: string[] = [];
  if (isChatWorkResult(message.workResult)) lines.push(chatWorkResultText(message.workResult));
  if (message.actions?.includes(toolWorkflowLimited)) lines.push(toolWorkflowLimitedText);
  const plan = isAdvisorPresentation(message.advisor) && message.advisor.kind !== "chat" ? message.advisor : null;
  const dining = isDiningRecommendations(message.dining) ? message.dining : null;
  if (dining) lines.push(dining.kind === "attraction" ? "주변 관광지 추천" : "주변 식당 추천");
  else if (plan && (!message.workProposal || message.workResult)) lines.push(plan.title);
  lines.push(message.text);
  if (plan) lines.push(...plan.rows.map((row, index) => `${plan.kind === "list" ? `${index + 1}. ` : ""}${row.label}: ${row.detail}`), plan.rationale);
  if (dining) dining.restaurants.forEach((item, index) => {
    lines.push(`${dining.selectedRank ?? index + 1}순위 ${item.name}`, item.reason);
    if (item.address) lines.push(`주소: ${item.address}`);
    lines.push(`운영시간: ${item.hours}`);
    if (item.closures) lines.push(`휴무: ${item.closures}`);
    if (item.feature) lines.push(item.feature.text);
    if (item.route) lines.push(`숙소에서 이동: ${item.route.distanceKm ?? "미확인"} km · ${item.route.durationMinutes ?? "미확인"}분`);
    if (item.rating) lines.push(`평점: ${item.rating.value}/5`);
    lines.push(...item.sources.map(source => `${source.label}: ${source.url}`));
  });
  const work = message.workProposal;
  if (work?.kind === "survey") {
    lines.push(work.title, work.draft?.description ?? "");
    const items = (work.draft?.items ?? retreatSurveyTemplate).filter(item => item.kind !== "section");
    items.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.title}${item.required ? " (필수)" : ""}`);
      if (item.kind === "choice") lines.push(item.options.map(option => [option.value, option.isOther ? "직접 입력" : "",
        option.goToAction === "NEXT_SECTION" ? "참석자 정보로 이동" : option.goToAction === "SUBMIT_FORM" ? "설문 제출" : ""].filter(Boolean).join(" · ")).join(" / "));
      else lines.push(item.paragraph ? "장문형" : "단답형");
      if (item.description) lines.push(item.description);
    });
  } else if (work?.kind === "calendar") {
    lines.push("공동 캘린더 추가 제안", work.title, `${work.date} · ${work.time || "시간 미정"}`);
  } else if (work?.kind === "checklist") {
    lines.push("준비 체크리스트 추가 제안", "확인 완료", ...work.confirmed.map(title => `- ${title}`), "추가 확인 필요", ...work.items.map(title => `- ${title}`));
  } else if (work?.kind === "timetable") {
    lines.push("타임테이블 추가 제안");
    const ordered = [...work.plan.entries].sort((a, b) => a.day - b.day || a.start - b.start);
    lines.push(...ordered.map(entry => `${entry.day}일차 ${timetableTime(entry.start)}–${timetableTime(entry.end)} ${entry.title}`));
  }
  return lines.filter(Boolean).join("\n");
}
