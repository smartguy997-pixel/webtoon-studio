"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import s from "./page.module.css";
import { streamClaude, getAnthropicKey } from "@/lib/claude-client";

// ─── Agent definitions ────────────────────────────────────────────────────────

const AGENTS = {
  script:    { label: "대본/연출 작가",  color: "#f87171", bg: "rgba(248,113,113,0.12)" },
  character: { label: "캐릭터 디자이너", color: "#fb923c", bg: "rgba(251,146,60,0.12)"  },
  producer:  { label: "총괄 프로듀서",   color: "#f1f5f9", bg: "rgba(241,245,249,0.12)" },
  user:      { label: "나",             color: "#7c6cfc", bg: "rgba(124,108,252,0.12)"  },
} as const;
type AgentId = keyof typeof AGENTS;

// ─── Types ────────────────────────────────────────────────────────────────────

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

interface CutScriptCard { ep: number; cuts: Cut[]; sccRate: number }

interface Msg {
  id: string;
  agent: AgentId;
  text: string;
  streaming: boolean;
  card?: CutScriptCard;
  cardType?: "cutScript";
}

function uid() { return Math.random().toString(36).slice(2, 10); }

// ─── System prompts ───────────────────────────────────────────────────────────

function buildScriptPrompt(ep: number, genre: string, context: string): string {
  return `당신은 AI Webtoon Studio 대본/연출 작가(agent_script)입니다. Phase 4 ${ep}화 30컷 대본을 작성합니다.

${context}

역할:
- ${ep}화의 서사 맥락에 맞는 30컷 분량의 콘티를 작성합니다
- 각 컷마다: 화면 구도(panel), 카메라 앵글, 캐릭터 배치, 표정, 대사, 효과음, 연출 의도, MST 태그를 정의합니다
- SCC(스타일 일관성 체크): 캐릭터 외형·화풍이 일관되면 "pass", 주의 필요하면 "warn", 불일치하면 "fail"
- 대화와 정적인 장면을 균형있게 배치하고, 30컷 안에 완결된 서사 단위를 만듭니다
- MST 태그는 화풍 키워드 2~3개를 배열로 작성합니다

말투: 전문적이고 간결. 자연스러운 한국어. 설명 50자 후 JSON.

⚠️ 응답 마지막에 반드시 아래 형식의 JSON 블록을 포함하세요 (30개의 컷):

[CUT_SCRIPT_${ep}]
{"ep":${ep},"cuts":[{"cut":1,"panel":"와이드","angle":"정면","placement":"중앙 단독","expression":"결의","dialogue":"\"시작할게.\"","sfx":"무음","direction":"카메라 서서히 줌인","mstTags":["세밀묘사","감정집중"],"scc":"pass"}],"sccRate":0.9}
[/CUT_SCRIPT_${ep}]

정확히 30개의 컷 객체를 생성하세요. sccRate는 pass 비율(0~1)입니다.`;
}

function buildCharacterCheckPrompt(ep: number, context: string, scriptSummary: string): string {
  return `당신은 AI Webtoon Studio 캐릭터 디자이너(agent_character)입니다. ${ep}화 SCC 검증 리포트를 작성합니다.

${context}
대본 요약: ${scriptSummary}

역할:
- 30컷 대본에서 캐릭터 외형 일관성 위반 가능성이 높은 컷을 지적합니다
- 특히 표정, 의상, 체형 묘사가 캐릭터 시트와 충돌하는 컷을 경고합니다
- 전체적인 MST 화풍 준수 여부를 평가합니다

말투: 분석적이고 구체적. 자연스러운 한국어. 분량: 100~150자.`;
}

function buildProducerScriptReviewPrompt(ep: number, sccPct: number, context: string): string {
  return `당신은 AI Webtoon Studio 총괄 프로듀서(agent_producer)입니다. ${ep}화 대본 검토를 마무리합니다.

${context}

SCC 통과율: ${sccPct}%

역할:
- SCC 통과율에 따라 적절한 피드백을 제공합니다
- 특히 인상적인 컷이나 개선이 필요한 부분을 언급합니다
- 다음 단계 안내를 합니다

말투: 권위 있고 명확. 자연스러운 한국어. 분량: 100~150자.`;
}

