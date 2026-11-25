import type { Metadata } from "next";
import { MembershipScreen } from "@/components/membership-screen";
import "../management/management.css";

export const metadata: Metadata = { title: "구성원 관리 | 행사비서" };

export default function MembersPage() { return <MembershipScreen />; }
