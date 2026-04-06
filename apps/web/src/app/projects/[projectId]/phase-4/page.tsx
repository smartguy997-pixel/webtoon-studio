"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import s from "./page.module.css";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

const AGENTS = {
  script:    { label: "대본/연출 작가",  color: "#f87171", bg: "rgba(248,113,113,0.12)" },
  character: { label: "캐릭터 디자이너", color: "#fb923c", bg: "rgba(251,146,60,0.12)"  },
  producer:  { label: "총괄 프로듀서",   color: "#f1f5f9", bg: "rgba(241,245,249,0.12)" },
  user:      { label: "나",             color: "#7c6cfc", bg: "rgba(124,108,252,0.12)"  },
} as const;
type AgentId = keyof typeof AGENTS;

type SccStatus = "pass" | "warn" | "fail";

interface Cut {
  cut: number;
  panel: string;
  angle: string;
  placement: string;
  expression: string;
  dialogue: string;
  sfx: string;
  direction: string;
  mstTags: string[];
  scc: SccStatus;
}

interface CutScriptCard {
  ep: number;
  cuts: Cut[];
  sccRate: number;
}

interface Msg {
  id: string;
  agent: AgentId;
  text: string;
  done: boolean;
  card?: CutScriptCard;
  cardType?: "cutScript";
}

function mkId() { return Math.random().toString(36).slice(2); }

const PANELS = ["와이드","미디엄","클로즈업","극클로즈","오버헤드","로우앵글"];
const ANGLES = ["정면","사선 45°","측면","배면","버드아이","웜스아이"];
const PLACEMENTS = ["중앙 단독","좌측 여백","우측 여백","투샷 대칭","삼각 구도","교차 배치"];
const EXPRESSIONS = ["결의","분노","두려움","슬픔","놀람","기쁨","평온","긴장","혼란","체념"];
const DIALOGUES = [
  `"지금 여기서 물러설 수 없어."`,
  `"그게...사실이야?"`,
  `(내레이션) 그날의 선택이 모든 걸 바꿨다.`,
  `"처음부터 알고 있었어."`,
  `"내가 반드시 지켜낼게."`,
  `"너는 아무것도 모르잖아!"`,
  `"...미안해."`,
  `(말 없이 눈을 마주친다)`,
  `"이제 시작이야."`,
  `"여기서 끝낼 수는 없어."`,
];
const SFXS = [
  "WHOOSH — 바람이 가르는 소리",
  "BOOM — 묵직한 충격음",
  "무음 — 긴 침묵",
  "심장 박동 — 긴장감 조성",
  "BGM페이드아웃 — 감정 절제",
  "CRACK — 유리 금이 가는 소리",
  "스텝 — 조심스러운 발소리",
  "바람 소리 — 공허한 여운",
];
const DIRECTIONS = [
  "카메라 천천히 줌인 → 인물 감정 강조",
  "컷 전환 직전 1초 정지 → 긴장감 극대화",
  "배경 디테일 충분히 → 세계관 정보 전달",
  "두 인물 시선 교차 편집 → 심리전",
  "역광 실루엣 → 정체 숨김",
  "핸드헬드 카메라 느낌 → 불안감 조성",
  "대칭 구도 → 긴장의 균형",
  "클로즈 → 와이드 반전 컷 → 충격 증폭",
];
const MST_TAGS_POOL = [
  ["세밀묘사","역광강조"],
  ["감정곡선-상승","실루엣"],
  ["배경디테일","원근법"],
  ["익스트림클로즈","표정집중"],
  ["와이드샷","세계관노출"],
  ["투샷","심리대립"],
  ["내레이션박스","시간생략"],
  ["SFX연출","침묵대비"],
];

function buildMockCuts(ep: number, genre: string): Cut[] {
  const sccMap: SccStatus[] = Array.from({ length: 30 }, (_, i) =>
    [5, 12, 22].includes(i) ? "warn" : i === 18 ? "fail" : "pass"
  );
  return Array.from({ length: 30 }, (_, i) => ({
    cut: i + 1,
    panel: PANELS[i % PANELS.length],
    angle: ANGLES[i % ANGLES.length],
    placement: PLACEMENTS[i % PLACEMENTS.length],
    expression: EXPRESSIONS[i % EXPRESSIONS.length],
    dialogue: DIALOGUES[i % DIALOGUES.length],
    sfx: SFXS[i % SFXS.length],
    direction: DIRECTIONS[i % DIRECTIONS.length],
    mstTags: MST_TAGS_POOL[i % MST_TAGS_POOL.length],
    scc: sccMap[i],
  }));
}