function buildProducerFollowupPrompt(ep: number, context: string): string {
  return `당신은 AI Webtoon Studio 총괄 프로듀서(agent_producer)입니다.

아래는 Phase 4 ${ep}화 대본 작성 내역입니다:
---
${context}
---

역할: 사용자의 컷 수정 요청이나 질문에 응답합니다.
특정 컷 수정 요청이 있다면 어떻게 수정할지 구체적으로 설명하세요.
말투: 친근하지만 전문적. 자연스러운 한국어. 분량: 100~150자.`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ThinkingDots() {
  return <span className={s.dots}><span /><span /><span /></span>;
}

function StreamCursor() {
  return (
    <span style={{
      display: "inline-block", width: 2, height: 13, background: "#7c6cfc",
      marginLeft: 2, verticalAlign: "middle", borderRadius: 1,
      animation: "blink 0.9s step-start infinite",
    }} />
  );
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
      <div className={s.cutVisual}>
        <div className={s.cutVisualInner}>
          <div className={s.cutVisualLabel}>{cut.panel}</div>
          <div className={s.cutVisualAngle}>{cut.angle}</div>
        </div>
      </div>
      <div className={s.mstTags}>
        {cut.mstTags.map(tag => <span key={tag} className={s.mstTag}># {tag}</span>)}
      </div>
      {expanded && (
        <div className={s.cutDetail}>
          <div className={s.cutDetailTabs}>
            <button className={`${s.cutDetailTab} ${!jsonView ? s.cutDetailTabActive : ""}`} onClick={() => setJsonView(false)}>읽기 뷰</button>
            <button className={`${s.cutDetailTab} ${jsonView ? s.cutDetailTabActive : ""}`} onClick={() => setJsonView(true)}>JSON</button>
          </div>
          {jsonView ? (
            <pre className={s.cutJson}>{JSON.stringify({ cut: cut.cut, panel: cut.panel, angle: cut.angle, placement: cut.placement, expression: cut.expression, dialogue: cut.dialogue, sfx: cut.sfx, direction: cut.direction, mstTags: cut.mstTags, scc_status: cut.scc }, null, 2)}</pre>
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
          <span className={s.sccStat}><span style={{ color: "#4ade80" }}>✅ {passCount}</span></span>
          <span className={s.sccStat}><span style={{ color: "#fbbf24" }}>⚠️ {warnCount}</span></span>
          <span className={s.sccStat}><span style={{ color: "#f87171" }}>❌ {failCount}</span></span>
          <div className={s.sccBar}><div className={s.sccBarFill} style={{ width: `${(passCount / 30) * 100}%` }} /></div>
          <span className={s.sccPct}>{Math.round((passCount / 30) * 100)}%</span>
        </div>
      </div>
      <div className={s.cutGrid}>
        {card.cuts.map(cut => <CutCard key={cut.cut} cut={cut} onEditRequest={onEditRequest} />)}
      </div>
    </div>
  );
}

function MsgBubble({ msg, onEditRequest }: { msg: Msg; onEditRequest: (cut: number) => void }) {
  const cfg = AGENTS[msg.agent];
  const isUser = msg.agent === "user";
  if (msg.cardType === "cutScript" && msg.card) {
    return <ScriptCardView card={msg.card} onEditRequest={onEditRequest} />;
  }
  return (
    <div className={`${s.msgRow} ${isUser ? s.msgRowUser : ""}`}>
      {!isUser && (
        <div className={s.avatar} style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}33` }}>
          {cfg.label[0]}
        </div>
      )}
      <div className={s.msgContent}>
        {!isUser && <div className={s.agentName} style={{ color: cfg.color }}>{cfg.label}</div>}
        <div className={`${s.bubble} ${isUser ? s.bubbleUser : ""}`}
          style={!isUser ? { borderColor: `${cfg.color}22` } : {}}>
          {msg.streaming && !msg.text ? (
            <ThinkingDots />
          ) : (
            <span style={{ whiteSpace: "pre-wrap" }}>
              {msg.text}
              {msg.streaming && <StreamCursor />}
            </span>
          )}
        </div>
      </div>
      {isUser && (
        <div className={s.avatar} style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}33` }}>나</div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Phase4Page({ params }: { params: { projectId: string } }) {
  const { projectId } = params;

  const [stage, setStage] = useState<"idle" | "chat">("idle");
  const [selectedEp, setSelectedEp] = useState(1);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [genre, setGenre] = useState("판타지");
  const [scriptDone, setScriptDone] = useState(false);
  const [doneEps, setDoneEps] = useState<Set<number>>(new Set());
  const [apiError, setApiError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<string>("");

  useEffect(() => {
    try {
      const p1 = JSON.parse(localStorage.getItem(`wts_phase1_${projectId}`) ?? "null");
      if (p1?.input?.genre) setGenre(p1.input.genre);
    } catch { /* ignore */ }
    const done = new Set<number>();
    for (let i = 1; i <= 10; i++) {
      if (localStorage.getItem(`wts_phase4_ep_${projectId}_${i}`)) done.add(i);
    }
    setDoneEps(done);
  }, [projectId]);

  useEffect(() => {
    setMessages([]);
    setScriptDone(false);
    setStage("idle");
    setApiError(null);
  }, [selectedEp]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const id = "wts-blink-style";
    if (!document.getElementById(id)) {
      const el = document.createElement("style");
      el.id = id;
      el.textContent = "@keyframes blink { 0%,49%{opacity:1} 50%,100%{opacity:0} }";
      document.head.appendChild(el);
    }
  }, []);

  const streamText = useCallback(async (
    agent: AgentId,
    systemPrompt: string,
    msgs: Array<{ role: "user" | "assistant"; content: string }>,
    apiKey: string,
  ): Promise<string> => {
    const id = uid();
    setMessages(prev => [...prev, { id, agent, text: "", streaming: true }]);
    let fullText = "";
    const gen = streamClaude({ apiKey, systemPrompt, messages: msgs, maxTokens: 1500, tools: [] });
    for await (const chunk of gen) {
      fullText += chunk;
      setMessages(prev => prev.map(m => m.id === id ? { ...m, text: fullText } : m));
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    setMessages(prev => prev.map(m => m.id === id ? { ...m, streaming: false } : m));
    return fullText;
  }, []);

  const streamScript = useCallback(async (
    ep: number,
    systemPrompt: string,
    msgs: Array<{ role: "user" | "assistant"; content: string }>,
    apiKey: string,
  ): Promise<{ fullText: string; card: CutScriptCard | null }> => {
    const id = uid();
    setMessages(prev => [...prev, { id, agent: "script", text: "30컷 대본 작성 중...", streaming: true }]);

    let fullText = "";
    const gen = streamClaude({ apiKey, systemPrompt, messages: msgs, maxTokens: 8000, tools: [] });
    for await (const chunk of gen) {
      fullText += chunk;
      const cutCount = (fullText.match(/"cut":/g) || []).length;
      if (cutCount > 0) {
        setMessages(prev => prev.map(m => m.id === id ? { ...m, text: `30컷 대본 작성 중... (${cutCount}/30컷)` } : m));
      }
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }

    // Parse card
    const tag = `CUT_SCRIPT_${ep}`;
    const re = new RegExp(`\\[${tag}\\]\\s*([\\s\\S]*?)\\s*\\[\\/${tag}\\]`);
    const match = fullText.match(re);
    let card: CutScriptCard | null = null;
    try { if (match) card = JSON.parse(match[1]) as CutScriptCard; } catch { /* ignore */ }

    if (card && card.cuts.length > 0) {
      const passCount = card.cuts.filter(c => c.scc === "pass").length;
      card.sccRate = passCount / card.cuts.length;
      setMessages(prev => prev.map(m => m.id === id
        ? { ...m, text: "", streaming: false, cardType: "cutScript", card }
        : m));
    } else {
      setMessages(prev => prev.map(m => m.id === id ? { ...m, text: "대본 생성 완료 (파싱 오류)", streaming: false } : m));
    }
    return { fullText, card };
  }, []);

  const startScript = useCallback(async () => {
    const apiKey = getAnthropicKey();
    if (!apiKey) {
      setApiError("ANTHROPIC_API_KEY가 설정되지 않았습니다. 설정 페이지에서 API 키를 입력해주세요.");
      return;
    }
    setApiError(null);
    setStage("chat");
    setBusy(true);
    setMessages([]);
    setScriptDone(false);

    let context = `장르: ${genre}\n화: ${selectedEp}화`;
    try {
      const p1 = JSON.parse(localStorage.getItem(`wts_phase1_${projectId}`) ?? "null");
      if (p1?.input?.concept) context += `\n기획: ${p1.input.concept.slice(0, 150)}`;
      if (p1?.data?.summary) context += `\nPhase 1: ${p1.data.summary}`;
      const p2 = JSON.parse(localStorage.getItem(`wts_phase2_${projectId}`) ?? "null");
      if (p2?.data?.world) context += `\n세계관: ${p2.data.world.era}`;
      if (p2?.data?.characters?.[0]) context += `\n주인공: ${p2.data.characters[0].name}`;
    } catch { /* ignore */ }

    try {
      // ── 1. Script writer intro ──
      await streamText(
        "script",
        `당신은 AI Webtoon Studio 대본/연출 작가입니다. ${selectedEp}화 대본 작성을 시작합니다. 간략히 이번 화의 핵심 서사 방향을 20~30자로 안내하세요.`,
        [{ role: "user", content: `${selectedEp}화 대본을 시작합니다.\n${context}` }],
        apiKey,
      );

      // ── 2. Character designer SCC intro ──
      await streamText(
        "character",
        `당신은 AI Webtoon Studio 캐릭터 디자이너입니다. ${selectedEp}화 대본 작성에 앞서 SCC 검증을 동시 진행함을 알립니다. 10~20자로 간략히 안내하세요.`,
        [{ role: "user", content: context }],
        apiKey,
      );

      // ── 3. Generate 30-cut script ──
      const { card } = await streamScript(
        selectedEp,
        buildScriptPrompt(selectedEp, genre, context),
        [{ role: "user", content: `${selectedEp}화 30컷 대본을 작성해주세요.\n${context}` }],
        apiKey,
      );

      const sccPct = card ? Math.round(card.sccRate * 100) : 90;
      const scriptSummary = card
        ? `${card.cuts.length}컷 생성, SCC ${sccPct}%, pass:${card.cuts.filter(c => c.scc === "pass").length}`
        : "30컷 생성 완료";

      // ── 4. Character SCC report ──
      await streamText(
        "character",
        buildCharacterCheckPrompt(selectedEp, context, scriptSummary),
        [{ role: "user", content: "SCC 검증 결과를 보고해주세요." }],
        apiKey,
      );

      // ── 5. Producer review ──
      contextRef.current = `${context}\n${scriptSummary}`;
      await streamText(
        "producer",
        buildProducerScriptReviewPrompt(selectedEp, sccPct, contextRef.current),
        [{ role: "user", content: "대본 검토 결과를 알려주세요." }],
        apiKey,
      );

      setScriptDone(true);
      setDoneEps(prev => new Set([...prev, selectedEp]));
      if (card) {
        localStorage.setItem(`wts_phase4_ep_${projectId}_${selectedEp}`, JSON.stringify({ sccRate: card.sccRate, savedAt: new Date().toISOString() }));
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const msg = raw.includes("401") || raw.includes("authentication")
        ? "API 키가 유효하지 않습니다. 설정 페이지에서 키를 다시 확인해주세요."
        : `API 오류: ${raw}`;
      setApiError(msg);
    } finally {
      setBusy(false);
    }
  }, [genre, selectedEp, projectId, streamText, streamScript]);

  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || busy) return;
    const apiKey = getAnthropicKey();
    if (!apiKey) { setApiError("ANTHROPIC_API_KEY가 설정되지 않았습니다."); return; }

    setApiError(null);
    if (!overrideText) setInput("");
    setMessages(prev => [...prev, { id: uid(), agent: "user", text, streaming: false }]);
    setBusy(true);

    try {
      await streamText(
        "producer",
        buildProducerFollowupPrompt(selectedEp, contextRef.current),
        [{ role: "user", content: text }],
        apiKey,
      );
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      setApiError(raw.includes("401") ? "API 키가 유효하지 않습니다." : `API 오류: ${raw}`);
    } finally {
      setBusy(false);
    }
  }, [input, busy, selectedEp, streamText]);

  return (
    <div className={s.page}>
      <h1 className={s.pageTitle}>Phase 4 — 30컷 제작 대본</h1>

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
          {apiError && (
            <div style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 10, padding: "10px 16px", marginBottom: 16, fontSize: 13, color: "#f87171" }}>
              ⚠ {apiError}
            </div>
          )}
          <div className={s.idleCard}>
            <div className={s.idleIcon}>✏️</div>
            <div className={s.idleTitle}>{selectedEp}화 대본 생성</div>
            <div className={s.idleDesc}>
              대본/연출 작가 · 캐릭터 디자이너 · 총괄 프로듀서가 협업하여<br />
              {selectedEp}화 30컷 — 카메라 앵글·배치·표정·대사·효과음·연출 의도를 생성하고<br />
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
          {apiError && (
            <div style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)", margin: "12px 20px 0", borderRadius: 10, padding: "10px 16px", fontSize: 13, color: "#f87171", display: "flex", alignItems: "center", gap: 8 }}>
              <span>⚠</span><span>{apiError}</span>
              <a href="/settings" style={{ marginLeft: "auto", color: "#f87171", textDecoration: "underline", whiteSpace: "nowrap" }}>설정으로 이동</a>
            </div>
          )}

          <div className={s.chatBody}>
            {messages.map(msg => <MsgBubble key={msg.id} msg={msg} onEditRequest={cut => sendMessage(`컷 ${cut} 수정: 개선 요청`)} />)}
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
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
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
