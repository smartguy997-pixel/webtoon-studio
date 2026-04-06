"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import s from "./page.module.css";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

// ── Types ─────────────────────────────────────────────────
interface DesignOption {
  label: "A" | "B";
  style: string;
  keywords: string[];
  image_prompt: string;
  emoji: string;
}

interface AssetItem {
  id: string;
  name: string;
  type: "character" | "location" | "prop";
  role?: string;
  description: string;
  design_options: [DesignOption, DesignOption];
  selected?: "A" | "B";
}

interface WorldDesign {
  era: string;
  atmosphere: string;
  rules: string[];
}

interface Phase2Data {
  world_design: WorldDesign;
  asset_list: AssetItem[];
}

interface SavedResult {
  data: Phase2Data;
  isMock: boolean;
  savedAt: string;
}

// ── Mock generator ────────────────────────────────────────
function buildMock(genre: string, title?: string): Phase2Data {
  const genreEmojis: Record<string, string[]> = {
    "판타지": ["🧙", "🏰", "⚔️", "🐉"],
    "로맨스": ["💫", "🏙️", "🌸", "☕"],
    "액션": ["🥷", "🏙️", "💥", "🔫"],
    "SF": ["🤖", "🚀", "💻", "🌌"],
  };
  const emojis = genreEmojis[genre] ?? ["👤", "🏛️", "✨", "🔮"];

  const worldByGenre: Record<string, WorldDesign> = {
    "판타지": {
      era: "중세 마법 세계 — 왕국 붕괴 이후 100년",
      atmosphere: "마법이 서서히 사라지는 황혼의 세계. 기술과 마법이 공존하는 과도기",
      rules: ["마법 사용 시 수명 소모", "왕족 혈통만 드래곤과 계약 가능", "죽은 자는 48시간 후 부활 불가"],
    },
    "로맨스": {
      era: "현대 서울 — 강남구 패션 업계",
      atmosphere: "화려한 겉모습 뒤에 숨겨진 상처들. 빠르게 변하는 트렌드처럼 관계도 변한다",
      rules: ["업계 내 연애 금지 불문율", "SNS 이미지가 곧 실력", "시즌마다 주도권이 바뀐다"],
    },
  };
  const world = worldByGenre[genre] ?? {
    era: `${genre} 세계관 설정`,
    atmosphere: "독자가 몰입할 수 있는 생동감 있는 세계",
    rules: ["내부 세계 규칙 A", "내부 세계 규칙 B", "내부 세계 규칙 C"],
  };

  const assets: AssetItem[] = [
    {
      id: "char-1",
      name: title ? `${title.slice(0, 2)} 주인공` : "이루다",
      type: "character",
      role: "주인공",
      description: "평범해 보이지만 숨겨진 능력을 가진 20대 초반",
      design_options: [
        {
          label: "A", style: "청순 자연미인형", keywords: ["다크서클", "수수한 교복", "묶은 머리"],
          image_prompt: "young woman, natural beauty, simple school uniform, tied hair, warm eyes",
          emoji: emojis[0],
        },
        {
          label: "B", style: "강렬 인상파", keywords: ["날카로운 눈", "짧은 머리", "검정 코트"],
          image_prompt: "young woman, sharp eyes, short hair, black coat, confident pose",
          emoji: emojis[0],
        },
      ],
    },
    {
      id: "char-2",
      name: "라이벌",
      type: "character",
      role: "라이벌 / 조력자",
      description: "주인공과 대립하다 서서히 동료가 되는 캐릭터",
      design_options: [
        {
          label: "A", style: "냉미남 엘리트", keywords: ["금발", "정장", "차가운 표정"],
          image_prompt: "young man, blonde hair, formal suit, cold expression, elite appearance",
          emoji: emojis[0],
        },
        {
          label: "B", style: "까칠 야성미", keywords: ["은발", "캐주얼", "반말"],
          image_prompt: "young man, silver hair, casual wear, rugged look, rebellious",
          emoji: emojis[0],
        },
      ],
    },
    {
      id: "loc-1",
      name: "주 배경",
      type: "location",
      description: "이야기의 중심이 되는 주요 장소",
      design_options: [
        {
          label: "A", style: "웅장 고전풍", keywords: ["높은 천장", "스테인드글라스", "석조 건물"],
          image_prompt: "grand classical architecture, high ceilings, stained glass, stone building, dramatic lighting",
          emoji: emojis[1],
        },
        {
          label: "B", style: "현대 미니멀", keywords: ["유리 파사드", "철골 구조", "야경"],
          image_prompt: "modern minimalist building, glass facade, steel structure, city night view",
          emoji: emojis[1],
        },
      ],
    },
    {
      id: "loc-2",
      name: "비밀 장소",
      type: "location",
      description: "주인공만 아는 숨겨진 공간",
      design_options: [
        {
          label: "A", style: "신비 자연 동굴", keywords: ["발광 식물", "지하 호수", "결정체"],
          image_prompt: "mystical cave, bioluminescent plants, underground lake, crystal formations",
          emoji: emojis[1],
        },
        {
          label: "B", style: "옥상 비밀 정원", keywords: ["야경 뷰", "넝쿨 식물", "야외 소파"],
          image_prompt: "rooftop secret garden, city night view, climbing plants, outdoor couch",
          emoji: emojis[1],
        },
      ],
    },
  ];

  return { world_design: world, asset_list: assets };
}

