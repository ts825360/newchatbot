import type { Metadata } from "next";
import "./globals.css";
import { BackendProvider } from "@/components/backend-provider";

export const metadata: Metadata = {
  title: "행사비서 프로토타입",
  description: "교회 행사 준비 누락을 줄이기 위한 인터랙티브 UI 프로토타입"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body><BackendProvider>{children}</BackendProvider></body>
    </html>
  );
}
