import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NavSidebar } from "@/components/NavSidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Webtoon Studio",
  description: "7인의 전문 AI 에이전트와 함께하는 웹툰 제작 플랫폼",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body style={{ display: "flex", minHeight: "100vh" }}>
        <NavSidebar />
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      </body>
    </html>
  );
}
