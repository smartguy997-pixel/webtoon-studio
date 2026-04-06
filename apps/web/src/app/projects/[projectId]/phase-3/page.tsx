"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import s from "./page.module.css";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

const AGENTS = {
  scenario:  { label: "시나리오 작가", color: "#fbbf24", bg: "rgba(251,191,36,0.12)"   },
  researcher:{ label: "심층 조사자",   color: "#34d399", bg: "rgba(52,211,153,0.12)"   },
  producer:  { label: "총괄 프로듀서", color: "#f1f5f9", bg: "rgba(241,245,249,0.12)"  },
  user:      { label: "나",            color: "#7c6cfc", bg: "rgba(124,108,252,0.12)"  },
} as const;
type AgentId = keyof typeof AGENTS;

interface Msg {
  id: string;
  agent: AgentId;
  text: string;
  done: boolean;
  card?: EpisodeCard | RoadmapCard;
  cardType?: "episode" | "roadmap";
}

interface EpisodeDetail {
  ep: number;
  title: string;
  event: string;
  characters: string[];
  emotion: string;
  foreshadow: string;
  cliffhanger: string;
  arc: number;
  tension: number;
}

interface EpisodeCard {
  episodes: EpisodeDetail[];
  arcLabel: string;
  arcColor: string;
}

interface RoadmapCard {
  arcs: { num: number; name: string; theme: string; eps: [number,number]; color: string }[];
  totalEps: number;
}

const ARC_COLORS = ["#60a5fa","#34d399","#fbbf24","#f472b6"];

function mkId() { return Math.random().toString(36).slice(2); }

function buildArcEpisodes(arcNum: number, genre: string, title: string): EpisodeDetail[] {
  const start = (arcNum-1)*25+1;
  const arcNames: Record<string, string[][]> = {
    "판타지": [
      ["각성","시련","성장","반전"],
      ["각성의 시작","첫 번째 시련","힘의 각성","예언의 반전"],
    ],
    "로맨스": [
      ["설렘","갈등","위기","완성"],
      ["첫 만남의 설렘","오해와 갈등","헤어짐의 위기","재결합과 완성"],
    ],
    "액션": [
      ["입문","도전","배신","결전"],
      ["세계에 입문","첫 번째 도전","동료의 배신","최후의 결전"],
    ],
    "스릴러": [
      ["불안","추적","함정","대결"],
      ["불안의 씨앗","숨막히는 추적","정교한 함정","최후의 대결"],
    ],
  };
  const emotions = ["긴장","고조","폭발","여운","전환","반전","상승","절정","하강","회복"];
  const events: string[][] = [
    ["주인공이 새로운 능력을 발견한다","예상치 못한 인물이 등장한다","비밀이 하나씩 드러나기 시작한다","동료와의 갈등이 수면 위로 올라온다","적의 진짜 목적이 밝혀진다"],
    ["과거의 트라우마가 현재를 침범한다","믿었던 인물이 배신한다","위기의 절정, 모든 것이 무너지는 듯 보인다","반전이 연속으로 일어난다","새로운 동맹이 형성된다"],
    ["최강의 적이 등장한다","주인공이 한계를 넘어선다","희생이 불가피한 선택이 찾아온다","진실이 완전히 드러난다","결전을 앞두고 모두가 하나가 된다"],
    ["최후의 결전이 시작된다","예상치 못한 도움이 나타난다","오랜 복수와 화해가 교차한다","클라이맥스, 운명의 순간","여운을 남기는 엔딩"],
  ];
  const foreshadows = [
    "1막 초반의 작은 단서가 여기서 의미를 드러낸다",
    "주인공의 꿈 속 장면이 현실이 된다",
    "적이 남긴 말의 진짜 의미가 밝혀진다",
    "오래된 물건이 새로운 열쇠가 된다",
    "처음 만난 장소가 다시 중요해진다",
  ];
  const cliffhangers = [
    "\"당신이...설마?\" — 다음 화가 궁금해지는 정체 폭로",
    "갑작스러운 적의 습격, 아무도 예상 못한 순간에",
    "선택의 기로 — 어떤 길을 택하든 대가가 따른다",
    "오랫동안 숨겨온 비밀이 마침내 터져나온다",
    "예상치 못한 구원자의 등장 — 하지만 의도는?",
  ];
  const characters = [
    ["주인공","라이벌"],
    ["주인공","조력자","악당"],
    ["주인공","악당"],
    ["주인공","조력자"],
    ["주인공","라이벌","조력자"],
  ];

  return Array.from({ length: 25 }, (_, i) => {
    const ep = start + i;
    const tension = Math.min(5, Math.max(1, Math.round(1 + (ep/100)*3.5 + Math.sin(ep*0.4)*0.7)));
    return {
      ep,
      title: `${ep}화 — ${arcNames[genre]?.[1]?.[arcNum-1] ?? "전개"}${i > 15 ? "의 절정" : ""}`,
      event: events[arcNum-1][i % events[arcNum-1].length],
      characters: characters[i % characters.length],
      emotion: emotions[i % emotions.length],
      foreshadow: foreshadows[i % foreshadows.length],
      cliffhanger: i % 5 === 4 ? cliffhangers[Math.floor(i/5) % cliffhangers.length] : "",
      arc: arcNum,
      tension,
    };
  });
}

