"use client";

import { type ReactNode, useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

interface Props {
  children: ReactNode;
  params: { projectId: string };
}

// ─── Nav item definition ──────────────────────────────────────────────────────

interface NavItem {
  label: string;
  href: string;
  view?: string;     // search param value
  doneKey: string;   // how to check done
  prereqKey: string; // done key that must be true first
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "기획",
    items: [
      { label: "기획분석 보기", href: "/phase-1",               doneKey: "phase1",   prereqKey: "" },
    ],
  },
  {
    label: "세계관/에셋",
    items: [
      { label: "세계관",      href: "/phase-2?view=1",          doneKey: "stage1",   prereqKey: "phase1" },
      { label: "시놉시스",    href: "/phase-2?view=2",          doneKey: "stage2",   prereqKey: "stage1" },
      { label: "에셋 리스트", href: "/phase-2?view=assets",     doneKey: "assetList",prereqKey: "stage2" },
      { label: "캐릭터 설정", href: "/phase-2?view=3",          doneKey: "stage3",   prereqKey: "assetList" },
      { label: "장소 설정",   href: "/phase-2?view=4",          doneKey: "stage4",   prereqKey: "stage3" },
      { label: "소품·장비",   href: "/phase-2?view=5",          doneKey: "stage5",   prereqKey: "stage4" },
      { label: "스타일",      href: "/phase-2?view=style",      doneKey: "style",    prereqKey: "stage2" },
    ],
  },
  {
    label: "제작",
    items: [
      { label: "시리즈 로드맵", href: "/phase-3",               doneKey: "phase3",   prereqKey: "style" },
      { label: "30컷 대본",     href: "/phase-4",               doneKey: "phase4",   prereqKey: "phase3" },
      { label: "이미지 생성",   href: "/phase-5",               doneKey: "phase5",   prereqKey: "phase4" },
    ],
  },
];

// ─── Done-state resolver ───────────────────────────────────────────────────────

function computeDoneMap(projectId: string): Record<string, boolean> {
  try {
    const phase2Raw = localStorage.getItem(`wts_phase2_${projectId}`);
    const phase2 = phase2Raw ? (JSON.parse(phase2Raw) as { stageResults?: Array<{ stageId: number }> }) : null;
    const stageResults = phase2?.stageResults ?? [];
    const hasStage = (id: number) => stageResults.some((r) => r.stageId === id);

    return {
      phase1:   !!localStorage.getItem(`wts_phase1_${projectId}`),
      stage1:   hasStage(1),
      stage2:   hasStage(2),
      assetList:!!localStorage.getItem(`wts_asset_list_${projectId}`),
      stage3:   hasStage(3),
      stage4:   hasStage(4),
      stage5:   hasStage(5),
      style:    !!localStorage.getItem(`wts_style_${projectId}`),
      phase3:   !!localStorage.getItem(`wts_phase3_done_${projectId}`),
      phase4:   !!localStorage.getItem(`wts_phase4_done_${projectId}`),
      phase5:   !!localStorage.getItem(`wts_phase5_done_${projectId}`),
    };
  } catch {
    return {
      phase1: false, stage1: false, stage2: false, assetList: false,
      stage3: false, stage4: false, stage5: false, style: false,
      phase3: false, phase4: false, phase5: false,
    };
  }
}

function getProjectTitle(projectId: string): string {
  try {
    const raw = localStorage.getItem("wts_projects");
    if (!raw) return "";
    const projects = JSON.parse(raw) as Array<{ id: string; title: string }>;
    return projects.find((p) => p.id === projectId)?.title ?? "";
  } catch { return ""; }
}

// ─── Layout component ─────────────────────────────────────────────────────────

