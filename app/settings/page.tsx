import type { Metadata } from "next";
import { SettingsScreen } from "@/components/settings-screen";
import "../management/management.css";
import "./settings.css";

export const metadata: Metadata = { title: "환경설정 | 행사비서" };

export default function SettingsPage() { return <SettingsScreen />; }
