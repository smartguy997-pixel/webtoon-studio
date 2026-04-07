"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Props {
  params: { projectId: string };
}

interface Phase1Data {
  data: { feasibility_score: number; verdict: string; usp: string[]; summary: string };
  input: { genre: string; concept: string };
  savedAt: string;
}
interface Phase2Data {
  data: { world?: { era: string; atmosphere: string }; characters?: Array<{ name: string; role: string } | null> };
}

const PHASES = [
  { num: 1, label: "기획 분석",    desc: "장르·USP·실현가능성 분석",        slug: "phase-1", color: "#a78bfa", bg: "rgba(167,139,250,0.12)" },
  { num: 2, label: "세계관/에셋",  desc: "세계관 설계·캐릭터/배경 A/B 선택", slug: "phase-2", color: "#60a5fa", bg: "rgba(96,165,250,0.12)"   },
  { num: 3, label: "100화 로드맵", desc: "4막 구조·아크 분류·완급 조절",      slug: "phase-3", color: "#fbbf24", bg: "rgba(251,191,36,0.12)"  },
  { num: 4, label: "30컷 대본",    desc: "컷별 JSON 대본·SCC 화풍 검증",     slug: "phase-4", color: "#f87171", bg: "rgba(248,113,113,0.12)"  },
];

function feasibilityLabel(score: number) {
  if (score >= 0.7) return { label: "진행 가능", color: "#34d399" };
  if (score >= 0.5) return { label: "조건부 진행", color: "#fbbf24" };
  return { label: "재검토 필요", color: "#f87171" };
}

