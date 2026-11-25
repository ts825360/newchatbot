import type { Metadata } from "next";
import { AuthScreen } from "@/components/auth-screen";

export const metadata: Metadata = { title: "로그인 | 행사비서" };

export default function LoginPage() {
  return <AuthScreen mode="login" />;
}
