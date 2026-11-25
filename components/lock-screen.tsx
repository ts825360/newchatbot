"use client";

import { KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { InviteKey, UserProfile } from "@/lib/types";
import { validateInviteKey } from "@/lib/prototype-state";
import { sampleInviteKeys } from "@/lib/mock-data";
import { Button, Field, inputClass } from "./ui";

export function LockScreen({
  inviteKeys,
  onEnter
}: {
  inviteKeys: InviteKey[];
  onEnter: (profile: UserProfile) => void;
}) {
  const [nickname, setNickname] = useState("체험 사용자");
  const [inviteKey, setInviteKey] = useState<string>(sampleInviteKeys.member);
  const [error, setError] = useState("");
  const [verified, setVerified] = useState<UserProfile | null>(null);

  const verify = (nextKey = inviteKey) => {
    const result = validateInviteKey(nextKey, inviteKeys);
    if (!result.ok) {
      setVerified(null);
      setError(result.error);
      return;
    }

    setError("");
    setVerified({
      ...result.profile,
      nickname: nickname.trim() || "이름 없음"
    });
  };

  const submit = () => {
    const result = validateInviteKey(inviteKey, inviteKeys);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    onEnter({
      ...result.profile,
      nickname: nickname.trim() || "이름 없음"
    });
  };

  return (
    <main className="min-h-screen bg-background p-4 text-foreground">
      <div className="mx-auto grid min-h-[calc(100vh-2rem)] max-w-6xl place-items-center">
        <section className="grid w-full overflow-hidden rounded-lg border border-border bg-panel shadow-soft lg:grid-cols-[1.05fr_0.95fr]">
          <div className="flex min-h-[560px] flex-col justify-between border-b border-border bg-muted/40 p-8 lg:border-b-0 lg:border-r">
            <div>
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <ShieldCheck size={22} />
              </div>
              <h1 className="mt-8 max-w-xl text-4xl font-semibold leading-tight tracking-normal">
                교회 행사가 빠지지 않게, 준비 상태를 먼저 보여주는 행사비서
              </h1>
              <p className="mt-4 max-w-lg text-base leading-7 text-muted-foreground">
                초대받은 관리자만 행사방에 들어가고, 수련회처럼 반복되는 큰 행사의 일정, 체크리스트, 누락 위험을 한 화면에서 확인합니다.
              </p>
            </div>

            <div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
              <div className="rounded-md border border-border bg-panel p-3">
                <p className="font-semibold text-foreground">D-30 준비</p>
                <p className="mt-1">행사 전 준비 시점을 놓치지 않게 표시</p>
              </div>
              <div className="rounded-md border border-border bg-panel p-3">
                <p className="font-semibold text-foreground">누락 위험</p>
                <p className="mt-1">차량, 방 배정, 안전 담당 같은 빈칸 확인</p>
              </div>
              <div className="rounded-md border border-border bg-panel p-3">
                <p className="font-semibold text-foreground">초대키</p>
                <p className="mt-1">닉네임과 키만으로 배정된 방에 입장</p>
              </div>
            </div>
          </div>

          <div className="flex items-center p-6 sm:p-8">
            <div className="w-full">
              <div className="mb-6 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                  <LockKeyhole size={20} />
                </div>
                <div>
                  <h2 className="text-xl font-semibold">초대키로 시작하기</h2>
                  <p className="text-sm text-muted-foreground">기능은 초대키 확인 후에만 열립니다.</p>
                </div>
              </div>

              <div className="grid gap-4">
                <Field label="닉네임">
                  <input className={inputClass} value={nickname} onChange={(event) => setNickname(event.target.value)} />
                </Field>
                <Field label="초대키" hint={`기본 체험 키: ${sampleInviteKeys.member}, 관리자 체험 키: ${sampleInviteKeys.manager}`}>
                  <div className="flex gap-2">
                    <input
                      className={inputClass}
                      value={inviteKey}
                      onChange={(event) => {
                        setInviteKey(event.target.value);
                        setVerified(null);
                        setError("");
                      }}
                    />
                    <Button type="button" variant="outline" onClick={() => verify()}>
                      확인
                    </Button>
                  </div>
                </Field>

                {error ? <p className="rounded-md bg-rose-100 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

                {verified ? (
                  <div className="rounded-md border border-border bg-muted/50 p-4 text-sm">
                    <p className="font-semibold">초대키 확인됨</p>
                    <dl className="mt-3 grid gap-2 text-muted-foreground">
                      <div className="flex justify-between gap-4">
                        <dt>역할</dt>
                        <dd className="text-right text-foreground">{verified.role}</dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt>접근 가능한 행사방</dt>
                        <dd className="text-right text-foreground">2026 여름 수련회</dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt>권한</dt>
                        <dd className="text-right text-foreground">{verified.permissions.length}개 권한</dd>
                      </div>
                    </dl>
                  </div>
                ) : null}

                <Button className="h-11 w-full" type="button" variant="primary" onClick={submit}>
                  <KeyRound size={18} />
                  입장하기
                </Button>

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setInviteKey(sampleInviteKeys.member);
                      verify(sampleInviteKeys.member);
                    }}
                  >
                    일반 키 채우기
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setInviteKey(sampleInviteKeys.manager);
                      verify(sampleInviteKeys.manager);
                    }}
                  >
                    관리자 키 채우기
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