export default function ProjectLayout({ children, params }: Props) {
  const { projectId } = params;
  const pathname = usePathname();

  const [doneMap, setDoneMap] = useState<Record<string, boolean>>({});
  const [projectTitle, setProjectTitle] = useState("");

  // Re-read localStorage whenever the pathname changes
  useEffect(() => {
    setDoneMap(computeDoneMap(projectId));
    setProjectTitle(getProjectTitle(projectId));
  }, [projectId, pathname]);

  const isPhase2Active = pathname.includes("phase-2");

  return (
    <div style={{
      display: "flex",
      height: "100vh",
      overflow: "hidden",
      background: "#0d0d14",
    }}>
      {/* ── Sidebar ──────────────────────────────────────────────────────────── */}
      <aside style={{
        width: 220,
        flexShrink: 0,
        background: "#0e0e16",
        borderRight: "1px solid #1e1e2a",
        height: "100vh",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}>
        {/* Project name + back link */}
        <div style={{ padding: "16px 14px 12px" }}>
          <Link href="/projects" style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            fontSize: 11,
            color: "#3a3a52",
            textDecoration: "none",
            marginBottom: 8,
          }}>
            ← 프로젝트 목록
          </Link>
          {projectTitle && (
            <div style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#c8d0e0",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}>
              {projectTitle}
            </div>
          )}
        </div>

        <div style={{ borderTop: "1px solid #1e1e2a", flex: 1 }}>
          {NAV_GROUPS.map((group) => (
            <div key={group.label} style={{ padding: "14px 0 4px" }}>
              {/* Group label */}
              <div style={{
                fontSize: 10,
                fontWeight: 700,
                color: "#3a3a52",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                padding: "0 14px 6px",
              }}>
                {group.label}
              </div>

              {/* Nav items */}
              {group.items.map((item) => {
                const fullHref = `/projects/${projectId}${item.href}`;
                const isDone = !!doneMap[item.doneKey];
                const prereqDone = !item.prereqKey || !!doneMap[item.prereqKey];
                const isLocked = !prereqDone && !isDone;

                // Active detection: check if this item's path+view matches current URL
                const itemPath = item.href.split("?")[0]; // e.g. "/phase-2"
                const itemView = item.href.includes("?view=") ? item.href.split("?view=")[1] : null;
                const pathnameEndsWithSlug = pathname.endsWith(itemPath) || pathname.includes(itemPath + "?") || pathname.includes(itemPath + "/");

                // For phase-2 items, also check search params
                let isActive = false;
                if (itemPath === "/phase-2" && isPhase2Active) {
                  // We can't read searchParams inside layout (it would need Suspense)
                  // Instead we dim all phase-2 items when on phase-2 page
                  isActive = false; // handled via dimly highlight below
                } else {
                  isActive = pathnameEndsWithSlug && !itemView;
                }

                // Phase-2 items get a dim highlight when on phase-2 page
                const isDimActive = isPhase2Active && itemPath === "/phase-2";

                const statusIcon = isLocked ? "🔒" : isDone ? "✓" : "○";

                return (
                  <Link
                    key={item.label}
                    href={isLocked ? "#" : fullHref}
                    onClick={(e) => { if (isLocked) e.preventDefault(); }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 13,
                      padding: "5px 14px 5px 22px",
                      textDecoration: "none",
                      color: isLocked
                        ? "#2a2a4a"
                        : isDone
                        ? "#64748b"
                        : isActive
                        ? "#a78bfa"
                        : isDimActive
                        ? "#7878a0"
                        : "#c8d0e0",
                      background: isActive
                        ? "rgba(124,108,252,0.1)"
                        : isDimActive
                        ? "rgba(124,108,252,0.03)"
                        : "transparent",
                      borderLeft: isActive ? "2px solid rgba(124,108,252,0.5)" : "2px solid transparent",
                      cursor: isLocked ? "not-allowed" : "pointer",
                      transition: "background 0.12s, color 0.12s",
                    }}
                  >
                    <span style={{
                      fontSize: 10,
                      width: 14,
                      flexShrink: 0,
                      color: isDone ? "#34d399" : isLocked ? "#2a2a4a" : "#5a5a7a",
                    }}>
                      {statusIcon}
                    </span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      </aside>

      {/* ── Content area ──────────────────────────────────────────────────────── */}
      <div style={{
        flex: 1,
        height: "100vh",
        overflow: "hidden",
        minWidth: 0,
      }}>
        {children}
      </div>
    </div>
  );
}
