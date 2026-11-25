import type { Metadata } from "next";
import { AuthScreen } from "@/components/auth-screen";

export const metadata: Metadata = { title: "회원가입 | 행사비서" };

export default function SignupPage() {
  return <AuthScreen mode="signup" />;
}
