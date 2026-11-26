"use client";

import { scopeId, type ConversationScope } from "@/lib/conversation-scope";
import { retreatSurveyTemplate } from "@/lib/retreat-survey-template";
import { GoogleFormDraftActions } from "./google-form-draft-actions";

const branchLabels = { NEXT_SECTION: "참석자 정보로 이동", SUBMIT_FORM: "설문 제출" };

export function ChatSurveyProposal({ scope, title }: { scope: ConversationScope; title: string }) {
  const { roomId, conversationId } = scope;

  return <section aria-label="수련회 설문 미리보기" className="grid w-full min-w-0 gap-3 border-t border-border pt-3">
    <h4 className="break-words text-sm font-semibold">{title}</h4>
    <ol className="list-decimal space-y-2 pl-5 text-sm">
      {retreatSurveyTemplate.map(item => item.kind !== "section" && <li key={item.title}>
        <span className="font-medium">{item.title}</span>
        {item.required && <span className="ml-2 text-xs text-muted-foreground">필수</span>}
        <p className="text-xs text-muted-foreground">
          {item.kind === "choice"
            ? item.options.map(({ value, goToAction }) => goToAction ? `${value} (${branchLabels[goToAction]})` : value).join(" · ")
            : item.paragraph ? "장문형" : "단답형"}
        </p>
        {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
      </li>)}
    </ol>
    <GoogleFormDraftActions key={JSON.stringify([scopeId(scope), title])} scope={{ roomId, conversationId }} initialTitle={title} initiallyExpanded />
  </section>;
}
