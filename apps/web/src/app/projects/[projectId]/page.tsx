"use client";

import Link from "next/link";

interface Props {
  params: { projectId: string };
}

const PHASES = [
  {
    num: 1,
    label: "기획 분석",
    desc: "장르·USP·실현가능성 분석",
    slug: "phase-1",
    color: "var(--phase-1-color)",
    bg: "var(--phase-1-bg)",
  },
  {
    num: 2,
    label: "세계관 & 에셋",
    desc: "세계관 설계·캐릭터/배경 A/B 선택",
    slug: "phase-2",
    color: "var(--phase-2-color)",
    bg: "var(--phase-2-bg)",
  },
  {
    num: 3,
    label: "100화 로드맵",
    desc: "4막 구조·아크 분류·완급 조절",
    slug: "phase-3",
    color: "var(--phase-3-color)",
    bg: "var(--phase-3-bg)",
  },
  {
    num: 4,
    label: "30컷 대본",
    desc: "컷별 JSON 대본·SCC 화풍 검증",
    slug: "phase-4",
    color: "var(--phase-4-color)",
    bg: "var(--phase-4-bg)",
  },
];

export default function ProjectPage({ params }: Props) {
  const { projectId } = params;

  return (
    <main style={{ padding: "40px 36px", maxWidth: 800 }}>
      <h1
        style={{
          fontSize: 24,
          fontWeight: 800,
          marginBottom: 8,
          letterSpacing: "-0.5px",
        }}
      >
        프로젝트 개요
      </h1>
      <p style={{ color: "var(--text-muted)", fontSize: 14, marginBottom: 36 }}>
        진행할 Phase를 선택하거나 좌측 사이드바에서 이동하세요.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
        }}
      >
        {PHASES.map((phase) => (
          <Link
            key={phase.num}
            href={`/projects/${projectId}/${phase.slug}`}
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: "22px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              cursor: "pointer",
              transition: "border-color 0.15s, box-shadow 0.15s",
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: "var(--radius-sm)",
                background: phase.bg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 15,
                fontWeight: 800,
                color: phase.color,
              }}
            >
              {phase.num}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>
                Phase {phase.num} · {phase.label}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-muted)",
                  marginTop: 4,
                  lineHeight: 1.5,
                }}
              >
                {phase.desc}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
