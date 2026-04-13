"use client";

import { type ReactNode, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

interface Props {
  children: ReactNode;
  params: { projectId: string };
}

const PHASES = [
  { num: 1, label: "기획 분석",    sub: "USP · 실현가능성",     slug: "phase-1" },
  { num: 2, label: "세계관/에셋",  sub: "A/B 디자인 선택",      slug: "phase-2" },
  { num: 3, label: "100화 로드맵", sub: "4막 구조 · 아크",      slug: "phase-3" },
  { num: 4, label: "30컷 대본",    sub: "컷별 이미지 · SCC",    slug: "phase-4" },
  { num: 5, label: "이미지 생성",  sub: "MST 주입 · SCC 검증",  slug: "phase-5" },
];

const PHASE_COLORS = ["#a78bfa", "#60a5fa", "#fbbf24", "#f87171", "#c084fc"];

function getPhasesDone(projectId: string): Record<number, boolean> {
  try {
    return {
      1: !!localStorage.getItem(`wts_phase1_${projectId}`),
      2: !!localStorage.getItem(`wts_phase2_${projectId}`),
      3: !!localStorage.getItem(`wts_phase3_done_${projectId}`),
      4: !!localStorage.getItem(`wts_phase4_done_${projectId}`),
      5: !!localStorage.getItem(`wts_phase5_done_${projectId}`),
    };
  } catch { return { 1: false, 2: false, 3: false, 4: false, 5: false }; }
}

function getProjectTitle(projectId: string): string {
  try {
    const raw = localStorage.getItem("wts_projects");
    if (!raw) return "";
    const projects = JSON.parse(raw) as Array<{ id: string; title: string }>;
    return projects.find(p => p.id === projectId)?.title ?? "";
  } catch { return ""; }
}

export default function ProjectLayout({ children, params }: Props) {
  const { projectId } = params;
  const pathname = usePathname();
  const router = useRouter();
  const [phasesDone, setPhasesDone] = useState<Record<number, boolean>>({ 1: false, 2: false, 3: false, 4: false, 5: false });
  const [projectTitle, setProjectTitle] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    setPhasesDone(getPhasesDone(projectId));
    setProjectTitle(getProjectTitle(projectId));
  }, [projectId, pathname]); // pathname 변경 시마다 완료 상태 재확인

  const handleDelete = useCallback(() => {
    // 모든 관련 localStorage 데이터 삭제
    const keys = [
      `wts_phase1_${projectId}`, `wts_phase2_${projectId}`,
      `wts_phase3_done_${projectId}`, `wts_phase3_data_${projectId}`,
      `wts_phase4_done_${projectId}`, `wts_phase5_done_${projectId}`,
      `wts_project_seed_${projectId}`,
      `p1_result_${projectId}`, `p1_msgs_${projectId}`,
      `p1_conv_${projectId}`, `p1_memory_${projectId}`,
    ];
    // Phase 4/5 에피소드별 데이터
    for (let i = 1; i <= 100; i++) {
      keys.push(`wts_phase4_ep_${projectId}_${i}`, `wts_phase4_card_${projectId}_${i}`);
      keys.push(`wts_phase5_ep_${projectId}_${i}`);
    }
    keys.forEach(k => { try { localStorage.removeItem(k); } catch { /* ignore */ } });

    // 프로젝트 목록에서 제거
    try {
      const raw = localStorage.getItem("wts_projects");
      if (raw) {
        const projects = JSON.parse(raw) as Array<{ id: string }>;
        localStorage.setItem("wts_projects", JSON.stringify(projects.filter(p => p.id !== projectId)));
      }
    } catch { /* ignore */ }

    router.push("/projects");
  }, [projectId, router]);

  // 각 페이즈가 접근 가능한지 (이전 페이즈 완료 또는 현재 페이즈)
  const isUnlocked = (num: number) => {
    if (num === 1) return true;
    return phasesDone[num - 1] === true;
  };

  const currentPhaseNum = PHASES.find(p => pathname.includes(p.slug))?.num ?? 1;

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside style={{
        width: 210, flexShrink: 0,
        background: "var(--surface)", borderRight: "1px solid var(--border)",
        display: "flex", flexDirection: "column", padding: "20px 0",
        position: "sticky", top: 0, height: "100vh", overflowY: "auto",
      }}>
        {/* Back to projects */}
        <Link href="/projects" style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "4px 18px 10px", fontSize: 12, color: "var(--text-dim)",
          textDecoration: "none",
        }}>
          ← 프로젝트 목록
        </Link>

        {/* 프로젝트 제목 */}
        {projectTitle && (
          <div style={{
            padding: "4px 18px 12px", fontSize: 13, fontWeight: 700,
            color: "var(--text)", borderBottom: "1px solid var(--border)",
            marginBottom: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {projectTitle}
          </div>
        )}

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
            const done = phasesDone[phase.num];
            const unlocked = isUnlocked(phase.num);
            const color = PHASE_COLORS[i];

            return (
              <Link
                key={phase.num}
                href={unlocked ? href : "#"}
                onClick={e => { if (!unlocked) e.preventDefault(); }}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 10px", borderRadius: "var(--radius-sm)",
                  marginBottom: 2, textDecoration: "none",
                  background: isActive ? `${color}18` : "transparent",
                  border: isActive ? `1px solid ${color}30` : "1px solid transparent",
                  opacity: unlocked ? 1 : 0.4,
                  cursor: unlocked ? "pointer" : "default",
                  transition: "background 0.15s",
                }}
              >
                <span style={{
                  width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, fontWeight: 700,
                  background: done ? `${color}30` : isActive ? `${color}25` : "var(--surface-2)",
                  border: `1px solid ${done || isActive ? color : "var(--border)"}`,
                  color: done ? color : isActive ? color : "var(--text-dim)",
                }}>
                  {done ? "✓" : !unlocked ? "🔒" : phase.num}
                </span>
                <span>
                  <div style={{ fontWeight: 600, fontSize: 13, color: isActive ? color : done ? color : "var(--text)" }}>
                    {phase.label}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>
                    {phase.sub}
                  </div>
                </span>
                {/* 현재 페이즈 → 다음 미완 페이즈 화살표 힌트 */}
                {done && phase.num === currentPhaseNum && (
                  <span style={{ marginLeft: "auto", fontSize: 10, color: color, opacity: 0.7 }}>→</span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* 하단 — 설정 + 삭제 */}
        <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8 }}>
          <Link href="/settings" style={{
            fontSize: 12, color: "var(--text-dim)", textDecoration: "none",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            ⚙ 설정
          </Link>
          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 12, color: "#f87171", textAlign: "left",
                display: "flex", alignItems: "center", gap: 6, padding: 0,
              }}
            >
              🗑 프로젝트 삭제
            </button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 11, color: "#f87171" }}>정말 삭제할까요?</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={handleDelete}
                  style={{
                    flex: 1, padding: "4px 0", fontSize: 11, cursor: "pointer",
                    background: "rgba(248,113,113,0.15)", border: "1px solid rgba(248,113,113,0.4)",
                    borderRadius: 6, color: "#f87171",
                  }}
                >
                  삭제
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  style={{
                    flex: 1, padding: "4px 0", fontSize: 11, cursor: "pointer",
                    background: "var(--surface-2)", border: "1px solid var(--border)",
                    borderRadius: 6, color: "var(--text-dim)",
                  }}
                >
                  취소
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}
