import type { Metadata } from "next";
import { OwnerConsole } from "@/components/owner-console";
import "../management/management.css";

export const metadata: Metadata = { title: "운영 관리 | 행사비서" };

export default function AdminPage() { return <OwnerConsole />; }