// ── Storage helpers ───────────────────────────────────────
const getKey = (id: string) => `wts_phase2_${id}`;

function loadResult(projectId: string): SavedResult | null {
  try {
    const raw = localStorage.getItem(getKey(projectId));
    return raw ? (JSON.parse(raw) as SavedResult) : null;
  } catch { return null; }
}

function saveResult(projectId: string, r: SavedResult) {
  localStorage.setItem(getKey(projectId), JSON.stringify(r));
}

// ── AssetCard ─────────────────────────────────────────────
function AssetCard({ asset }: { asset: AssetItem }) {
  const tagClass = asset.type === "character" ? s.tagChar : asset.type === "location" ? s.tagLoc : s.tagProp;
  const tagLabel = asset.type === "character" ? "캐릭터" : asset.type === "location" ? "배경" : "소품";

  return (
    <div className={s.assetCard}>
      <span className={`${s.assetTag} ${tagClass}`}>{tagLabel}</span>
      <div className={s.assetName}>{asset.name}</div>
      {asset.role && <div className={s.assetRole}>{asset.role}</div>}
      <div className={s.assetDesc}>{asset.description}</div>
    </div>
  );
}

// ── ABCard ────────────────────────────────────────────────
function ABSelector({
  asset,
  onSelect,
}: {
  asset: AssetItem;
  onSelect: (id: string, choice: "A" | "B") => void;
}) {
  const tagClass = asset.type === "character" ? s.tagChar : asset.type === "location" ? s.tagLoc : s.tagProp;
  const tagLabel = asset.type === "character" ? "캐릭터" : "배경";

  return (
    <div className={s.abSection}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span className={`${s.assetTag} ${tagClass}`}>{tagLabel}</span>
        <div className={s.abTitle}>{asset.name}</div>
        {asset.selected && (
          <span className={s.selectedBadge}>✓ {asset.selected} 선택됨</span>
        )}
      </div>
      <div className={s.abSubtitle}>{asset.description}</div>
      <div className={s.abGrid}>
        {asset.design_options.map((opt) => (
          <div
            key={opt.label}
            className={`${s.abCard} ${asset.selected === opt.label ? s.abCardSelected : ""}`}
            onClick={() => onSelect(asset.id, opt.label)}
          >
            <div className={s.abLabel}>디자인 {opt.label}</div>
            <div className={s.abImagePlaceholder}>{opt.emoji}</div>
            <div className={s.abDesc}>
              <strong>{opt.style}</strong>
            </div>
            <div className={s.abKeywords}>
              {opt.keywords.map((k) => <span key={k} className={s.abKeyword}>{k}</span>)}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4, lineHeight: 1.4 }}>
              {opt.image_prompt}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────
export default function Phase2Page({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const router = useRouter();

  const [result, setResult] = useState<SavedResult | null>(null);
  const [running, setRunning] = useState(false);
  const [isMock, setIsMock] = useState(false);
  const [hasPhase1, setHasPhase1] = useState(false);

  useEffect(() => {
    const phase1 = localStorage.getItem(`wts_phase1_${projectId}`);
    setHasPhase1(!!phase1);
    const saved = loadResult(projectId);
    if (saved) { setResult(saved); setIsMock(saved.isMock); }
  }, [projectId]);

  async function runPhase2() {
    setRunning(true);

    const phase1Raw = localStorage.getItem(`wts_phase1_${projectId}`);
    const phase1 = phase1Raw ? JSON.parse(phase1Raw) as { input: { genre: string; title?: string }; isMock: boolean } : null;
    const genre = phase1?.input.genre ?? "판타지";
    const title = phase1?.input.title;
    const anthropicKey = localStorage.getItem("wts_anthropic_key") ?? "";

    let useMock = !anthropicKey;
    let data: Phase2Data | null = null;

    if (!useMock) {
      try {
        const res = await fetch(`${API_BASE}/api/phases/${projectId}/phase-2`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Anthropic-Key": anthropicKey },
          body: JSON.stringify({}),
          signal: AbortSignal.timeout(90000),
        });
        if (!res.ok) throw new Error(`${res.status}`);
        const json = await res.json() as { data: Phase2Data };
        data = json.data;
        setIsMock(false);
      } catch { useMock = true; }
    }

    if (useMock) {
      await new Promise((r) => setTimeout(r, 1200));
      data = buildMock(genre, title);
      setIsMock(true);
    }

    if (!data) { setRunning(false); return; }

    const saved: SavedResult = { data, isMock: useMock, savedAt: new Date().toISOString() };
    saveResult(projectId, saved);
    setResult(saved);
    setRunning(false);
  }

  function handleSelect(assetId: string, choice: "A" | "B") {
    if (!result) return;
    const updated: SavedResult = {
      ...result,
      data: {
        ...result.data,
        asset_list: result.data.asset_list.map((a) =>
          a.id === assetId ? { ...a, selected: choice } : a
        ),
      },
    };
    saveResult(projectId, updated);
    setResult(updated);
  }

  const allSelected = result?.data.asset_list.every((a) => !!a.selected) ?? false;
  const selectedCount = result?.data.asset_list.filter((a) => !!a.selected).length ?? 0;
  const totalCount = result?.data.asset_list.length ?? 0;

  return (
    <div className={s.page}>
      <h1 className={s.pageTitle}>Phase 2 — 세계관 & 에셋 설계</h1>
      <p className={s.pageDesc}>
        세계관 설정과 캐릭터·배경 에셋을 설계합니다. A/B 디자인 중 하나를 선택하면 Phase 5 이미지 생성에 사용됩니다.
      </p>

      {!hasPhase1 && (
        <div className={s.prereqBox}>
          ⚠ Phase 1 기획 분석을 먼저 완료해주세요.&nbsp;
          <Link href={`/projects/${projectId}/phase-1`} style={{ color: "inherit", textDecoration: "underline" }}>
            Phase 1로 이동 →
          </Link>
        </div>
      )}

      <div className={s.runRow}>
        <button
          className={s.btnPrimary}
          onClick={runPhase2}
          disabled={running || !hasPhase1}
        >
          {running ? (
            <><span className={s.spinnerInline} /> 세계관 설계 중…</>
          ) : result ? "↺ 다시 설계" : "✦ 세계관 & 에셋 설계 시작"}
        </button>
        {isMock && result && (
          <span className={s.mockBadge}>⚠ mock 데이터</span>
        )}
      </div>

      {result && (
        <>
          {/* World design */}
          <div className={s.section}>
            <div className={s.sectionHeader}>
              <div className={s.sectionTitle}>🌍 세계관 설정</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ padding: "10px 14px", background: "var(--surface-2)", borderRadius: "var(--radius-sm)", borderLeft: "3px solid var(--primary)" }}>
                <div style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 700, marginBottom: 3 }}>시대/배경</div>
                <div style={{ fontSize: 14, color: "var(--text)" }}>{result.data.world_design.era}</div>
              </div>
              <div style={{ padding: "10px 14px", background: "var(--surface-2)", borderRadius: "var(--radius-sm)", borderLeft: "3px solid var(--phase-3-color)" }}>
                <div style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 700, marginBottom: 3 }}>분위기</div>
                <div style={{ fontSize: 14, color: "var(--text)" }}>{result.data.world_design.atmosphere}</div>
              </div>
              <div style={{ padding: "10px 14px", background: "var(--surface-2)", borderRadius: "var(--radius-sm)", borderLeft: "3px solid var(--phase-2-color)" }}>
                <div style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 700, marginBottom: 8 }}>세계관 규칙</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {result.data.world_design.rules.map((r, i) => (
                    <div key={i} style={{ fontSize: 13, color: "var(--text-muted)", display: "flex", gap: 8 }}>
                      <span style={{ color: "var(--phase-2-color)", fontWeight: 700, flexShrink: 0 }}>R{i + 1}</span>
                      {r}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Asset list */}
          <div className={s.section}>
            <div className={s.sectionHeader}>
              <div className={s.sectionTitle}>📦 에셋 목록</div>
              <span className={s.sectionCount}>{result.data.asset_list.length}개</span>
            </div>
            <div className={s.assetGrid}>
              {result.data.asset_list.map((a) => <AssetCard key={a.id} asset={a} />)}
            </div>
          </div>

          {/* Progress bar */}
          <div className={s.progressBar}>
            <div className={s.progressLabel}>
              <span>A/B 디자인 선택 진행도</span>
              <span>{selectedCount} / {totalCount}</span>
            </div>
            <div className={s.progressTrack}>
              <div className={s.progressFill} style={{ width: `${totalCount ? (selectedCount / totalCount) * 100 : 0}%` }} />
            </div>
          </div>

          {/* AB selectors */}
          {result.data.asset_list.map((asset) => (
            <ABSelector key={asset.id} asset={asset} onSelect={handleSelect} />
          ))}

          {/* Gating */}
          {allSelected ? (
            <div className={s.gatingBanner}>
              <div className={s.gatingText}>
                <h3>✓ 모든 에셋 선택 완료 — Phase 3 진행 가능</h3>
                <p>캐릭터와 배경 디자인이 모두 확정됐습니다. Phase 3에서 100화 시리즈 로드맵을 작성합니다.</p>
              </div>
              <button className={s.btnGating} onClick={() => router.push(`/projects/${projectId}/phase-3`)}>
                Phase 3 시작 →
              </button>
            </div>
          ) : (
            <div style={{ textAlign: "center", fontSize: 13, color: "var(--text-dim)", padding: "16px 0" }}>
              {totalCount - selectedCount}개 에셋의 A/B 선택이 남았습니다
            </div>
          )}
        </>
      )}
    </div>
  );
}
