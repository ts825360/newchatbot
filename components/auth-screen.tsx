"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Eye, EyeOff, KeyRound, LoaderCircle, LockKeyhole, UserRound, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createBrowserAuth, validateSignup, type AdminGrade, type SignupErrors, type SignupInput } from "@/lib/prototype-auth";
import { isBackendConnected } from "@/lib/backend-client";
import { usePrototypeTheme } from "@/lib/use-theme";
import { AuthReference } from "./login-reference";

type AuthMode = "signup" | "login";
const emptySignup: SignupInput = { inviteCode: "", name: "", username: "", password: "", confirmation: "" };

export function AuthScreen({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  usePrototypeTheme();
  const [values, setValues] = useState<SignupInput>(() => ({ ...emptySignup, username: mode === "login" && !isBackendConnected() ? "admin" : "" }));
  const [errors, setErrors] = useState<SignupErrors>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [invite, setInvite] = useState<{ grade: AdminGrade; expiresAt: string | null } | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const verification = useRef(0);

  useEffect(() => {
    if (mode !== "signup") return;
    const code = new URLSearchParams(window.location.hash.slice(1)).get("invite");
    if (code) {
      setValues(current => ({ ...current, inviteCode: code.slice(0, 100) }));
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
    return () => { verification.current++; };
  }, [mode]);

  useEffect(() => {
    if (mode !== "login") return;
    try {
      const hint = createBrowserAuth().signupHint();
      if (hint) {
        setValues((current) => ({ ...current, username: hint.username }));
        setNotice(`${hint.name}님, 가입이 완료되었습니다. 로그인해 주세요.`);
      }
    } catch (cause) { setError(cause instanceof Error && isBackendConnected() ? cause.message : "브라우저 저장소를 사용할 수 없습니다. 사이트 저장소를 허용해 주세요."); }
  }, [mode]);

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  const update = (field: keyof SignupInput, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setError("");
    if (field === "inviteCode") { verification.current++; setInvite(null); }
  };

  const verifyInvite = async () => {
    const request = ++verification.current;
    try {
      const result = await createBrowserAuth().checkInvite(values.inviteCode);
      if (request !== verification.current) return;
      if (!result.ok) {
        setInvite(null);
        setErrors((current) => ({ ...current, inviteCode: result.error }));
      } else {
        setInvite(result);
        setErrors((current) => ({ ...current, inviteCode: undefined }));
      }
    } catch (cause) {
      if (request !== verification.current) return;
      setInvite(null);
      setError(cause instanceof Error && isBackendConnected() ? cause.message : "브라우저 저장소를 사용할 수 없습니다. 사이트 저장소를 허용해 주세요.");
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current) return;
    const validation: SignupErrors = mode === "signup" ? validateSignup(values) : {
      ...(!values.username.trim() ? { username: "아이디를 입력해 주세요." } : {}),
      ...(!values.password ? { password: "비밀번호를 입력해 주세요." } : {})
    };
    setErrors(validation);
    setError("");
    if (Object.keys(validation).length) {
      const first = Object.keys(validation)[0];
      document.getElementById(`auth-${first}`)?.focus();
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      const auth = createBrowserAuth();
      if (mode === "signup") {
        await auth.signup(values);
        router.push("/login");
      } else {
        await auth.login(values.username, values.password);
        router.replace("/rooms");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "요청을 처리하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const login = mode === "login";
  const usernameInput = <input id="auth-username" className="auth-input" value={values.username} onChange={(event) => update("username", event.target.value)} placeholder={login ? "아이디를 입력하세요" : "아이디 입력"} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={24} aria-invalid={!!errors.username} aria-describedby={errors.username ? "error-username" : mode === "signup" ? "hint-username" : undefined} />;
  return <AuthReference mode={mode}>
    <section className="auth-panel" aria-labelledby="auth-title">
      <div className="auth-heading">
        <h1 id="auth-title">{login ? "로그인" : "회원가입"}</h1>
        <p>{login ? "가입한 계정으로 접속해 주세요." : "관리자에게 받은 초대코드로 가입해 주세요."}</p>
      </div>

      {notice && <div className="auth-notice" role="status"><Check size={17} aria-hidden="true" /><span>{notice}</span></div>}
      <form className="auth-form" onSubmit={submit} noValidate aria-busy={busy}>
        <fieldset disabled={busy} className="auth-fieldset">
          {mode === "signup" && (
            <>
              <AuthField name="inviteCode" label="초대코드" error={errors.inviteCode}>
                <div className="auth-input-row">
                  <AuthInputFrame icon={KeyRound}>
                    <input id="auth-inviteCode" className="auth-input auth-code-input" value={values.inviteCode} onChange={(event) => update("inviteCode", event.target.value)} placeholder="초대코드 입력" autoComplete="off" spellCheck={false} maxLength={100} aria-invalid={!!errors.inviteCode} aria-describedby={errors.inviteCode ? "error-inviteCode" : undefined} />
                  </AuthInputFrame>
                  <button type="button" className="auth-verify" onClick={verifyInvite} aria-label="초대코드 확인">확인</button>
                </div>
              </AuthField>
              {invite && <div className="auth-invite-result" role="status"><KeyRound size={16} aria-hidden="true" /><div><strong>제{invite.grade}관리자 초대</strong><span>{invite.expiresAt ? `이용 기간: ${formatExpiry(invite.expiresAt)}까지` : "정기 만료 없음"}</span></div><Check size={16} className="ml-auto" aria-hidden="true" /></div>}
              <AuthField name="name" label="이름" error={errors.name}>
                <AuthInputFrame icon={UserRound}>
                  <input id="auth-name" className="auth-input" value={values.name} onChange={(event) => update("name", event.target.value)} placeholder="예: 차량담당_홍길동" autoComplete="nickname" maxLength={20} aria-invalid={!!errors.name} aria-describedby={errors.name ? "error-name" : undefined} />
                </AuthInputFrame>
              </AuthField>
            </>
          )}
          <AuthField name="username" label="아이디" error={errors.username} hint={mode === "signup" ? "영문·숫자·밑줄·하이픈 4~24자" : undefined}>
            <AuthInputFrame icon={UserRound}>{usernameInput}</AuthInputFrame>
          </AuthField>
          <PasswordField name="password" label="비밀번호" value={values.password} onChange={(value) => update("password", value)} error={errors.password} signup={mode === "signup"} />
          {mode === "signup" && <PasswordField name="confirmation" label="비밀번호 확인" value={values.confirmation} onChange={(value) => update("confirmation", value)} error={errors.confirmation} signup />}
        </fieldset>
        {error && <div className="auth-error-summary" role="alert" tabIndex={-1} ref={errorRef}>{error}</div>}
        <button type="submit" className="auth-submit" disabled={busy}>
          {busy && <LoaderCircle size={17} className="animate-spin" aria-hidden="true" />}
          {busy ? "처리 중…" : mode === "signup" ? "회원가입" : "로그인"}
          {!busy && <ArrowRight className="login-submit-arrow" size={27} aria-hidden="true" />}
        </button>
      </form>
      <div className="auth-switch">
        <span>{mode === "signup" ? "이미 계정이 있으신가요?" : "아직 계정이 없으신가요?"}</span>
        <Link href={mode === "signup" ? "/login" : "/signup"}>{mode === "signup" ? "로그인" : "회원가입"}</Link>
      </div>
    </section>
    {!isBackendConnected() && <p className="auth-demo-warning">프로토타입 · 실제 비밀번호를 사용하지 마세요.</p>}
  </AuthReference>;
}

function AuthField({ name, label, error, hint, children }: { name: string; label: string; error?: string; hint?: string; children: ReactNode }) {
  return <div className="auth-field"><label htmlFor={`auth-${name}`}>{label}</label>{children}{error ? <p id={`error-${name}`} className="auth-field-error">{error}</p> : hint ? <p id={`hint-${name}`} className="auth-hint">{hint}</p> : null}</div>;
}

function AuthInputFrame({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return <div className="login-input-wrap"><Icon className="login-field-icon" size={29} aria-hidden="true" />{children}</div>;
}

function PasswordField({ name, label, value, onChange, error, signup }: { name: string; label: string; value: string; onChange: (value: string) => void; error?: string; signup: boolean }) {
  const [visible, setVisible] = useState(false);
  const action = `${label} ${visible ? "숨기기" : "표시"}`;
  const VisibilityIcon = visible ? Eye : EyeOff;
  return <AuthField name={name} label={label} error={error}>
    <div className="auth-password-wrap">
      <LockKeyhole className="login-field-icon" size={29} aria-hidden="true" />
      <input id={`auth-${name}`} className="auth-input" type={visible ? "text" : "password"} value={value} onChange={(event) => onChange(event.target.value)} placeholder={name === "confirmation" ? "비밀번호 다시 입력" : signup ? "8자 이상 입력" : "비밀번호를 입력하세요"} autoComplete={signup ? "new-password" : "current-password"} maxLength={72} aria-invalid={!!error} aria-describedby={error ? `error-${name}` : undefined} />
      <button type="button" className="auth-password-toggle" aria-label={action} title={action} aria-pressed={visible} onClick={() => setVisible((current) => !current)}><VisibilityIcon size={signup ? 17 : 26} aria-hidden="true" /></button>
    </div>
  </AuthField>;
}

function formatExpiry(value: string) {
  const date = new Date(Date.parse(value) - 1);
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric" }).format(date);
}
