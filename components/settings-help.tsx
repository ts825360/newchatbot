"use client";

import { ArrowLeft, BookOpen, CalendarDays, ChevronRight, ClipboardList, Copy, FileText, Link2, ListChecks, MessageSquare, Rocket, ShieldCheck, Truck } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { helpFaqs, helpGuides, type HelpGuideId } from "@/lib/settings-help-data";
import { SupportButton, SupportEmail } from "./support-dialog";
import { Button } from "./ui";
import "./settings-help.css";

const guideIcons = {
  start: Rocket,
  assistant: MessageSquare,
  schedule: CalendarDays,
  prepare: ClipboardList,
  survey: ListChecks,
  transport: Truck,
  materials: FileText,
  integrations: Link2,
  account: ShieldCheck,
};
const guideIds = Object.keys(helpGuides) as HelpGuideId[];

function HelpExamples({ examples }: { examples: NonNullable<(typeof helpGuides)[HelpGuideId]["examples"]> }) {
  const [notice, setNotice] = useState("");
  async function copyExample(prompt: string) {
    try {
      await navigator.clipboard.writeText(prompt);
      setNotice("예시를 복사했습니다.");
    } catch {
      setNotice("복사할 수 없습니다. 예시를 직접 선택해서 복사해 주세요.");
    }
  }
  return <section className="settings-help-detail-section">
    <h4>AI 요청 예시</h4>
    <ul className="settings-help-examples">
      {examples.map(({ prompt, context }, index) => <li key={prompt}>
        <div><p>{prompt}</p>{context && <small>{context}</small>}</div>
        <button type="button" className="settings-help-copy" aria-label={`${index + 1}번 예시 복사`} title="예시 복사" onClick={() => void copyExample(prompt)}>
          <Copy size={16} aria-hidden="true" />
        </button>
      </li>)}
    </ul>
    <p className="settings-help-notice" role="status">{notice}</p>
  </section>;
}

export function SettingsHelp({ screenName = "환경설정" }: { screenName?: string } = {}) {
  const id = useId();
  const [active, setActive] = useState<HelpGuideId | null>(null);
  const entry = useRef<HelpGuideId>("start");
  const focusNext = useRef(false);
  const launcher = useRef<HTMLButtonElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    (active ? title.current : launcher.current)?.focus();
  }, [active]);

  const openGuide = (key: HelpGuideId) => {
    if (key === active) return;
    if (!active) entry.current = key;
    focusNext.current = true;
    setActive(key);
  };
  const back = () => { focusNext.current = true; setActive(null); };
  const current = active && helpGuides[active];

  return <div className="settings-help">
    {active && current ? <div className="settings-help-reader">
      <div className="settings-help-reader-top">
        <Button type="button" variant="ghost" onClick={back}><ArrowLeft size={16} aria-hidden="true" />사용설명서 목록</Button>
      </div>
      <div className="settings-help-reader-body">
        <nav className="settings-help-toc" aria-label="사용설명서 목차">
          <h4>사용설명서 목차</h4>
          <ul>{guideIds.map(key => <li key={key}><button type="button" aria-current={active === key ? "true" : undefined}
            onClick={() => openGuide(key)}>{helpGuides[key].title}</button></li>)}</ul>
        </nav>
        <div className="settings-help-picker">
          <label htmlFor={`${id}-picker`}>사용설명서 항목</label>
          <select id={`${id}-picker`} value={active} onChange={event => setActive(event.target.value as HelpGuideId)}>
            {guideIds.map(key => <option value={key} key={key}>{helpGuides[key].title}</option>)}
          </select>
        </div>
        <article className="settings-help-article" aria-labelledby={`${id}-title`}>
          <header>
            <h3 id={`${id}-title`} ref={title} tabIndex={-1}>{current.title}</h3>
            <p>{current.summary}</p>
          </header>
          <section className="settings-help-detail-section">
            <h4>사용 방법</h4>
            <ol className="settings-help-steps">{current.steps.map(step => <li key={step}>{step}</li>)}</ol>
          </section>
          {current.note && <section className="settings-help-detail-section settings-help-note"><h4>알아두세요</h4><p>{current.note}</p></section>}
          {current.examples && <HelpExamples key={active} examples={current.examples} />}
          <section className="settings-help-detail-section">
            <h4>관련 기능</h4>
            <div className="settings-help-actions">{current.related.map(key => <Button type="button" key={key} variant="outline" onClick={() => openGuide(key)}>
              {helpGuides[key].title}<ChevronRight size={14} aria-hidden="true" />
            </Button>)}</div>
          </section>
        </article>
      </div>
    </div> : <>
      <section className="settings-help-start" aria-labelledby={`${id}-start`}>
        <span className="settings-help-icon" data-kind="start"><Rocket size={23} aria-hidden="true" /></span>
        <div><h3 id={`${id}-start`}>처음 사용하시나요?</h3><p>행사방 만들기부터 일정과 준비 항목을 등록하는 첫 단계까지 확인하세요.</p></div>
        <button type="button" className="settings-help-start-action" ref={entry.current === "start" ? launcher : undefined} onClick={() => openGuide("start")}>
          시작 가이드 보기<ChevronRight size={16} aria-hidden="true" />
        </button>
      </section>
      <section className="settings-help-section" aria-labelledby={`${id}-features`}>
        <h3 id={`${id}-features`}><BookOpen size={20} aria-hidden="true" />기능별 사용설명서</h3>
        <ul className="settings-help-grid">{guideIds.filter(key => key !== "start").map(key => {
          const guide = helpGuides[key];
          const Icon = guideIcons[key];
          return <li key={key}><button type="button" ref={entry.current === key ? launcher : undefined} className="settings-help-card" onClick={() => openGuide(key)}>
            <span className="settings-help-icon" data-kind={key}><Icon size={21} aria-hidden="true" /></span>
            <span><strong>{guide.title}</strong><small>{guide.summary}</small></span><ChevronRight size={16} aria-hidden="true" />
          </button></li>;
        })}</ul>
      </section>
      <section className="settings-help-section" aria-labelledby={`${id}-faq`}>
        <h3 id={`${id}-faq`}>자주 묻는 질문</h3>
        <div className="settings-help-faq">{helpFaqs.map(({ question, answer }) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div>
      </section>
      <section className="settings-help-section" aria-labelledby={`${id}-contact`}>
        <h3 id={`${id}-contact`}>문의 및 지원</h3>
        <p>가입이나 접근 권한은 초대코드를 발급한 관리자에게 확인해 주세요.</p>
        <SupportEmail />
        <SupportButton screenName={screenName} presentation="help-center" />
      </section>
    </>}
  </div>;
}
