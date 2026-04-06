import type { ReactNode } from "react";
import Link from "next/link";

interface Props {
  children: ReactNode;
  params: { projectId: string };
}

const PHASES = [
  { num: 1, label: "기획 분석", sub: "USP · 실현가능성", slug: "phase-1" },
  { num: 2, label: "세계관/에셋", sub: "A/B 디자인 선택", slug: "phase-2" },
  { num: 3, label: "100화 로드맵", sub: "4막 구조 · 아크", slug: "phase-3" },
  { num: 4, label: "30컷 대본", sub: "컷별 이미지 · SCC", slug: "phase-4" },
];

export default function ProjectLayout({ children, params }: Props) {
  const { projectId } = params;

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* Sidebar */}
      <aside
        style={{
          width: 220,
          flexShrink: 0,
          background: "var(--surface)",
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          padding: "20px 0",
          position: "sticky",
          top: 0,
          height: "100vh",
          overflowY: "auto",
        }}
      >
        <nav style={{ padding: "8px 10px", flex: 1 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--text-dim)",
              letterSpacing: "0.6px",
              textTransform: "uppercase",
              padding: "4px 8px 10px",
            }}
          >
            작업 단계
          </div>
          {PHASES.map((phase) => (
            <Link
              key={phase.num}
              href={`/projects/${projectId}/${phase.slug}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                borderRadius: "var(--radius-sm)",
                marginBottom: 2,
                color: "var(--text-muted)",
                fontSize: 13,
              }}
            >
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  fontWeight: 700,
                  flexShrink: 0,
                  color: "var(--text-dim)",
                }}
              >
                {phase.num}
              </span>
              <span>
                <div style={{ fontWeight: 600, color: "var(--text)" }}>
                  {phase.label}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>
                  {phase.sub}
                </div>
              </span>
            </Link>
          ))}
        </nav>
      </aside>

      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}
