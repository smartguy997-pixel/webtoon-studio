"use client";

import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[WebtoonStudio]", error);
  }, [error]);

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      background: "#0d0d14",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      color: "#f1f5f9",
      gap: 16,
      textAlign: "center",
      padding: "40px 20px",
    }}>
      <div style={{ fontSize: 36, opacity: 0.3 }}>⚠</div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: "#f87171", margin: 0 }}>오류가 발생했습니다</h2>
      <p style={{ fontSize: 13, color: "#64748b", lineHeight: 1.6, maxWidth: 400, margin: 0 }}>
        {error.message || "예상치 못한 오류가 발생했습니다. 다시 시도하거나 페이지를 새로 고침해주세요."}
      </p>
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <button onClick={reset} style={{
          background: "rgba(248,113,113,0.12)",
          border: "1px solid rgba(248,113,113,0.3)",
          borderRadius: 8, color: "#f87171",
          fontSize: 13, fontWeight: 600,
          padding: "10px 22px", cursor: "pointer",
        }}>
          다시 시도
        </button>
        <a href="/projects" style={{
          background: "rgba(124,108,252,0.12)",
          border: "1px solid rgba(124,108,252,0.3)",
          borderRadius: 8, color: "#a78bfa",
          fontSize: 13, fontWeight: 600,
          padding: "10px 22px", textDecoration: "none",
          display: "inline-block",
        }}>
          프로젝트 목록으로
        </a>
      </div>
    </div>
  );
}
