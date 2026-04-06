"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";

const AGENTS = {
  strategist:   { label: "전략 기획자",    color: "#a78bfa", bg: "rgba(167,139,250,0.12)" },
  researcher:   { label: "심층 조사자",    color: "#34d399", bg: "rgba(52,211,153,0.12)"  },
  worldbuilder: { label: "세계관 설계자",  color: "#60a5fa", bg: "rgba(96,165,250,0.12)"  },
  character:    { label: "캐릭터 디자이너",color: "#fb923c", bg: "rgba(251,146,60,0.12)"  },
  scenario:     { label: "시나리오 작가",  color: "#fbbf24", bg: "rgba(251,191,36,0.12)"  },
  script:       { label: "대본/연출 작가", color: "#f87171", bg: "rgba(248,113,113,0.12)" },
  producer:     { label: "총괄 프로듀서",  color: "#f1f5f9", bg: "rgba(241,245,249,0.12)" },
  user:         { label: "나",             color: "#7c6cfc", bg: "rgba(124,108,252,0.12)" },
} as const;
type AgentId = keyof typeof AGENTS;

interface Msg {
  id: string;
  agent: AgentId;
  text: string;
  type: "text" | "thinking" | "card";
  card?: {
    score: number;
    verdict: "go" | "conditional" | "reject";
    usp: string[];
    summary: string;
  };
  done: boolean;
}

type Stage = "form" | "chat";

const GENRES = ["판타지", "로맨스", "액션", "SF", "스릴러", "일상·힐링", "무협", "스포츠", "공포", "역사"];

const scoreMap: Record<string, number> = {
  "판타지": 0.82,
  "로맨스": 0.79,
  "액션": 0.76,
  "SF": 0.74,
  "스릴러": 0.71,
  "일상·힐링": 0.68,
  "무협": 0.73,
  "스포츠": 0.69,
  "공포": 0.66,
  "역사": 0.72,
};

const uspByGenre: Record<string, string[]> = {
  "판타지": [
    "매화 마지막 컷 반전이 독자의 다음화 클릭을 유도",
    "세계관 규칙이 퍼즐처럼 작동해 독자 참여도 극대화",
    "주조연 모두 뚜렷한 동기로 악당도 이해 가능",
  ],
  "로맨스": [
    "감정선이 과장 없이 현실적으로 쌓여 몰입 극대화",
    "대사 밀도가 높아 매 컷이 스크린샷 욕구를 자극",
    "조력자들의 독립 서사가 2차 팬덤 형성",
  ],
  "액션": [
    "전투 씬의 운동감이 정지 컷에서도 살아있음",
    "주인공의 성장 곡선이 독자 카타르시스와 정확히 동기화",
    "악당의 철학이 독자에게 도덕적 질문을 던짐",
  ],
  "SF": [
    "과학적 개연성이 세계관 몰입도를 배가시킴",
    "미래 사회의 비틀린 현실이 현재 독자와 공명",
    "기술 vs 인간성 갈등이 보편적 감정을 자극",
  ],
  "스릴러": [
    "정보 비대칭이 독자 긴장감을 지속적으로 유지",
    "반전 복선이 재독 욕구를 극대화",
    "일상적 공간의 공포화가 공감 불안을 생성",
  ],
  "일상·힐링": [
    "소소한 디테일이 독자의 감정 이입을 극대화",
    "캐릭터 성장이 느리지만 확실하게 체감됨",
    "위로의 메시지가 직접적이지 않고 자연스럽게 스며듦",
  ],
  "무협": [
    "무공 체계가 일관된 규칙으로 독자 이해를 높임",
    "사제 관계와 의리 서사가 강한 감정 유대 형성",
    "강호 정치 구도가 복잡하지 않고 직관적으로 이해됨",
  ],
  "스포츠": [
    "경기 씬의 긴장감이 실황 중계처럼 몰입감을 선사",
    "팀 케미스트리가 독자의 응원 감정을 자극",
    "패배와 극복의 사이클이 감동을 증폭시킴",
  ],
  "공포": [
    "공포의 근원이 명확하지 않아 독자 상상력을 자극",
    "일상과 비일상의 경계가 불분명해 현실감을 극대화",
    "등장인물의 반응이 현실적이어서 공감 공포를 유발",
  ],
  "역사": [
    "역사적 사실과 허구가 자연스럽게 융합되어 재미와 교양을 동시에 제공",
    "현대적 감각으로 재해석된 시대상이 젊은 독자층에 어필",
    "역사 속 인물의 인간적 면모가 친근감을 형성",
  ],
};

