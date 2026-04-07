"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface Props {
  children: ReactNode;
  params: { projectId: string };
}

const PHASES = [
  { num: 1, label: "기획 분석",    sub: "USP · 실현가능성",     slug: "phase-1" },
  { num: 2, label: "세계관/에셋",  sub: "A/B 디자인 선택",      slug: "phase-2" },
  { num: 3, label: "100화 로드맵", sub: "4막 구조 · 아크",      slug: "phase-3" },
  { num: 4, label: "30컷 대본",    sub: "컷별 이미지 · SCC",    slug: "phase-4" },
];

const PHASE_COLORS = ["#a78bfa", "#60a5fa", "#fbbf24", "#f87171"];

export default function ProjectLayout({ children, params }: Props) {
  const { projectId } = params;
  const pathname = usePathname();

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside style={{
        width: 200, flexShrink: 0,
        background: "var(--surface)", borderRight: "1px solid var(--border)",
        display: "flex", flexDirection: "column", padding: "20px 0",
        position: "sticky", top: 0, height: "100vh", overflowY: "auto",
      }}>
        {/* Back to projects */}
        <Link href="/projects" style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "4px 18px 14px", fontSize: 12, color: "var(--text-dim)",
          textDecoration: "none",
        }}>
          ← 프로젝트 목록
        </Link>

        <nav style={{ padding: "0 10px", flex: 1 }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: "var(--text-dim)",
            letterSpacing: "0.6px", textTransform: "uppercase",
            padding: "4px 8px 10px",
          }}>
            작업 단계
          </div>
          {PHASES.map((phase, i) => {
            const href = `/projects/${projectId}/${phase.slug}`;
            const isActive = pathname.includes(phase.slug);
            const color = PHASE_COLORS[i];
            return (
              <Link key={phase.num} href={href} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 10px", borderRadius: "var(--radius-sm)",
                marginBottom: 2, textDecoration: "none",
                background: isActive ? `${color}18` : "transparent",
                border: isActive ? `1px solid ${color}30` : "1px solid transparent",
                transition: "background 0.15s",
              }}>
                <span style={{
                  width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, fontWeight: 700,
                  background: isActive ? `${color}25` : "var(--surface-2)",
                  border: `1px solid ${isActive ? color : "var(--border)"}`,
                  color: isActive ? color : "var(--text-dim)",
                }}>
                  {phase.num}
                </span>
                <span>
                  <div style={{ fontWeight: 600, fontSize: 13, color: isActive ? color : "var(--text)" }}>
                    {phase.label}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>
                    {phase.sub}
                  </div>
                </span>
              </Link>
            );
          })}
        </nav>

        {/* Settings link at bottom */}
        <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)" }}>
          <Link href="/settings" style={{
            fontSize: 12, color: "var(--text-dim)", textDecoration: "none",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            ⚙ 설정
          </Link>
        </div>
      </aside>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}
