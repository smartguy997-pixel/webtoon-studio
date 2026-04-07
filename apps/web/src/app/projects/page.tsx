"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import s from "./page.module.css";

type Phase = 1 | 2 | 3 | 4 | 5;

interface Project {
  id: string;
  title: string;
  genre: string;
  targetAudience: string;
  currentPhase: Phase;
  status: "active" | "completed" | "draft";
  feasibilityScore?: number;
  episodeProgress?: number;
  createdAt: string;
}

const PHASE_LABELS = ["기획 분석", "세계관/에셋", "100화 로드맵", "30컷 대본", "이미지 생성"];
const PHASE_ROUTES = ["phase-1", "phase-2", "phase-3", "phase-4", "phase-5"];
const GENRES = [
  "판타지", "로맨스", "액션", "SF", "스릴러", "일상/힐링",
  "무협", "스포츠", "공포", "역사", "드라마", "개그",
];

const STORAGE_KEY = "wts_projects";

function loadProjects(): Project[] {
  if (typeof window === "undefined") return DEMO_PROJECTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEMO_PROJECTS;
    return JSON.parse(raw) as Project[];
  } catch { return DEMO_PROJECTS; }
}

function saveProjects(list: Project[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

const DEMO_PROJECTS: Project[] = [
  { id: "demo-1", title: "별을 삼킨 소녀", genre: "판타지", targetAudience: "10~20대 여성", currentPhase: 3, status: "active", feasibilityScore: 0.82, createdAt: "2026-03-10T08:00:00Z" },
  { id: "demo-2", title: "직장인 슈퍼히어로", genre: "액션", targetAudience: "20~30대 직장인", currentPhase: 4, status: "active", feasibilityScore: 0.75, episodeProgress: 23, createdAt: "2026-02-28T10:30:00Z" },
  { id: "demo-3", title: "달빛 편의점", genre: "일상/힐링", targetAudience: "전 연령", currentPhase: 1, status: "active", createdAt: "2026-04-01T14:00:00Z" },
];

function phaseClass(phase: Phase, current: Phase): string {
  if (phase < current) return s.stepDone;
  if (phase === current) return s.stepActive;
  return "";
}
function phaseBadgeClass(phase: Phase): string { return [s.phaseBadge, s[`phase${phase}`]].join(" "); }
function feasibilityColor(score: number) { return score >= 0.7 ? s.feasibilityHigh : score >= 0.5 ? s.feasibilityMid : s.feasibilityLow; }
function formatDate(iso: string) { return new Date(iso).toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" }); }
function uid() { return Math.random().toString(36).slice(2, 10); }

function PhaseStepper({ current }: { current: Phase }) {
  return (
    <div>
      <div className={s.stepper}>
        {([1, 2, 3, 4, 5] as Phase[]).map((phase, i) => (
          <div key={phase} className={`${s.step} ${phaseClass(phase, current)}`}>
            <div className={s.stepDot}>{phase < current ? "✓" : phase}</div>
            {i < 4 && <div className={s.stepLine} style={phase < current ? { background: "var(--primary)" } : undefined} />}
          </div>
        ))}
      </div>
      <div className={s.stepperLabels}>
        {PHASE_LABELS.map((label, i) => {
          const phase = (i + 1) as Phase;
          const cls = [s.stepperLabel, phase === current ? s.stepperLabelActive : "", phase < current ? s.stepperLabelDone : ""].join(" ");
          return <span key={phase} className={cls}>{label}</span>;
        })}
      </div>
    </div>
  );
}

function ProjectCard({ project, onDelete }: { project: Project; onDelete: (id: string) => void }) {
  function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (window.confirm(`"${project.title}" 프로젝트를 삭제하시겠습니까?\n\n모든 Phase 데이터가 함께 삭제됩니다.`)) {
      onDelete(project.id);
    }
  }

  return (
    <Link href={`/projects/${project.id}/${PHASE_ROUTES[project.currentPhase - 1]}`} className={s.card}>
      <div className={s.cardTop}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className={s.cardTitle}>{project.title}</div>
          <div className={s.cardMeta}>
            <span className={`${s.tag} ${s.tagGenre}`}>{project.genre}</span>
            <span className={phaseBadgeClass(project.currentPhase)}>Phase {project.currentPhase} · {PHASE_LABELS[project.currentPhase - 1]}</span>
          </div>
        </div>
        <button className={s.cardDeleteBtn} onClick={handleDelete} title="프로젝트 삭제">✕</button>
      </div>
      <PhaseStepper current={project.currentPhase} />
      {project.currentPhase >= 4 && project.episodeProgress !== undefined && (
        <div className={s.episodeBar}>
          <div className={s.episodeBarLabel}><span>화별 대본 진행</span><span>{project.episodeProgress} / 100화</span></div>
          <div className={s.episodeBarTrack}><div className={s.episodeBarFill} style={{ width: `${project.episodeProgress}%` }} /></div>
        </div>
      )}
      <div className={s.cardFooter}>
        <div className={s.cardDate}>{formatDate(project.createdAt)}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {project.feasibilityScore !== undefined && (
            <div className={s.feasibility}>
              <div className={`${s.feasibilityDot} ${feasibilityColor(project.feasibilityScore)}`} />
              <span className={s.feasibilityScore}>실현가능성 {Math.round(project.feasibilityScore * 100)}%</span>
            </div>
          )}
          <span className={s.cardArrow}>→</span>
        </div>
      </div>
    </Link>
  );
}

function NewProjectModal({ onClose, onCreate }: { onClose: () => void; onCreate: (p: Project) => void }) {
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState(GENRES[0]);
  const [target, setTarget] = useState("");
  const [concept, setConcept] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const id = uid();
    // Pre-seed genre+concept for Phase 1 auto-fill
    if (genre || concept.trim()) {
      localStorage.setItem(`wts_project_seed_${id}`, JSON.stringify({ genre, concept: concept.trim() }));
    }
    onCreate({ id, title: title.trim(), genre, targetAudience: target.trim() || "미설정", currentPhase: 1, status: "active", createdAt: new Date().toISOString() });
    onClose();
  }

  return (
    <div className={s.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={s.modal}>
        <div className={s.modalHeader}>
          <span className={s.modalTitle}>새 프로젝트 만들기</span>
          <button className={s.modalClose} onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className={s.formGroup}><label className={s.formLabel}>웹툰 제목 *</label><input className={s.formInput} placeholder="예) 별을 삼킨 소녀" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required /></div>
          <div className={s.formGroup}><label className={s.formLabel}>장르</label><select className={s.formSelect} value={genre} onChange={(e) => setGenre(e.target.value)}>{GENRES.map((g) => <option key={g} value={g}>{g}</option>)}</select></div>
          <div className={s.formGroup}><label className={s.formLabel}>타겟 독자</label><input className={s.formInput} placeholder="예) 20~30대 직장인" value={target} onChange={(e) => setTarget(e.target.value)} /></div>
          <div className={s.formGroup}><label className={s.formLabel}>초기 아이디어 (선택)</label><textarea className={s.formTextarea} placeholder="주인공, 핵심 갈등, 세계관 등 자유롭게 적어주세요" value={concept} onChange={(e) => setConcept(e.target.value)} /></div>
          <div className={s.formActions}><button type="button" className={s.btnGhost} onClick={onClose}>취소</button><button type="submit" className={s.btnPrimary}>✦ Phase 1 시작</button></div>
        </form>
      </div>
    </div>
  );
}

/** Read Phase 1 result from localStorage and update project fields */
function syncProjectProgress(project: Project): Project {
  try {
    const p1 = JSON.parse(localStorage.getItem(`wts_phase1_${project.id}`) ?? "null");
    if (p1?.data) {
      const score = p1.data.feasibility_score ?? p1.data.score;
      const updated = { ...project };
      if (score !== undefined) updated.feasibilityScore = Number(score);
      // Advance phase if Phase 2 done
      if (localStorage.getItem(`wts_phase2_${project.id}`)) updated.currentPhase = Math.max(updated.currentPhase, 2) as Phase;
      if (localStorage.getItem(`wts_phase3_done_${project.id}`)) updated.currentPhase = Math.max(updated.currentPhase, 3) as Phase;
      // Count Phase 4 done episodes
      let epCount = 0;
      for (let i = 1; i <= 100; i++) {
        if (localStorage.getItem(`wts_phase4_ep_${project.id}_${i}`)) epCount++;
      }
      if (epCount > 0) {
        updated.currentPhase = Math.max(updated.currentPhase, 4) as Phase;
        updated.episodeProgress = epCount;
      }
      // Count Phase 5 done episodes
      let p5count = 0;
      for (let i = 1; i <= 100; i++) {
        if (localStorage.getItem(`wts_phase5_ep_${project.id}_${i}`)) p5count++;
      }
      if (p5count > 0) updated.currentPhase = Math.max(updated.currentPhase, 5) as Phase;
      return updated;
    }
  } catch { /* ignore */ }
  return project;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const key = localStorage.getItem("wts_anthropic_key") ?? "";
    setHasApiKey(key.trim().length > 0);
  }, []);

  const loadAndSync = useCallback(() => {
    const raw = loadProjects();
    const synced = raw.map(syncProjectProgress);
    setProjects(synced);
    // Save synced state back only if something changed
    const changed = synced.some((p, i) =>
      p.feasibilityScore !== raw[i].feasibilityScore ||
      p.currentPhase !== raw[i].currentPhase ||
      p.episodeProgress !== raw[i].episodeProgress
    );
    if (changed) saveProjects(synced);
  }, []);

  useEffect(() => { loadAndSync(); }, [loadAndSync]);

  function handleCreate(project: Project) {
    const next = [project, ...projects];
    setProjects(next);
    saveProjects(next);
    // Navigate directly to Phase 1
    router.push(`/projects/${project.id}/phase-1`);
  }

  function handleDelete(id: string) {
    const next = projects.filter(p => p.id !== id);
    setProjects(next);
    saveProjects(next);
    // Clean up all phase data for the project
    const keysToRemove = [
      `wts_project_seed_${id}`,
      `wts_phase1_${id}`,
      `wts_phase2_${id}`,
      `wts_phase3_done_${id}`,
      `wts_phase3_data_${id}`,
      `wts_phase5_done_${id}`,
    ];
    for (let i = 1; i <= 100; i++) {
      keysToRemove.push(`wts_phase4_ep_${id}_${i}`, `wts_phase4_card_${id}_${i}`, `wts_phase5_ep_${id}_${i}`);
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  }

  const active = projects.filter((p) => p.status === "active");
  const inPhase4Plus = projects.filter((p) => p.currentPhase >= 4);
  const avgFeasibility = projects.filter((p) => p.feasibilityScore !== undefined).reduce((sum, p, _, arr) => sum + (p.feasibilityScore ?? 0) / arr.length, 0);

  return (
    <div className={s.root}>
      <header className={s.header}>
        <span className={s.headerTitle}>내 프로젝트</span>
        <div className={s.headerRight}><button className={s.btnPrimary} onClick={() => setShowModal(true)}>+ 새 프로젝트</button></div>
      </header>
      <main className={s.content}>
        {!hasApiKey && (
          <div className={s.apiBanner}>
            <div className={s.apiBannerLeft}>
              <span className={s.apiBannerIcon}>🔑</span>
              <div>
                <div className={s.apiBannerTitle}>Anthropic API 키가 필요합니다</div>
                <div className={s.apiBannerDesc}>Phase 1~5 에이전트 실행에 사용됩니다. 설정 페이지에서 sk-ant-api03-... 형식의 키를 입력해주세요.</div>
              </div>
            </div>
            <button className={s.apiBannerBtn} onClick={() => router.push("/settings")}>
              설정하기 →
            </button>
          </div>
        )}
        <div className={s.stats}>
          <div className={s.statCard}><span className={s.statLabel}>전체 프로젝트</span><span className={s.statValue}>{projects.length}</span><span className={s.statSub}>총 작업 수</span></div>
          <div className={s.statCard}><span className={s.statLabel}>진행 중</span><span className={s.statValue} style={{ color: "var(--primary)" }}>{active.length}</span><span className={s.statSub}>활성 프로젝트</span></div>
          <div className={s.statCard}><span className={s.statLabel}>대본/이미지</span><span className={s.statValue} style={{ color: "var(--phase-4-color)" }}>{inPhase4Plus.length}</span><span className={s.statSub}>Phase 4~5 진행 중</span></div>
          <div className={s.statCard}><span className={s.statLabel}>평균 실현가능성</span><span className={s.statValue} style={{ color: avgFeasibility >= 0.7 ? "var(--phase-2-color)" : avgFeasibility >= 0.5 ? "var(--phase-3-color)" : "var(--text)" }}>{projects.some((p) => p.feasibilityScore !== undefined) ? `${Math.round(avgFeasibility * 100)}%` : "—"}</span><span className={s.statSub}>Phase 1 기준</span></div>
        </div>
        <div className={s.sectionHeader}><span className={s.sectionTitle}>내 프로젝트</span><span className={s.sectionCount}>{projects.length}개</span></div>
        <div className={s.grid}>
          {projects.length === 0 ? (
            <div className={s.empty}><div className={s.emptyIcon}>✦</div><div className={s.emptyTitle}>아직 프로젝트가 없어요</div><div className={s.emptyDesc}>새 프로젝트를 만들면 7인의 AI 에이전트가 기획부터 대본까지 함께 만들어 드립니다.</div><button className={s.btnPrimary} onClick={() => setShowModal(true)}>첫 번째 프로젝트 시작하기</button></div>
          ) : projects.map((p) => <ProjectCard key={p.id} project={p} onDelete={handleDelete} />)}
        </div>
      </main>
      {showModal && <NewProjectModal onClose={() => setShowModal(false)} onCreate={handleCreate} />}
    </div>
  );
}