const matchByGenre: Record<string, number> = {
  "판타지": 78, "로맨스": 82, "액션": 74, "SF": 71, "스릴러": 69,
  "일상·힐링": 65, "무협": 76, "스포츠": 72, "공포": 67, "역사": 70,
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function typingDelay(text: string) {
  const base = Math.min(2400, Math.max(800, text.length * 18));
  return base;
}

interface ResultCardProps {
  card: NonNullable<Msg["card"]>;
}

function ResultCard({ card }: ResultCardProps) {
  const { score, verdict, usp, summary } = card;
  const pct = Math.round(score * 100);

  const circumference = 2 * Math.PI * 42;
  const offset = circumference - (pct / 100) * circumference;

  const verdictLabel =
    verdict === "go" ? "✓ 진행 가능" : verdict === "conditional" ? "△ 조건부 진행" : "✗ 재검토 필요";
  const verdictClass =
    verdict === "go" ? styles.verdictGo : verdict === "conditional" ? styles.verdictConditional : styles.verdictReject;

  const gaugeColor =
    score >= 0.7 ? "#34d399" : score >= 0.5 ? "#fbbf24" : "#f87171";

  return (
    <div className={styles.resultCard}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8", marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.08em" }}>
        실현가능성 평가
      </div>
      <div className={styles.gaugeWrap}>
        <svg width="100" height="100" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="42" fill="none" stroke="#2a2a3d" strokeWidth="8" />
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke={gaugeColor}
            strokeWidth="8"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform="rotate(-90 50 50)"
            style={{ transition: "stroke-dashoffset 0.8s ease" }}
          />
          <text x="50" y="45" textAnchor="middle" fill="#f1f5f9" fontSize="18" fontWeight="700">
            {pct}
          </text>
          <text x="50" y="60" textAnchor="middle" fill="#64748b" fontSize="10">
            점
          </text>
        </svg>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div className={`${styles.verdictBadge} ${verdictClass}`}>{verdictLabel}</div>
          <div style={{ fontSize: 13, color: "#94a3b8", maxWidth: 220, lineHeight: 1.6 }}>{summary}</div>
        </div>
      </div>
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
          핵심 USP
        </div>
        <ul className={styles.uspList}>
          {usp.map((u, i) => (
            <li key={i}>{u}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

interface ThinkingDotsProps {}

function ThinkingDots(_: ThinkingDotsProps) {
  return (
    <span className={styles.thinkingDots}>
      <span className={styles.dot} style={{ animationDelay: "0ms" }} />
      <span className={styles.dot} style={{ animationDelay: "160ms" }} />
      <span className={styles.dot} style={{ animationDelay: "320ms" }} />
    </span>
  );
}

interface MsgBubbleProps {
  msg: Msg;
}

function MsgBubble({ msg }: MsgBubbleProps) {
  const agent = AGENTS[msg.agent];
  const isUser = msg.agent === "user";

  return (
    <div className={`${styles.msgRow} ${isUser ? styles.msgRowUser : ""}`}>
      {!isUser && (
        <div
          className={styles.avatar}
          style={{ background: agent.bg, color: agent.color, border: `1px solid ${agent.color}30` }}
        >
          {agent.label[0]}
        </div>
      )}
      <div className={styles.msgContent}>
        {!isUser && (
          <span className={styles.agentName} style={{ color: agent.color }}>
            {agent.label}
          </span>
        )}
        <div className={`${styles.bubble} ${isUser ? styles.bubbleUser : ""}`}>
          {!msg.done ? (
            msg.type === "thinking" ? (
              <span style={{ color: "#64748b", fontStyle: "italic", fontSize: 14 }}>
                {msg.text}
                <ThinkingDots />
              </span>
            ) : (
              <ThinkingDots />
            )
          ) : msg.type === "card" && msg.card ? (
            <>
              <div style={{ marginBottom: 12, whiteSpace: "pre-wrap", lineHeight: 1.7, fontSize: 14 }}>{msg.text}</div>
              <ResultCard card={msg.card} />
            </>
          ) : (
            <div
              style={{ whiteSpace: "pre-wrap", lineHeight: 1.7, fontSize: 14 }}
              dangerouslySetInnerHTML={{
                __html: msg.text
                  .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
                  .replace(/\n/g, "<br/>"),
              }}
            />
          )}
        </div>
      </div>
      {isUser && (
        <div
          className={styles.avatar}
          style={{ background: agent.bg, color: agent.color, border: `1px solid ${agent.color}30` }}
        >
          나
        </div>
      )}
    </div>
  );
}

export default function Phase1Page({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const router = useRouter();

  const [stage, setStage] = useState<Stage>("form");
  const [genre, setGenre] = useState("판타지");
  const [concept, setConcept] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [userInput, setUserInput] = useState("");
  const [chatRunning, setChatRunning] = useState(false);
  const [result, setResult] = useState<Msg["card"] | null>(null);
  const [restoredFromSave, setRestoredFromSave] = useState(false);

  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (bodyRef.current) {
        bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
      }
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    const key = `wts_phase1_${projectId}`;
    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as {
          data: NonNullable<Msg["card"]>;
          input: { genre: string; concept: string };
          isMock: boolean;
          savedAt: string;
        };
        if (parsed.data && parsed.input) {
          setGenre(parsed.input.genre);
          setConcept(parsed.input.concept);
          setResult(parsed.data);
          setRestoredFromSave(true);
        }
      } catch {
        // ignore
      }
    }
  }, [projectId]);

  const addMsg = useCallback(
    (
      msg: Omit<Msg, "id" | "done">,
      delay: number,
      onAdded?: () => void
    ): Promise<void> => {
      return new Promise((resolve) => {
        const id = uid();
        const reveal = typingDelay(msg.text);

        const t1 = setTimeout(() => {
          setMessages((prev) => [...prev, { ...msg, id, done: false }]);
          scrollToBottom();
          onAdded?.();

          const t2 = setTimeout(() => {
            setMessages((prev) =>
              prev.map((m) => (m.id === id ? { ...m, done: true } : m))
            );
            scrollToBottom();
            resolve();
          }, reveal);
          timeoutsRef.current.push(t2);
        }, delay);
        timeoutsRef.current.push(t1);
      });
    },
    [scrollToBottom]
  );

  const runMockScript = useCallback(
    async (g: string, c: string) => {
      setChatRunning(true);
      const score = scoreMap[g] ?? 0.68;
      const usp = uspByGenre[g] ?? uspByGenre["판타지"];
      const match = matchByGenre[g] ?? 70;
      const verdictVal: "go" | "conditional" | "reject" =
        score >= 0.7 ? "go" : score >= 0.5 ? "conditional" : "reject";
      const summaryText = `${g} 장르 기반 아이디어가 현재 시장 트렌드와 높은 적합도를 보입니다. 핵심 USP 3가지가 명확히 도출되었으며, 독자층 확보 가능성이 충분합니다. 세계관 구체화 및 캐릭터 설정 단계로 진행을 권장합니다.`;

      const cardData: NonNullable<Msg["card"]> = {
        score,
        verdict: verdictVal,
        usp,
        summary: summaryText,
      };

      const conceptSnippet = c.length > 40 ? c.slice(0, 40) + "…" : c;

      await addMsg(
        { agent: "strategist", type: "thinking", text: "입력하신 아이디어를 분석하고 있습니다..." },
        300
      );

      await addMsg(
        {
          agent: "strategist",
          type: "text",
          text: `장르 포지셔닝 분석을 시작합니다. ${g} 장르는 현재 웹툰 플랫폼에서 상위 독자층이 가장 높은 관심을 보이는 분야입니다. 핵심 차별점과 독자 훅을 도출하겠습니다.\n\n개념 요약: "${conceptSnippet}"`,
        },
        200
      );

      await addMsg(
        { agent: "researcher", type: "thinking", text: "시장 데이터를 조회하고 있습니다..." },
        400
      );

      await addMsg(
        {
          agent: "researcher",
          type: "text",
          text: `최근 6개월 데이터 분석 완료. ${g} 신작 중 월간 독자 100만 달성 작품의 공통 패턴:\n① 1~3화 내 주인공 목표 명확화\n② 매 5화 훅 배치\n③ 조력자 캐릭터 독립 서사 보유\n\n현재 아이디어는 이 패턴과 ${match}% 일치합니다.`,
        },
        300
      );

      await addMsg(
        {
          agent: "strategist",
          type: "text",
          text: `USP 3가지를 도출했습니다:\n\n**U1. ${usp[0]}**\n**U2. ${usp[1]}**\n**U3. ${usp[2]}**\n\n이 세 가지 요소가 기존 작품과 차별화되는 핵심입니다.`,
        },
        400
      );

      await addMsg(
        {
          agent: "producer",
          type: "card",
          text: "전략기획자와 조사자의 분석을 종합했습니다. 최종 실현가능성 평가입니다.",
          card: cardData,
        },
        500
      );

      setResult(cardData);
      const key = `wts_phase1_${projectId}`;
      localStorage.setItem(
        key,
        JSON.stringify({
          data: cardData,
          input: { genre: g, concept: c },
          isMock: true,
          savedAt: new Date().toISOString(),
        })
      );
      setChatRunning(false);
    },
    [addMsg, projectId]
  );

  const handleFormSubmit = useCallback(() => {
    if (concept.trim().length < 10) return;
    setStage("chat");
    setTimeout(() => {
      runMockScript(genre, concept);
    }, 100);
  }, [concept, genre, runMockScript]);

  const handleUserSend = useCallback(() => {
    const text = userInput.trim();
    if (!text || chatRunning) return;
    setUserInput("");

    const userId = uid();
    setMessages((prev) => [
      ...prev,
      { id: userId, agent: "user", type: "text", text, done: true },
    ]);

    setChatRunning(true);

    const replies = [
      `말씀하신 부분은 매우 중요한 지점입니다. "${text.slice(0, 30)}${text.length > 30 ? "…" : ""}"에 대해 추가 분석을 진행하겠습니다. 특히 독자 감정 곡선과의 연계성을 검토해 보겠습니다.`,
      `좋은 관점입니다. 제안하신 방향성은 현재 ${genre} 장르의 주요 독자층이 기대하는 패턴과 잘 맞아떨어집니다. 구체적인 씬 설계에서 이 요소를 반영할 것을 권장합니다.`,
      `독자의 관점에서 접근하신 부분이 핵심을 잘 짚었습니다. 이 방향으로 세계관을 구체화하면 Phase 2에서 더욱 강력한 에셋을 구축할 수 있을 것입니다.`,
    ];
    const pick = replies[Math.floor(Math.random() * replies.length)];

    const t1 = setTimeout(() => {
      addMsg({ agent: "strategist", type: "text", text: pick }, 0).then(() => {
        const producerText = `추가 의견을 반영하여 최종 분석을 업데이트합니다. 현재까지의 논의를 바탕으로 Phase 2 진행 준비가 완료되었습니다.`;
        addMsg({ agent: "producer", type: "text", text: producerText }, 200).then(() => {
          setChatRunning(false);
        });
      });
    }, 800);
    timeoutsRef.current.push(t1);
  }, [userInput, chatRunning, addMsg, genre]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleUserSend();
      }
    },
    [handleUserSend]
  );

  useEffect(() => {
    return () => {
      timeoutsRef.current.forEach(clearTimeout);
    };
  }, []);

  const conceptSnippet = concept.length > 60 ? concept.slice(0, 60) + "…" : concept;

  return (
    <div className={styles.page}>
      {stage === "form" ? (
        <div className={styles.formWrap}>
          {restoredFromSave && result && (
            <div
              style={{
                background: "rgba(52,211,153,0.08)",
                border: "1px solid rgba(52,211,153,0.25)",
                borderRadius: 10,
                padding: "10px 16px",
                marginBottom: 16,
                fontSize: 13,
                color: "#34d399",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span>✓</span>
              <span>이전 분석 결과 불러옴 — 다시 분석하거나 Phase 2로 이동할 수 있습니다.</span>
            </div>
          )}
          <div className={styles.formCard}>
            <div className={styles.formTitle}>Phase 1 — 기획 분석</div>
            <div className={styles.formDesc}>
              장르와 아이디어를 입력하면 AI 에이전트들이 실시간으로 토론하며 기획을 분석합니다.
            </div>

            <label className={styles.formLabel}>장르</label>
            <select
              className={styles.formSelect}
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
            >
              {GENRES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>

            <label className={styles.formLabel}>아이디어 / 개념</label>
            <textarea
              className={styles.formTextarea}
              value={concept}
              onChange={(e) => setConcept(e.target.value)}
              placeholder="주인공, 핵심 갈등, 세계관의 특징, 목표 독자층 등을 자유롭게 서술하세요. (최소 10자)"
              rows={5}
            />
            <div style={{ fontSize: 12, color: concept.length < 10 ? "#f87171" : "#34d399", marginTop: 4 }}>
              {concept.length}자 {concept.length < 10 ? `(최소 ${10 - concept.length}자 더 필요)` : "✓"}
            </div>

            <button
              className={styles.btnStart}
              disabled={concept.trim().length < 10}
              onClick={handleFormSubmit}
            >
              ✦ 분석 시작
            </button>

            {restoredFromSave && result && (
              <button
                className={styles.btnStart}
                style={{ marginTop: 10, background: "#1e4d3a", borderColor: "#34d399", color: "#34d399" }}
                onClick={() => router.push(`/projects/${projectId}/phase-2`)}
              >
                Phase 2 시작 →
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className={styles.chatLayout}>
          <div className={styles.chatHeader}>
            <span style={{ color: "#a78bfa", fontWeight: 600 }}>{genre}</span>
            <span style={{ color: "#64748b", margin: "0 8px" }}>·</span>
            <span style={{ color: "#94a3b8", fontSize: 13 }}>{conceptSnippet}</span>
          </div>

          <div className={styles.chatBody} ref={bodyRef}>
            {messages.map((msg) => (
              <MsgBubble key={msg.id} msg={msg} />
            ))}
            <div style={{ height: 16 }} />
          </div>

          {result && (
            <div className={styles.gatingRow}>
              <button
                className={styles.btnGating}
                onClick={() => router.push(`/projects/${projectId}/phase-2`)}
              >
                Phase 2 시작 — 세계관 설계 →
              </button>
            </div>
          )}

          <div className={styles.chatInputRow}>
            <textarea
              ref={inputRef}
              className={styles.chatInput}
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="에이전트에게 추가 질문이나 의견을 보내세요… (Enter 전송, Shift+Enter 줄바꿈)"
              rows={1}
              disabled={chatRunning}
            />
            <button
              className={styles.btnSend}
              onClick={handleUserSend}
              disabled={!userInput.trim() || chatRunning}
            >
              전송
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
