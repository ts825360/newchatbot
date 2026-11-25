import type { Metadata } from "next";
import { Suspense } from "react";
import { DevotionsScreen } from "@/components/devotions-screen";
import "../rooms/rooms.css";

export const metadata: Metadata = { title: "오늘의 말씀 | 행사비서" };

export default function DevotionsPage() {
  return <Suspense fallback={<main className="lobby-loading">말씀을 불러오는 중…</main>}><DevotionsScreen /></Suspense>;
}