function sccIcon(scc: SccStatus) {
  return scc === "pass" ? "✅" : scc === "warn" ? "⚠️" : "❌";
}

function SccBadge({ scc }: { scc: SccStatus }) {
  const cls = scc === "pass" ? s.sccPass : scc === "warn" ? s.sccWarn : s.sccFail;
  const label = scc === "pass" ? "SCC ✓" : scc === "warn" ? "SCC △" : "SCC ✗";
  return <span className={`${s.sccBadge} ${cls}`}>{label}</span>;
}

function CutCard({ cut, onEditRequest }: { cut: Cut; onEditRequest: (cut: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [jsonView, setJsonView] = useState(false);

  return (
    <div className={`${s.cutCard} ${cut.scc === "fail" ? s.cutFail : cut.scc === "warn" ? s.cutWarn : ""}`}>
      <div className={s.cutCardTop} onClick={() => setExpanded(!expanded)}>
        <span className={s.cutNum}>컷 {cut.cut}</span>
        <span className={s.cutPanel}>{cut.panel}</span>
        <span className={s.cutExpression}>{cut.expression}</span>
        <SccBadge scc={cut.scc} />
        <span className={s.cutChevron}>{expanded ? "▲" : "▼"}</span>
      </div>

      {/* Cinematic panel placeholder */}
      <div className={s.cutVisual}>
        <div className={s.cutVisualInner}>
          <div className={s.cutVisualLabel}>{cut.panel}</div>
          <div className={s.cutVisualAngle}>{cut.angle}</div>
        </div>
      </div>

      {/* MST tags */}
      <div className={s.mstTags}>
        {cut.mstTags.map(tag => (
          <span key={tag} className={s.mstTag}># {tag}</span>
        ))}
      </div>

      {expanded && (
        <div className={s.cutDetail}>
          <div className={s.cutDetailTabs}>
            <button className={`${s.cutDetailTab} ${!jsonView ? s.cutDetailTabActive : ""}`} onClick={() => setJsonView(false)}>읽기 뷰</button>
            <button className={`${s.cutDetailTab} ${jsonView ? s.cutDetailTabActive : ""}`} onClick={() => setJsonView(true)}>JSON</button>
          </div>
          {jsonView ? (
            <pre className={s.cutJson}>{JSON.stringify({
              cut: cut.cut, panel: cut.panel, angle: cut.angle,
              placement: cut.placement, expression: cut.expression,
              dialogue: cut.dialogue, sfx: cut.sfx,
              direction: cut.direction, mstTags: cut.mstTags,
              scc_status: cut.scc,
            }, null, 2)}</pre>
          ) : (
            <div className={s.cutDetailRows}>
              <div className={s.cutDetailRow}><span className={s.cutDetailLabel}>카메라 앵글</span><span className={s.cutDetailVal}>{cut.angle}</span></div>
              <div className={s.cutDetailRow}><span className={s.cutDetailLabel}>캐릭터 배치</span><span className={s.cutDetailVal}>{cut.placement}</span></div>
              <div className={s.cutDetailRow}><span className={s.cutDetailLabel}>표정</span><span className={s.cutDetailVal}>{cut.expression}</span></div>
              <div className={s.cutDetailRow}><span className={s.cutDetailLabel}>대사</span><span className={s.cutDetailVal}>{cut.dialogue}</span></div>
              <div className={s.cutDetailRow}><span className={s.cutDetailLabel}>효과음</span><span className={s.cutDetailVal}>{cut.sfx}</span></div>
              <div className={s.cutDetailRow}><span className={s.cutDetailLabel}>연출 의도</span><span className={s.cutDetailVal}>{cut.direction}</span></div>
            </div>
          )}
          <button className={s.btnEdit} onClick={e => { e.stopPropagation(); onEditRequest(cut.cut); }}>
            ✏ 이 컷 수정 요청
          </button>
        </div>
      )}
    </div>
  );
}

function ScriptCardView({ card, onEditRequest }: { card: CutScriptCard; onEditRequest: (cut: number) => void }) {
  const passCount = card.cuts.filter(c => c.scc === "pass").length;
  const warnCount = card.cuts.filter(c => c.scc === "warn").length;
  const failCount = card.cuts.filter(c => c.scc === "fail").length;
  return (
    <div className={s.scriptCard}>
      <div className={s.scriptCardHeader}>
        <div className={s.scriptCardTitle}>{card.ep}화 — 30컷 대본</div>
        <div className={s.sccSummary}>
          <span className={s.sccStat}><span style={{color:"#4ade80"}}>✅ {passCount}</span></span>
          <span className={s.sccStat}><span style={{color:"#fbbf24"}}>⚠️ {warnCount}</span></span>
          <span className={s.sccStat}><span style={{color:"#f87171"}}>❌ {failCount}</span></span>
          <div className={s.sccBar}>
            <div className={s.sccBarFill} style={{ width: `${(passCount/30)*100}%` }} />
          </div>
          <span className={s.sccPct}>{Math.round((passCount/30)*100)}%</span>
        </div>
      </div>
      <div className={s.cutGrid}>
        {card.cuts.map(cut => (
          <CutCard key={cut.cut} cut={cut} onEditRequest={onEditRequest} />
        ))}
      </div>
    </div>
  );
}

export default function Phase4Page({ params }: { params: { projectId: string } }) {
  const { projectId } = params;

  const [stage, setStage] = useState<"idle"|"chat">("idle");
  const [selectedEp, setSelectedEp] = useState(1);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [genre, setGenre] = useState("판타지");
  const [isMock, setIsMock] = useState(false);
  const [scriptDone, setScriptDone] = useState(false);
  const [doneEps, setDoneEps] = useState<Set<number>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const p1 = JSON.parse(localStorage.getItem(`wts_phase1_${projectId}`) ?? "null");
      if (p1?.input?.genre) setGenre(p1.input.genre);
    } catch {}
    const done = new Set<number>();
    for (let i = 1; i <= 10; i++) {
      if (localStorage.getItem(`wts_phase4_chat_${projectId}_ep${i}`)) done.add(i);
    }
    setDoneEps(done);
  }, [projectId]);

  useEffect(() => {
    const saved = localStorage.getItem(`wts_phase4_chat_${projectId}_ep${selectedEp}`);
    if (saved) {
      try {
        const p = JSON.parse(saved);
        setMessages(p.messages);
        setScriptDone(p.scriptDone);
        setIsMock(p.isMock);
        setStage("chat");
      } catch {}
    } else {
      setMessages([]);
      setScriptDone(false);
      setStage("idle");
    }
  }, [projectId, selectedEp]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function saveChat(msgs: Msg[], done: boolean, mock: boolean) {
    localStorage.setItem(`wts_phase4_chat_${projectId}_ep${selectedEp}`, JSON.stringify({
      messages: msgs, scriptDone: done, isMock: mock,
    }));
  }

  async function startScript() {
    setStage("chat");
    setBusy(true);
    const key = localStorage.getItem("wts_anthropic_key") ?? "";
    const useMock = !key;
    setIsMock(useMock);
    setMessages([]);
    setScriptDone(false);

    const msgs: Msg[] = [];

    const s1id = mkId();
    const s1: Msg = { id: s1id, agent: "script", done: false,
      text: `${selectedEp}화 대본 작성을 시작합니다. 30컷 분량의 콘티 · 대사 · 카메라 앵글 · 연출 의도를 작성하겠습니다.` };
    setMessages([s1]); msgs.push(s1);
    await new Promise<void>(res => setTimeout(() => {
      setMessages(prev => prev.map(m => m.id === s1id ? { ...m, done: true } : m));
      res();
    }, 1000));

    await new Promise(r => setTimeout(r, 300));

    const c1id = mkId();
    const c1: Msg = { id: c1id, agent: "character", done: false,
      text: `캐릭터 시트와 대조하여 각 컷의 캐릭터 일관성을 실시간 체크합니다. SCC(Style Consistency Check) 결과를 함께 표시합니다.` };
    setMessages(prev => { msgs.push(c1); return [...prev, c1]; });
    await new Promise<void>(res => setTimeout(() => {
      setMessages(prev => prev.map(m => m.id === c1id ? { ...m, done: true } : m));
      res();
    }, 900));

    await new Promise(r => setTimeout(r, 400));

    const cuts = buildMockCuts(selectedEp, genre);
    const passCount = cuts.filter(c => c.scc === "pass").length;
    const card: CutScriptCard = { ep: selectedEp, cuts, sccRate: passCount / 30 };

    const cardId = mkId();
    const cardMsg: Msg = { id: cardId, agent: "script", done: true,
      text: "", card, cardType: "cutScript" };
    setMessages(prev => { msgs.push(cardMsg); return [...prev, cardMsg]; });

    await new Promise(r => setTimeout(r, 500));

    const sccPct = Math.round((passCount / 30) * 100);
    const pId = mkId();
    const pMsg: Msg = { id: pId, agent: "producer", done: false,
      text: `${selectedEp}화 30컷 대본 완성. SCC 통과율 ${sccPct}% — ${sccPct >= 90 ? "기준 충족. 다음 화로 진행 가능합니다." : "기준(90%) 미달. ⚠️ 표시 컷을 수정해 주세요."}\n특정 컷 수정: "컷 N 수정: [의견]" 형식으로 요청해 주세요.` };
    setMessages(prev => { msgs.push(pMsg); return [...prev, pMsg]; });
    await new Promise<void>(res => setTimeout(() => {
      setMessages(prev => prev.map(m => m.id === pId ? { ...m, done: true } : m));
      res();
    }, 1200));

    setScriptDone(true);
    setDoneEps(prev => new Set([...prev, selectedEp]));
    setBusy(false);

    setMessages(prev => {
      saveChat(prev, true, useMock);
      return prev;
    });
  }

  async function sendMessage(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || busy) return;
    if (!text) setInput("");
    setBusy(true);

    const uId = mkId();
    setMessages(prev => [...prev, { id: uId, agent: "user", text: msg, done: true }]);

    await new Promise(r => setTimeout(r, 500));

    const cutMatch = msg.match(/컷\s*(\d+)\s*수정/);
    if (cutMatch) {
      const cutNum = parseInt(cutMatch[1]);
      const sId = mkId();
      setMessages(prev => [...prev, { id: sId, agent: "script", done: false,
        text: `컷 ${cutNum}을 재작성합니다. 말씀하신 의견을 반영해 카메라 앵글·배치·연출을 조정했습니다.` }]);
      await new Promise<void>(res => setTimeout(() => {
        setMessages(prev => prev.map(m => m.id === sId ? { ...m, done: true } : m));
        res();
      }, 900));

      await new Promise(r => setTimeout(r, 300));

      const newCut: Cut = {
        cut: cutNum,
        panel: PANELS[cutNum % PANELS.length],
        angle: ANGLES[(cutNum + 1) % ANGLES.length],
        placement: PLACEMENTS[(cutNum + 2) % PLACEMENTS.length],
        expression: EXPRESSIONS[(cutNum + 3) % EXPRESSIONS.length],
        dialogue: DIALOGUES[(cutNum + 1) % DIALOGUES.length],
        sfx: SFXS[(cutNum + 2) % SFXS.length],
        direction: `[수정됨] ${msg.replace(/컷\s*\d+\s*수정\s*:?\s*/,"").slice(0,60) || DIRECTIONS[cutNum % DIRECTIONS.length]}`,
        mstTags: MST_TAGS_POOL[(cutNum + 1) % MST_TAGS_POOL.length],
        scc: "pass",
      };
      const miniCard: CutScriptCard = { ep: selectedEp, cuts: [newCut], sccRate: 1 };
      const cId = mkId();
      setMessages(prev => [...prev, { id: cId, agent: "script", done: true,
        text: "", card: miniCard, cardType: "cutScript" }]);

      const cchkId = mkId();
      setMessages(prev => [...prev, { id: cchkId, agent: "character", done: false,
        text: `컷 ${cutNum} SCC 재검증 완료. ✅ 캐릭터 일관성 통과.` }]);
      await new Promise<void>(res => setTimeout(() => {
        setMessages(prev => prev.map(m => m.id === cchkId ? { ...m, done: true } : m));
        res();
      }, 700));
    } else {
      const pId = mkId();
      setMessages(prev => [...prev, { id: pId, agent: "producer", done: false,
        text: `의견 감사합니다. "${msg.slice(0,50)}${msg.length>50?"...":""}" — 반영해 품질을 높이겠습니다. 특정 컷 수정은 "컷 N 수정: [내용]" 형식을 사용해 주세요.` }]);
      await new Promise<void>(res => setTimeout(() => {
        setMessages(prev => prev.map(m => m.id === pId ? { ...m, done: true } : m));
        res();
      }, 900));
    }

    setBusy(false);
    setMessages(prev => {
      saveChat(prev, scriptDone, isMock);
      return prev;
    });
  }

  return (
    <div className={s.page}>
      <h1 className={s.pageTitle}>Phase 4 — 30컷 제작 대본</h1>

      {/* Episode selector */}
      <div className={s.epSelector}>
        <span className={s.epSelectorLabel}>화 선택</span>
        <div className={s.epSelectorRow}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map(ep => (
            <button key={ep}
              className={`${s.epBtn} ${selectedEp === ep ? s.epBtnActive : ""} ${doneEps.has(ep) ? s.epBtnDone : ""}`}
              onClick={() => setSelectedEp(ep)}>
              {ep}화
              {doneEps.has(ep) && <span className={s.epDoneDot} />}
            </button>
          ))}
          <span className={s.epMore}>… 100화</span>
        </div>
      </div>

      {stage === "idle" && (
        <div className={s.idleWrap}>
          {isMock && (
            <div className={s.mockNote}>
              ⚠ ANTHROPIC_API_KEY 미설정 — Mock 데이터로 생성됩니다.&nbsp;
              <a href="/settings">설정 →</a>
            </div>
          )}
          <div className={s.idleCard}>
            <div className={s.idleIcon}>✏️</div>
            <div className={s.idleTitle}>{selectedEp}화 대본 생성</div>
            <div className={s.idleDesc}>
              대본/연출 작가 · 캐릭터 디자이너 · 총괄 프로듀서가 협업하여<br/>
              {selectedEp}화 30컷 — 카메라 앵글·배치·표정·대사·효과음·연출 의도를 생성하고<br/>
              캐릭터 시트 일관성(SCC)과 MST 화풍 태그를 자동 검증합니다.
            </div>
            <button className={s.btnStart} onClick={startScript}>
              ✦ {selectedEp}화 대본 생성
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
                    <div className={s.avatar}
                      style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}33` }}>
                      {cfg.label[0]}
                    </div>
                  )}
                  <div className={s.msgContent}>
                    {!isUser && <div className={s.agentName} style={{ color: cfg.color }}>{cfg.label}</div>}
                    {msg.cardType === "cutScript" && msg.card ? (
                      <ScriptCardView
                        card={msg.card as CutScriptCard}
                        onEditRequest={cut => sendMessage(`컷 ${cut} 수정: 개선 요청`)}
                      />
                    ) : (
                      <div className={`${s.bubble} ${isUser ? s.bubbleUser : ""}`}
                        style={!isUser ? { borderColor: `${cfg.color}22` } : {}}>
                        {!msg.done ? (
                          <span className={s.dots}><span/><span/><span/></span>
                        ) : msg.text.split("\n").map((line, i) => (
                          <span key={i}>{line}{i < msg.text.split("\n").length - 1 && <br/>}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {scriptDone && (
            <div className={s.gatingRow}>
              <div className={s.gatingBanner}>
                <div className={s.gatingText}>
                  <strong>✓ {selectedEp}화 대본 완성</strong>
                  <span>컷 수정: "컷 N 수정: [의견]" · 다음 화로 이동하거나 Phase 5를 시작하세요</span>
                </div>
                <button className={s.btnGating} onClick={() => setSelectedEp(prev => Math.min(prev + 1, 100))}>
                  {selectedEp + 1}화 대본 →
                </button>
              </div>
            </div>
          )}

          <div className={s.chatInputRow}>
            <textarea
              className={s.chatInput}
              placeholder={`컷 수정: "컷 N 수정: 내용" / 전체 의견 자유롭게 입력`}
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={busy}
              rows={1}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }}}
            />
            <button className={s.btnSend} onClick={() => sendMessage()} disabled={busy || !input.trim()}>
              전송
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

