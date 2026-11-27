"use client";

import { scopeId, type ConversationScope } from "@/lib/conversation-scope";
import { retreatSurveyTemplate } from "@/lib/retreat-survey-template";
import { surveyTemplateVersion, type SurveyDraft } from "@/lib/chat-survey-draft";
import type { ReactNode } from "react";
import { GoogleFormDraftActions } from "./google-form-draft-actions";

const branchLabels = { NEXT_SECTION: "참석자 정보로 이동", SUBMIT_FORM: "설문 제출" };

export function ChatSurveyProposal({ scope, title, draft, reviewAnswer }: { scope: ConversationScope; title: string; draft?: SurveyDraft; reviewAnswer?: ReactNode }) {
  const { roomId, conversationId } = scope;
  const items = draft?.items ?? retreatSurveyTemplate;
  const sections = new Map(items.filter(item => item.kind === "section").map(item => [item.id, item.title]));
  const showSections = draft?.templateVersion === surveyTemplateVersion;

  return <section aria-label="수련회 설문 미리보기" className={reviewAnswer ? "grid w-full min-w-0 gap-3" : "grid w-full min-w-0 gap-3 border-t border-border pt-3"}>
    {reviewAnswer ? <>
      <header className="chat-work-heading"><h3>{title}</h3><span className="chat-work-status">{draft ? `초안 v${draft.version}` : "이전 미리보기"}</span></header>
      <p className="proposal-destination">반영 위치: Google Forms 미게시 초안</p>
    </> : <header className="flex flex-wrap items-center gap-2"><h4 className="break-words text-sm font-semibold">{title}</h4>
      {draft && <span className="text-xs text-muted-foreground">검토 버전 {draft.version}</span>}</header>}
    {draft?.description && <p className="break-words text-sm">{draft.description}</p>}
    <ol className="list-decimal space-y-2 break-words pl-5 text-sm">
      {items.map((item, index) => item.kind !== "section" && <li key={item.id}>
        {showSections && items[index - 1]?.kind === "section" && <p className="text-xs font-medium text-muted-foreground">{items[index - 1].title}</p>}
        <span className="font-medium">{item.title}</span>
        {item.required && <span className="ml-2 text-xs text-muted-foreground">필수</span>}
        <p className="text-xs text-muted-foreground">
          {item.kind === "choice"
            ? item.options.map(({ value, isOther, goToAction, goToSection }) => {
              const destination = goToSection && sections.get(goToSection);
              const route = destination ? `이동: ${destination}` : goToAction && branchLabels[goToAction];
              const details = [isOther && "직접 입력", route].filter(Boolean);
              return details.length ? `${value} (${details.join(", ")})` : value;
            }).join(" · ")
            : item.paragraph ? "장문형" : "단답형"}
        </p>
        {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
      </li>)}
    </ol>
    {reviewAnswer}
    {draft ? <GoogleFormDraftActions key={JSON.stringify([scopeId(scope), draft.id, draft.version])} scope={{ roomId, conversationId }} initialTitle={title}
      work={{ workId: draft.id, version: draft.version }} initiallyExpanded />
      : <p className="text-xs text-muted-foreground">이전 미리보기입니다. 이 초안을 다시 연 뒤 검토한 버전을 Google Forms에 생성할 수 있습니다.</p>}
  </section>;
}