export default function ProjectPage({ params }: Props) {
  const { projectId } = params;
  const router = useRouter();

  const [p1, setP1] = useState<Phase1Data | null>(null);
  const [p2, setP2] = useState<Phase2Data | null>(null);
  const [p3done, setP3done] = useState(false);
  const [epCount, setEpCount] = useState(0);
  const [projectName, setProjectName] = useState("");

  useEffect(() => {
    try {
      const raw1 = localStorage.getItem(`wts_phase1_${projectId}`);
      if (raw1) setP1(JSON.parse(raw1) as Phase1Data);

      const raw2 = localStorage.getItem(`wts_phase2_${projectId}`);
      if (raw2) setP2(JSON.parse(raw2) as Phase2Data);

      setP3done(!!localStorage.getItem(`wts_phase3_done_${projectId}`));

      let count = 0;
      for (let i = 1; i <= 100; i++) {
        if (localStorage.getItem(`wts_phase4_ep_${projectId}_${i}`)) count++;
      }
      setEpCount(count);

      const projs = JSON.parse(localStorage.getItem("wts_projects") ?? "[]") as Array<{ id: string; title: string }>;
      const proj = projs.find(p => p.id === projectId);
      if (proj) setProjectName(proj.title);
    } catch { /* ignore */ }
  }, [projectId]);

  const currentPhase = epCount > 0 ? 4 : p3done ? 3 : p2 ? 2 : p1 ? 1 : 0;
  const score = p1?.data?.feasibility_score;
  const feasibility = score !== undefined ? feasibilityLabel(score) : null;

  return (
    <main style={{ padding: "36px 36px 60px", maxWidth: 840, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
          프로젝트 대시보드
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: "#f1f5f9", letterSpacing: "-0.5px", margin: 0 }}>
          {projectName || projectId}
        </h1>
        {p1?.input && (
          <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ background: "rgba(167,139,250,0.15)", color: "#a78bfa", padding: "2px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
              {p1.input.genre}
            </span>
            <span style={{ fontSize: 13, color: "#94a3b8" }}>
              {p1.input.concept.slice(0, 80)}{p1.input.concept.length > 80 ? "…" : ""}
            </span>
          </div>
        )}
      </div>

      {/* Phase 1 result summary */}
      {p1?.data && (
        <div style={{ background: "#16161f", border: "1px solid #2a2a3d", borderRadius: 14, padding: "20px 24px", marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 14 }}>
            Phase 1 기획 분석 결과
          </div>
          <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ textAlign: "center", flexShrink: 0 }}>
              <div style={{ fontSize: 36, fontWeight: 800, color: feasibility?.color ?? "#f1f5f9", lineHeight: 1 }}>
                {Math.round((score ?? 0) * 100)}
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>점</div>
              <div style={{ marginTop: 6, fontSize: 12, color: feasibility?.color, fontWeight: 700, background: `${feasibility?.color}15`, padding: "2px 10px", borderRadius: 20 }}>
                {feasibility?.label}
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {p1.data.summary && (
                <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6, marginBottom: 12 }}>
                  {p1.data.summary}
                </div>
              )}
              {p1.data.usp?.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {p1.data.usp.map((u, i) => (
                    <span key={i} style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.25)", color: "#a78bfa", borderRadius: 8, padding: "3px 10px", fontSize: 12 }}>
                      {u}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Phase 2 summary */}
      {p2?.data && (p2.data.world || (p2.data.characters && p2.data.characters.length > 0) || epCount > 0) && (
        <div style={{ background: "#16161f", border: "1px solid #2a2a3d", borderRadius: 14, padding: "16px 24px", marginBottom: 24, display: "flex", gap: 32, flexWrap: "wrap" }}>
          {p2.data.world && (
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#60a5fa", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>세계관</div>
              <div style={{ fontSize: 13, color: "#f1f5f9", fontWeight: 600 }}>{p2.data.world.era}</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>{p2.data.world.atmosphere}</div>
            </div>
          )}
          {p2.data.characters && p2.data.characters.filter(Boolean).length > 0 && (
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#fb923c", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>캐릭터</div>
              {p2.data.characters.filter(Boolean).map((c, i) => c && (
                <div key={i} style={{ fontSize: 13, color: "#f1f5f9", marginBottom: 4 }}>
                  <span style={{ color: c.role === "protagonist" ? "#a78bfa" : "#f87171", fontWeight: 600 }}>
                    {c.role === "protagonist" ? "주인공" : "빌런"}
                  </span>{" "}{c.name}
                </div>
              ))}
            </div>
          )}
          {epCount > 0 && (
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#f87171", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>대본 진행</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#f87171" }}>
                {epCount}<span style={{ fontSize: 13, fontWeight: 400, color: "#64748b" }}> / 100화</span>
              </div>
              <div style={{ marginTop: 8, height: 4, background: "#2a2a3d", borderRadius: 2 }}>
                <div style={{ height: "100%", width: `${epCount}%`, background: "#f87171", borderRadius: 2 }} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Phase cards */}
      <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 14 }}>
        작업 단계
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {PHASES.map(phase => {
          const isDone =
            (phase.num === 1 && !!p1) ||
            (phase.num === 2 && !!p2) ||
            (phase.num === 3 && p3done) ||
            (phase.num === 4 && epCount > 0);
          const isCurrent = phase.num === currentPhase + 1 || (currentPhase === 0 && phase.num === 1);
          const isLocked = !isDone && phase.num > currentPhase + 1;

          return (
            <Link
              key={phase.num}
              href={isLocked ? "#" : `/projects/${projectId}/${phase.slug}`}
              onClick={e => isLocked && e.preventDefault()}
              style={{
                background: isCurrent ? phase.bg : "#16161f",
                border: `1px solid ${isCurrent ? phase.color + "50" : "#2a2a3d"}`,
                borderRadius: 14, padding: "20px 22px",
                display: "flex", flexDirection: "column", gap: 10,
                opacity: isLocked ? 0.45 : 1,
                textDecoration: "none",
                cursor: isLocked ? "not-allowed" : "pointer",
                transition: "border-color 0.15s",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{
                  width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
                  background: isDone ? phase.color : phase.bg,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: isDone ? 16 : 14, fontWeight: 800,
                  color: isDone ? "#0d0d14" : phase.color,
                }}>
                  {isDone ? "✓" : phase.num}
                </div>
                {isDone && <span style={{ fontSize: 11, color: phase.color, fontWeight: 700, background: phase.bg, padding: "2px 8px", borderRadius: 20 }}>완료</span>}
                {isCurrent && !isDone && <span style={{ fontSize: 11, color: phase.color, fontWeight: 700, background: phase.bg, padding: "2px 8px", borderRadius: 20 }}>진행 중</span>}
                {isLocked && <span style={{ fontSize: 11, color: "#475569" }}>🔒</span>}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: "#f1f5f9" }}>
                  Phase {phase.num} · {phase.label}
                </div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 4, lineHeight: 1.5 }}>
                  {phase.desc}
                </div>
              </div>
              {!isLocked && (
                <div style={{ fontSize: 12, color: phase.color, fontWeight: 600 }}>
                  {isDone ? "결과 보기 / 재분석 →" : "시작하기 →"}
                </div>
              )}
            </Link>
          );
        })}
      </div>

      {/* No progress yet CTA */}
      {currentPhase === 0 && (
        <div style={{ marginTop: 28, textAlign: "center" }}>
          <button
            onClick={() => router.push(`/projects/${projectId}/phase-1`)}
            style={{
              background: "linear-gradient(135deg, #7c6cfc, #a78bfa)",
              border: "none", borderRadius: 12, padding: "14px 32px",
              fontSize: 15, fontWeight: 700, color: "#fff", cursor: "pointer",
            }}
          >
            ✦ Phase 1 기획 분석 시작
          </button>
        </div>
      )}
    </main>
  );
}