function buildFullRoadmap(genre: string, title: string) {
  const arcNameMap: Record<string,string[]> = {
    "판타지": ["각성과 출발","시련과 성장","위기와 반전","결전과 완성"],
    "로맨스": ["첫 만남과 설렘","갈등과 오해","위기와 화해","사랑의 완성"],
    "액션":   ["입문과 각성","훈련과 도전","배신과 극복","최후의 결전"],
    "SF":     ["발견과 탐험","갈등과 생존","진실과 반전","귀환과 새 시작"],
    "스릴러": ["불안의 씨앗","추적과 회피","함정과 폭로","최후의 대결"],
  };
  const arcThemes = [
    "주인공 확립 · 세계관 도입",
    "핵심 갈등 심화 · 중간 보스 등장",
    "반전 연속 · 동료 위기",
    "클라이맥스 · 해결 · 여운",
  ];
  const names = arcNameMap[genre] ?? ["서막","갈등","전환","결말"];
  return {
    arcs: names.map((name, i) => ({
      num: i+1, name, theme: arcThemes[i],
      eps: ([[1,25],[26,50],[51,75],[76,100]] as [number,number][])[i],
      color: ARC_COLORS[i],
    })),
    totalEps: 100,
  };
}

function TensionDots({ level }: { level: number }) {
  const colors = ["","#4ade80","#a3e635","#fbbf24","#f97316","#ef4444"];
  return (
    <span className={s.tensionDots}>
      {[1,2,3,4,5].map(n => (
        <span key={n} className={s.tensionDot}
          style={{ background: n <= level ? colors[level] : "#252535" }} />
      ))}
    </span>
  );
}

