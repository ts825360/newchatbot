"use client";

import { ArrowLeft, Copy, KeyRound, ShieldCheck, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";
import { createInviteKey } from "@/lib/prototype-state";
import type { EventRoom, InviteKey, InviteKeyDraft, Permission } from "@/lib/types";
import { Badge, Button, Field, inputClass } from "./ui";

const permissionLabels: Array<{ id: Permission; label: string }> = [
  { id: "viewRoom", label: "행사방 조회" },
  { id: "chat", label: "개인 채팅 작성" },
  { id: "viewCalendar", label: "공동 캘린더 조회" },
  { id: "createEvent", label: "일정 생성" },
  { id: "editEvent", label: "일정 수정" },
  { id: "deleteEvent", label: "일정 삭제" },
  { id: "viewChecklist", label: "체크리스트 조회" },
  { id: "editChecklist", label: "체크리스트 수정" },
  { id: "uploadDocument", label: "문서 업로드" },
  { id: "addLink", label: "링크 추가" },
  { id: "editLink", label: "링크 수정" },
  { id: "inviteMember", label: "참여자 초대" },
  { id: "createRoom", label: "행사방 생성" },
  { id: "editRoom", label: "행사방 설정 변경" },
  { id: "viewHistory", label: "변경 이력 조회" },
  { id: "admin", label: "관리자 모드 접근" }
];

const defaultPermissions: Permission[] = ["viewRoom", "chat", "viewCalendar", "createEvent", "editEvent", "viewChecklist", "editChecklist"];

export function AdminDashboard({
  rooms,
  existingKeys,
  onBack,
  onCreateInvite
}: {
  rooms: EventRoom[];
  existingKeys: InviteKey[];
  onBack: () => void;
  onCreateInvite: (invite: InviteKey) => void;
}) {
  const [draft, setDraft] = useState<InviteKeyDraft>({
    label: "차량 담당 초대",
    key: "차량-2026",
    roomId: "summer-retreat-2026",
    role: "차량 담당자",
    permissions: defaultPermissions,
    maxUses: 2,
    expiresAt: "2026-08-10",
    memo: "차량 수요 조사와 배정표 확인 담당"
  });
  const [created, setCreated] = useState<InviteKey | null>(null);
  const [copied, setCopied] = useState(false);

  const selectedRoom = useMemo(() => rooms.find((room) => room.id === draft.roomId), [draft.roomId, rooms]);

  const togglePermission = (permission: Permission) => {
    setDraft((current) => ({
      ...current,
      permissions: current.permissions.includes(permission)
        ? current.permissions.filter((item) => item !== permission)
        : [...current.permissions, permission]
    }));
  };

  const submit = () => {
    const invite = createInviteKey(draft);
    setCreated(invite);
    setCopied(false);
    onCreateInvite(invite);
  };

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b border-border bg-panel px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button className="h-9 w-9 px-0" type="button" variant="ghost" onClick={onBack} aria-label="일반 화면으로 돌아가기">
              <ArrowLeft size={18} />
            </Button>
            <div>
              <p className="text-xs font-semibold uppercase text-primary">관리자 모드</p>
              <h1 className="text-xl font-semibold">초대키와 권한 관리</h1>
            </div>
          </div>
          <Badge tone="amber">프로토타입: 실제 보안 처리 없음</Badge>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[260px_1fr_360px]">
        <aside className="border-b border-border bg-panel p-4 lg:border-b-0 lg:border-r">
          <nav className="grid gap-1 text-sm">
            {["초대키 관리", "사용자 관리", "행사방 관리", "역할 및 권한 관리", "변경 이력", "사용설명서"].map((item, index) => (
              <button
                key={item}
                className={`rounded-md px-3 py-2 text-left transition ${index === 0 ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                type="button"
              >
                {item}
              </button>
            ))}
          </nav>

          <div className="mt-6 rounded-md border border-border bg-muted/40 p-3 text-sm">
            <div className="flex items-center gap-2 font-semibold">
              <ShieldCheck size={16} />
              관리자 안내
            </div>
            <p className="mt-2 text-muted-foreground">초대키는 방, 역할, 권한을 함께 담습니다. 실제 서비스에서는 서버 검증이 필요합니다.</p>
          </div>
        </aside>

        <section className="overflow-auto p-5">
          <div className="mx-auto max-w-4xl">
            <div className="mb-5">
              <h2 className="text-lg font-semibold">초대키 생성</h2>
              <p className="mt-1 text-sm text-muted-foreground">행사 이름, 역할, 권한을 정한 뒤 받을 사람에게 키 문자열만 전달하는 흐름입니다.</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="초대키 이름">
                <input className={inputClass} value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} />
              </Field>
              <Field label="실제 초대키 문자열">
                <input className={inputClass} value={draft.key} onChange={(event) => setDraft({ ...draft, key: event.target.value })} />
              </Field>
              <Field label="연결할 행사방">
                <select className={inputClass} value={draft.roomId} onChange={(event) => setDraft({ ...draft, roomId: event.target.value })}>
                  {rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="역할 이름">
                <input className={inputClass} value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })} />
              </Field>
              <Field label="사용 가능 횟수">
                <input
                  className={inputClass}
                  min={1}
                  type="number"
                  value={draft.maxUses}
                  onChange={(event) => setDraft({ ...draft, maxUses: Number(event.target.value) })}
                />
              </Field>
              <Field label="만료일">
                <input className={inputClass} type="date" value={draft.expiresAt} onChange={(event) => setDraft({ ...draft, expiresAt: event.target.value })} />
              </Field>
              <Field label="메모">
                <textarea className={inputClass} value={draft.memo} onChange={(event) => setDraft({ ...draft, memo: event.target.value })} rows={3} />
              </Field>
            </div>

            <div className="mt-6">
              <h3 className="text-sm font-semibold">권한 설정</h3>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {permissionLabels.map((permission) => (
                  <label key={permission.id} className="flex items-center gap-2 rounded-md border border-border bg-panel px-3 py-2 text-sm">
                    <input
                      checked={draft.permissions.includes(permission.id)}
                      type="checkbox"
                      onChange={() => togglePermission(permission.id)}
                    />
                    <span>{permission.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <Button type="button" variant="primary" onClick={submit}>
                <KeyRound size={17} />
                초대키 생성
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setDraft({
                    ...draft,
                    role: "보조 관리자",
                    permissions: [...defaultPermissions, "inviteMember", "viewHistory", "admin"]
                  })
                }
              >
                보조 관리자 권한 채우기
              </Button>
            </div>
          </div>
        </section>

        <aside className="border-t border-border bg-panel p-5 lg:border-l lg:border-t-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <UsersRound size={17} />
            생성 결과
          </h2>
          {created ? (
            <div className="mt-4 rounded-md border border-border bg-background p-4 text-sm">
              <p className="text-xs text-muted-foreground">생성된 초대키</p>
              <p className="mt-1 break-all text-lg font-semibold">{created.key}</p>
              <dl className="mt-4 grid gap-2 text-muted-foreground">
                <div className="flex justify-between gap-3">
                  <dt>역할</dt>
                  <dd className="text-right text-foreground">{created.role}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>행사방</dt>
                  <dd className="text-right text-foreground">{selectedRoom?.name}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>권한</dt>
                  <dd className="text-right text-foreground">{created.permissions.length}개</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>만료일</dt>
                  <dd className="text-right text-foreground">{created.expiresAt}</dd>
                </div>
              </dl>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setCopied(true);
                    void navigator.clipboard?.writeText(created.key);
                  }}
                >
                  <Copy size={16} />
                  {copied ? "복사됨" : "복사"}
                </Button>
                <Button type="button" variant="ghost">
                  비활성화
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-md border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground">
              초대키를 생성하면 역할, 행사방, 권한 요약이 여기에 표시됩니다.
            </div>
          )}

          <div className="mt-5 rounded-md border border-border bg-muted/40 p-4 text-sm">
            <p className="font-semibold">현재 등록된 키</p>
            <div className="mt-3 grid gap-2">
              {existingKeys.slice(-4).map((key) => (
                <div key={key.id} className="rounded-md bg-panel p-2">
                  <p className="font-medium">{key.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {key.role} · {key.expiresAt}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
