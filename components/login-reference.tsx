import Link from "next/link";
import { CalendarDays, IdCard, KeyRound, ShieldCheck, Sparkles, UsersRound } from "lucide-react";
import type { ReactNode } from "react";
import "./login-reference.css";

const highlights = [
  { icon: CalendarDays, title: "일정과 준비 현황을 한눈에", detail: "공동 캘린더와 체크리스트로 빠짐없이 준비해요" },
  { icon: UsersRound, title: "참가자와 차량을 효율적으로", detail: "설문 취합부터 차량 배정까지 한 번에" },
  { icon: Sparkles, title: "기록을 바탕으로 더 나은 준비", detail: "이전 행사 기록을 참고해 놓치는 준비 없이" },
];

const signupNotes = [
  { icon: KeyRound, title: "초대코드가 있어야 가입할 수 있어요", detail: "관리자에게 받은 초대코드를 입력해 주세요." },
  { icon: ShieldCheck, title: "아이디와 비밀번호는 공유하지 마세요", detail: "계정은 본인만 사용해 주세요." },
  { icon: IdCard, title: "표시 이름은 ‘담당 역할_이름’으로 적어 주세요", detail: "예: 차량담당_홍길동. 표시 이름은 권한 설정과 별개예요." },
];

export function AuthReference({ mode, children }: { mode: "login" | "signup"; children: ReactNode }) {
  const signup = mode === "signup";
  return <main className={`auth-page auth-reference-page auth-${mode}-page`}>
    <div className="login-layout">
      <div className="login-intro-column">
        <Link href="/" className="login-wordmark" aria-label="행사비서 홈">
          <svg viewBox="0 0 72 76" className="login-book" aria-hidden="true">
            <defs>
              <linearGradient id="login-book-cover" x1="0" y1="0" x2="1" y2="1">
                <stop stopColor="#8585ee" /><stop offset="1" stopColor="#443be3" />
              </linearGradient>
            </defs>
            <path d="M16 1h33l21 20v40c0 8-6 14-14 14H16C7 75 1 69 1 60V17C1 8 7 1 16 1Z" fill="#8d91eb" />
            <path d="M15 58h41c6 0 10-4 11-8v10c0 6-4 11-11 11H15c-4 0-7-3-7-6s3-7 7-7Z" fill="#f8f8ff" />
            <path d="M16 1h33l21 20v22c0 9-5 15-14 15H16C7 58 1 64 1 67V17C1 8 7 1 16 1Z" fill="url(#login-book-cover)" />
            <path d="M49 2v12c0 5 3 8 8 8h12" fill="#aca8ff" opacity=".48" />
            <path d="M32 15v32M19 29h26" stroke="white" strokeWidth="6" />
          </svg>
          <span>행사비서</span>
        </Link>
        <section className="login-intro" aria-labelledby="login-intro-title">
          <h2 id="login-intro-title">{signup ? "가입 전 확인해 주세요" : <>교회 행사를 더 체계적이고<br />함께 준비하세요</>}</h2>
          {!signup && <p>수련회, 부흥회, 예배 등 교회의 다양한 행사를 <br className="login-intro-break" />한 곳에서 준비하고 운영할 수 있는 협업 공간입니다.</p>}
          <ul className="login-highlights">
            {(signup ? signupNotes : highlights).map(({ icon: Icon, title, detail }) => (
              <li key={title}>
                <span className="login-highlight-icon"><Icon size={34} strokeWidth={1.8} aria-hidden="true" /></span>
                <div><strong>{title}</strong><p>{detail}</p></div>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <div className="login-form-column">{children}</div>
    </div>
  </main>;
}