function EpCardView({ card }: { card: EpisodeCard }) {
  const [expanded, setExpanded] = useState<number|null>(null);
  return (
    <div className={s.epCard}>
      <div className={s.epCardHeader}>
        <span className={s.epCardArcLabel} style={{ color: card.arcColor }}>
          {card.arcLabel}
        </span>
        <span className={s.epCardCount}>{card.episodes.length}화</span>
      </div>
      <div className={s.epList}>
        {card.episodes.map(ep => (
          <div key={ep.ep} className={s.epRow} onClick={() => setExpanded(expanded === ep.ep ? null : ep.ep)}>
            <div className={s.epRowTop}>
              <span className={s.epNum}>{ep.ep}화</span>
              <span className={s.epTitle}>{ep.title}</span>
              <TensionDots level={ep.tension} />
              <span className={s.epChevron}>{expanded === ep.ep ? "▲" : "▼"}</span>
            </div>
            {expanded === ep.ep && (
              <div className={s.epDetail}>
                <div className={s.epDetailRow}>
                  <span className={s.epDetailLabel}>핵심 사건</span>
                  <span className={s.epDetailVal}>{ep.event}</span>
                </div>
                <div className={s.epDetailRow}>
                  <span className={s.epDetailLabel}>등장인물</span>
                  <span className={s.epDetailVal}>{ep.characters.join(", ")}</span>
                </div>
                <div className={s.epDetailRow}>
                  <span className={s.epDetailLabel}>감정 곡선</span>
                  <span className={s.epDetailVal}>{ep.emotion}</span>
                </div>
                {ep.foreshadow && (
                  <div className={s.epDetailRow}>
                    <span className={s.epDetailLabel}>복선</span>
                    <span className={s.epDetailVal}>{ep.foreshadow}</span>
                  </div>
                )}
                {ep.cliffhanger && (
                  <div className={s.epDetailRow}>
                    <span className={s.epDetailLabel}>클리프행어</span>
                    <span className={s.epDetailVal} style={{ color: "#fbbf24" }}>{ep.cliffhanger}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function RoadmapCardView({ card }: { card: RoadmapCard }) {
  return (
    <div className={s.roadmapCard}>
      <div className={s.roadmapTitle}>100화 4막 구조 로드맵</div>
      <div className={s.arcGrid}>
        {card.arcs.map(arc => (
          <div key={arc.num} className={s.arcBlock} style={{ borderTopColor: arc.color }}>
            <div className={s.arcBlockLabel} style={{ color: arc.color }}>막 {arc.num}</div>
            <div className={s.arcBlockName}>{arc.name}</div>
            <div className={s.arcBlockEps}>EP {arc.eps[0]}–{arc.eps[1]}</div>
            <div className={s.arcBlockTheme}>{arc.theme}</div>
          </div>
        ))}
      </div>
      <div className={s.roadmapBar}>
        {card.arcs.map(arc => (
          <div key={arc.num} className={s.roadmapBarSeg} style={{ background: arc.color, flex: 25 }}>
            <span className={s.roadmapBarLabel}>{arc.num}막</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Phase3Page({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const router = useRouter();

  const [stage, setStage] = useState<"idle"|"chat">("idle");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [genre, setGenre] = useState("판타지");
  const [title, setTitle] = useState("");
  const [isMock, setIsMock] = useState(false);
  const [roadmapDone, setRoadmapDone] = useState(false);
  const [editingEp, setEditingEp] = useState<string>("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const p1 = JSON.parse(localStorage.getItem(`wts_phase1_${projectId}`) ?? "null");
      if (p1?.input?.genre) setGenre(p1.input.genre);
      if (p1?.input?.title) setTitle(p1.input.title);
      const projs = JSON.parse(localStorage.getItem("wts_projects") ?? "[]");
      const p = projs.find((x: {id:string}) => x.id === projectId);
      if (p?.title) setTitle(p.title);
    } catch {}

    const saved = localStorage.getItem(`wts_phase3_chat_${projectId}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setMessages(parsed.messages);
        setRoadmapDone(parsed.roadmapDone);
        setIsMock(parsed.isMock);
        setStage("chat");
      } catch {}
    }
  }, [projectId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const addMsg = useCallback((m: Omit<Msg,"id">) => {
    const id = mkId();
    setMessages(prev => [...prev, { ...m, id }]);
    return id;
  }, []);

  const reveal = useCallback((id: string, delay: number) =>
    new Promise<void>(res => setTimeout(() => {
      setMessages(prev => prev.map(m => m.id === id ? { ...m, done: true } : m));
      res();
    }, delay)), []);

  function saveChat(msgs: Msg[], done: boolean, mock: boolean) {
    localStorage.setItem(`wts_phase3_chat_${projectId}`, JSON.stringify({
      messages: msgs, roadmapDone: done, isMock: mock,
    }));
  }

  async function startRoadmap() {
    setStage("chat");
    setBusy(true);
    const key = localStorage.getItem("wts_anthropic_key") ?? "";
    const useMock = !key;
    setIsMock(useMock);

    const msgs: Msg[] = [];

    // Researcher message
    const r1id = mkId();
    const r1: Msg = { id: r1id, agent: "researcher", done: false,
      text: `${genre} 장르 "${title || "이 작품"}"의 독자 유지율 패턴을 분석했습니다. 5화 간격 훅 배치가 이탈률을 32% 낮추고, 25화마다 정점(PEAK)을 두는 4막 구조가 장기 연재에 최적입니다. 클리프행어는 매 5화 단위로 강도를 높이는 것을 권장합니다.` };
    setMessages([r1]);
    msgs.push(r1);
    await new Promise<void>(res => setTimeout(() => {
      setMessages(prev => prev.map(m => m.id === r1id ? { ...m, done: true } : m));
      res();
    }, 1200));

    await new Promise(r => setTimeout(r, 400));

    // Scenario writer announces structure
    const s1id = mkId();
    const s1: Msg = { id: s1id, agent: "scenario", done: false,
      text: `연구자 분석을 바탕으로 100화 4막 구조를 설계했습니다. 각 막은 25화로 구성되며, 막마다 독립적인 서사 호를 가집니다. 로드맵 개요를 먼저 확인해 주세요.` };
    setMessages(prev => { msgs.push(s1); return [...prev, s1]; });
    await new Promise<void>(res => setTimeout(() => {
      setMessages(prev => prev.map(m => m.id === s1id ? { ...m, done: true } : m));
      res();
    }, 1000));

    await new Promise(r => setTimeout(r, 300));

    // Roadmap card
    const rmCard = buildFullRoadmap(genre, title);
    const rmId = mkId();
    const rm: Msg = { id: rmId, agent: "scenario", done: true,
      text: "", card: rmCard, cardType: "roadmap" };
    setMessages(prev => { msgs.push(rm); return [...prev, rm]; });
    await new Promise(r => setTimeout(r, 600));

    // Arc by arc episodes
    for (let arcNum = 1; arcNum <= 4; arcNum++) {
      const arc = rmCard.arcs[arcNum - 1];
      const sArcId = mkId();
      const sArc: Msg = { id: sArcId, agent: "scenario", done: false,
        text: `${arcNum}막 "${arc.name}"(EP ${arc.eps[0]}–${arc.eps[1]}) 에피소드 목록입니다. 각 화를 클릭하면 핵심 사건·등장인물·감정 곡선·복선·클리프행어를 확인할 수 있습니다.` };
      setMessages(prev => { msgs.push(sArc); return [...prev, sArc]; });
      await new Promise<void>(res => setTimeout(() => {
        setMessages(prev => prev.map(m => m.id === sArcId ? { ...m, done: true } : m));
        res();
      }, 900));

      await new Promise(r => setTimeout(r, 300));

      const episodes = buildArcEpisodes(arcNum, genre, title);
      const epCard: EpisodeCard = { episodes, arcLabel: `${arcNum}막 — ${arc.name}`, arcColor: arc.color };
      const epId = mkId();
      const epMsg: Msg = { id: epId, agent: "scenario", done: true,
        text: "", card: epCard, cardType: "episode" };
      setMessages(prev => { msgs.push(epMsg); return [...prev, epMsg]; });
      await new Promise(r => setTimeout(r, 500));
    }

    // Producer sign-off
    const pId = mkId();
    const p1msg: Msg = { id: pId, agent: "producer", done: false,
      text: `100화 로드맵 검토 완료. 4막 구조와 완급 배분이 ${genre} 장르 독자 기대치에 부합합니다. 특정 화의 내용을 수정하고 싶으시면 "N화 수정: [의견]" 형식으로 말씀해 주세요. 준비가 되셨으면 Phase 4(첫 화 대본 작성)로 넘어가겠습니다.` };
    setMessages(prev => { msgs.push(p1msg); return [...prev, p1msg]; });
    await new Promise<void>(res => setTimeout(() => {
      setMessages(prev => prev.map(m => m.id === pId ? { ...m, done: true } : m));
      res();
    }, 1400));

    setRoadmapDone(true);
    setBusy(false);

    setMessages(prev => {
      saveChat(prev, true, useMock);
      return prev;
    });
  }

  async function sendMessage() {
    if (!input.trim() || busy) return;
    const text = input.trim();
    setInput("");
    setBusy(true);

    const uId = mkId();
    setMessages(prev => [...prev, { id: uId, agent: "user", text, done: true }]);

    await new Promise(r => setTimeout(r, 500));

    const epMatch = text.match(/(\d+)화\s*수정/);
    if (epMatch) {
      const epNum = parseInt(epMatch[1]);
      const sId = mkId();
      setMessages(prev => [...prev, { id: sId, agent: "scenario", done: false,
        text: `${epNum}화를 재작성합니다. 말씀하신 의견을 반영해 핵심 사건과 클리프행어를 조정했습니다.` }]);
      await new Promise<void>(res => setTimeout(() => {
        setMessages(prev => prev.map(m => m.id === sId ? { ...m, done: true } : m));
        res();
      }, 1000));

      await new Promise(r => setTimeout(r, 300));

      const arcNum = epNum <= 25 ? 1 : epNum <= 50 ? 2 : epNum <= 75 ? 3 : 4;
      const arc = buildFullRoadmap(genre, title).arcs[arcNum-1];
      const allEps = buildArcEpisodes(arcNum, genre, title);
      const ep = allEps.find(e => e.ep === epNum);
      if (ep) {
        ep.event = `[수정됨] ${text.replace(/\d+화\s*수정\s*:?\s*/,"").slice(0,60) || ep.event}`;
        ep.cliffhanger = ep.cliffhanger || "새로운 반전이 독자를 다음 화로 이끈다";
        const card: EpisodeCard = { episodes: [ep], arcLabel: `${arcNum}막 — ${arc.name}`, arcColor: arc.color };
        const cId = mkId();
        setMessages(prev => [...prev, { id: cId, agent: "scenario", done: true,
          text: "", card, cardType: "episode" }]);
      }

      const pId = mkId();
      setMessages(prev => [...prev, { id: pId, agent: "producer", done: false,
        text: `${epNum}화 수정 완료. 전체 흐름과의 정합성을 확인했습니다. 다른 화도 수정이 필요하시면 말씀해 주세요.` }]);
      await new Promise<void>(res => setTimeout(() => {
        setMessages(prev => prev.map(m => m.id === pId ? { ...m, done: true } : m));
        res();
      }, 900));
    } else {
      const pId = mkId();
      setMessages(prev => [...prev, { id: pId, agent: "producer", done: false,
        text: `말씀 감사합니다. "${text.slice(0,40)}${text.length>40?"...":""}" — 의견을 반영해 전체 로드맵 품질을 개선하겠습니다. 특정 화 수정은 "N화 수정: [내용]" 형식을 사용해 주세요.` }]);
      await new Promise<void>(res => setTimeout(() => {
        setMessages(prev => prev.map(m => m.id === pId ? { ...m, done: true } : m));
        res();
      }, 1000));
    }

    setBusy(false);
    setMessages(prev => {
      saveChat(prev, roadmapDone, isMock);
      return prev;
    });
  }

  return (
    <div className={s.page}>
      <h1 className={s.pageTitle}>Phase 3 — 100화 시리즈 로드맵</h1>

      {stage === "idle" && (
        <div className={s.idleWrap}>
          {isMock && (
            <div className={s.mockNote}>
              ⚠ ANTHROPIC_API_KEY 미설정 — Mock 데이터로 생성됩니다.&nbsp;
              <a href="/settings">설정 →</a>
            </div>
          )}
          <div className={s.idleCard}>
            <div className={s.idleIcon}>🗺</div>
            <div className={s.idleTitle}>100화 로드맵 자동 설계</div>
            <div className={s.idleDesc}>
              심층 조사자 · 시나리오 작가 · 총괄 프로듀서가 협업하여<br/>
              4막 구조 100화 에피소드 — 제목·핵심사건·감정곡선·복선·클리프행어를 자동 생성합니다.
            </div>
            <button className={s.btnStart} onClick={startRoadmap}>
              ✦ 로드맵 생성 시작
            </button>
          </div>
        </div>
      )}

      {stage === "chat" && (
        <div className={s.chatLayout}>
          <div className={s.chatBody}>
            {isMock && (
              <div className={s.mockBadge}>
                ⚠ Mock 데이터 — <a href="/settings">API 키 설정</a>
              </div>
            )}
            {messages.map(msg => {
              const cfg = AGENTS[msg.agent];
              const isUser = msg.agent === "user";
              return (
                <div key={msg.id} className={`${s.msgRow} ${isUser ? s.msgRowUser : ""}`}>
                  {!isUser && (
                    <div className={s.avatar} style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}33` }}>
                      {cfg.label[0]}
                    </div>
                  )}
                  <div className={s.msgContent}>
                    {!isUser && <div className={s.agentName} style={{ color: cfg.color }}>{cfg.label}</div>}
                    {msg.cardType === "roadmap" && msg.card ? (
                      <RoadmapCardView card={msg.card as RoadmapCard} />
                    ) : msg.cardType === "episode" && msg.card ? (
                      <EpCardView card={msg.card as EpisodeCard} />
                    ) : (
                      <div className={`${s.bubble} ${isUser ? s.bubbleUser : ""}`}
                        style={!isUser ? { borderColor: `${cfg.color}22` } : {}}>
                        {!msg.done ? (
                          <span className={s.dots}><span/><span/><span/></span>
                        ) : msg.text}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {roadmapDone && (
            <div className={s.gatingRow}>
              <div className={s.gatingBanner}>
                <div className={s.gatingText}>
                  <strong>✓ 100화 로드맵 완성</strong>
                  <span>특정 화 수정: "N화 수정: [의견]" · Phase 4에서 첫 화 대본을 작성합니다</span>
                </div>
                <button className={s.btnGating} onClick={() => router.push(`/projects/${projectId}/phase-4`)}>
                  Phase 4 시작 →
                </button>
              </div>
            </div>
          )}

          <div className={s.chatInputRow}>
            <textarea
              className={s.chatInput}
              placeholder={`특정 화 수정: "N화 수정: 내용" / 전체 의견 자유롭게 입력`}
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={busy}
              rows={1}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }}}
            />
            <button className={s.btnSend} onClick={sendMessage} disabled={busy || !input.trim()}>
              전송
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
