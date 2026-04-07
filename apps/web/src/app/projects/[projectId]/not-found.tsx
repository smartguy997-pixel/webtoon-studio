import Link from "next/link";

export default function ProjectNotFound() {
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
      <div style={{ fontSize: 40, opacity: 0.25 }}>✦</div>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: "#f1f5f9", margin: 0 }}>프로젝트를 찾을 수 없습니다</h1>
      <p style={{ fontSize: 13, color: "#64748b", lineHeight: 1.6, maxWidth: 320, margin: 0 }}>
        프로젝트가 삭제되었거나 접근 권한이 없습니다.
      </p>
      <Link href="/projects" style={{
        background: "rgba(124,108,252,0.12)",
        border: "1px solid rgba(124,108,252,0.3)",
        borderRadius: 8,
        color: "#a78bfa",
        fontSize: 13,
        fontWeight: 600,
        padding: "10px 22px",
        textDecoration: "none",
      }}>
        ← 프로젝트 목록으로
      </Link>
    </div>
  );
}
