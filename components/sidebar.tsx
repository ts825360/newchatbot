"use client";

import { ArrowLeft, Bell, LogOut, MoreHorizontal, Pin, Shield, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import type { EventRoom, UserProfile } from "@/lib/types";
import { Badge, Button, cn } from "./ui";

const statusCopy: Record<EventRoom["status"], { label: string; tone: "green" | "amber" | "red" | "blue" }> = {
  normal: { label: "정상", tone: "green" },
  needsPreparation: { label: "준비 필요", tone: "amber" },
  risk: { label: "누락 위험", tone: "red" },
  needsDate: { label: "날짜 필요", tone: "blue" }
};

export function Sidebar({
  rooms,
  activeRoomId,
  profile,
  onSelectRoom,
  onTogglePin,
  onLeaveRoom,
  onReorderRooms,
  onAdmin,
  onSignOut,
  onBackToRooms
}: {
  rooms: EventRoom[];
  activeRoomId: string;
  profile: UserProfile;
  onSelectRoom: (roomId: string) => void;
  onTogglePin: (roomId: string) => void;
  onLeaveRoom: (roomId: string) => void;
  onReorderRooms: (fromRoomId: string, toRoomId: string) => void;
  onAdmin: () => void;
  onSignOut: () => void;
  onBackToRooms?: () => void;
}) {
  const [menuRoomId, setMenuRoomId] = useState<string | null>(null);
  const [draggingRoomId, setDraggingRoomId] = useState<string | null>(null);

  const pinnedRooms = useMemo(() => rooms.filter((room) => room.pinned), [rooms]);
  const normalRooms = useMemo(() => rooms.filter((room) => !room.pinned), [rooms]);

  const renderRoom = (room: EventRoom) => {
    const status = statusCopy[room.status];
    const active = room.id === activeRoomId;

    return (
      <div
        key={room.id}
        className="relative"
        draggable
        onDragStart={() => setDraggingRoomId(room.id)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={() => {
          if (draggingRoomId && draggingRoomId !== room.id) {
            onReorderRooms(draggingRoomId, room.id);
          }
          setDraggingRoomId(null);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenuRoomId(menuRoomId === room.id ? null : room.id);
        }}
      >
        <button
          type="button"
          className={cn(
            "grid w-full grid-cols-[36px_1fr] items-center gap-3 rounded-md border px-2 py-2 text-left transition",
            active ? "border-primary bg-primary/10" : "border-transparent hover:border-border hover:bg-muted/70"
          )}
          onClick={() => {
            onSelectRoom(room.id);
            setMenuRoomId(null);
          }}
        >
          <span className="grid h-9 w-9 place-items-center rounded-md bg-panel text-sm font-bold text-primary shadow-sm">
            {room.icon}
          </span>
          <span className="min-w-0">
            <span className="flex items-start gap-1.5 pr-7">
              <span className="line-clamp-2 text-sm font-semibold leading-5">{room.name}</span>
              {room.pinned ? <Pin size={13} className="shrink-0 text-amber-500" /> : null}
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span>{room.dDay}</span>
              <span>{room.dateLabel}</span>
              <Badge tone={status.tone}>{status.label}</Badge>
            </span>
          </span>
          {room.unreadChanges > 0 ? <Badge className="absolute right-3 top-2" tone="blue">{room.unreadChanges}</Badge> : null}
        </button>

        {menuRoomId === room.id ? (
          <div className="absolute right-2 top-12 z-30 w-48 rounded-md border border-border bg-panel p-1 shadow-soft">
            <button className="w-full rounded px-3 py-2 text-left text-sm hover:bg-muted" type="button" onClick={() => onTogglePin(room.id)}>
              {room.pinned ? "고정 해제" : "상단에 고정"}
            </button>
            <button className="w-full rounded px-3 py-2 text-left text-sm hover:bg-muted" type="button">
              방 이름 및 정보 보기
            </button>
            <button className="w-full rounded px-3 py-2 text-left text-sm hover:bg-muted" type="button">
              알림 설정
            </button>
            <button
              className="w-full rounded px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10"
              type="button"
              onClick={() => onLeaveRoom(room.id)}
            >
              방 나가기
            </button>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-border bg-panel">
      <header className="border-b border-border p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase text-primary">Church Planner</p>
            <h1 className="text-xl font-semibold">행사비서</h1>
          </div>
          <Button className="h-8 w-8 px-0" type="button" variant="ghost" aria-label="더보기">
            <MoreHorizontal size={18} />
          </Button>
        </div>
        {onBackToRooms && <Button className="mt-3 w-full justify-start" type="button" variant="ghost" onClick={onBackToRooms}><ArrowLeft size={15} />행사방 목록</Button>}
        <div className="mt-4 rounded-md border border-border bg-muted/45 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium">오늘 확인</span>
            <Bell size={16} className="text-primary" />
          </div>
          <p className="mt-2 text-muted-foreground">수련회 D-13, 누락 위험 3건</p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {pinnedRooms.length > 0 ? (
          <section>
            <p className="px-2 py-2 text-xs font-semibold text-muted-foreground">고정된 방</p>
            <div className="grid gap-1.5">{pinnedRooms.map(renderRoom)}</div>
          </section>
        ) : null}

        <section className="mt-3">
          <p className="px-2 py-2 text-xs font-semibold text-muted-foreground">행사방</p>
          <div className="grid gap-1.5">{normalRooms.map(renderRoom)}</div>
        </section>
      </div>

      <footer className="border-t border-border p-3">
        <div className="mb-3 flex items-center gap-3 rounded-md bg-muted/50 p-3">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
            {profile.nickname.slice(0, 1) || "관"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{profile.nickname}</p>
            <p className="truncate text-xs text-muted-foreground">{profile.role}</p>
          </div>
          <UserRound size={17} className="text-muted-foreground" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" onClick={onAdmin}>
            <Shield size={16} />
            관리자
          </Button>
          <Button type="button" variant="ghost" onClick={onSignOut}>
            <LogOut size={16} />
            로그아웃
          </Button>
        </div>
      </footer>
    </aside>
  );
}
