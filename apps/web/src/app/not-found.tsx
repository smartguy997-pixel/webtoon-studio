import Link from "next/link";

export default function NotFound() {
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
      gap: 20,
      textAlign: "center",
      padding: "40px 20px",
    }}>
      <div style={{ fontSize: 48, opacity: 0.3 }}>✦</div>
      <div>
        <div style={{ fontSize: 72, fontWeight: 800, color: "#2a2a3d", lineHeight: 1 }}>404</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#f1f5f9", margin: "12px 0 8px" }}>
          페이지를 찾을 수 없습니다
        </h1>
        <p style={{ fontSize: 14, color: "#64748b", lineHeight: 1.6, maxWidth: 360, margin: "0 auto" }}>
          요청하신 페이지가 존재하지 않거나 삭제되었습니다.
        </p>
      </div>
      <Link href="/projects" style={{
        marginTop: 8,
        background: "rgba(124,108,252,0.15)",
        border: "1px solid rgba(124,108,252,0.35)",
        borderRadius: 10,
        color: "#a78bfa",
        fontSize: 14,
        fontWeight: 600,
        padding: "12px 28px",
        textDecoration: "none",
        transition: "background 0.15s",
      }}>
        ← 프로젝트 목록으로
      </Link>
    </div>
  );
}
