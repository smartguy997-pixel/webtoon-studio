import { Router, type Request, type Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { authMiddleware } from "../middleware/auth.js";
import { SlidingWindow, saveSlidingWindowSummary } from "../utils/sliding-window.js";

export const phasesRouter = Router();

const MODEL = "claude-sonnet-4-6";
const WEB_SEARCH_TOOL: Anthropic.Messages.WebSearchTool20260209 = { type: "web_search_20260209", name: "web_search" };

// ─── Sliding-window registry (per project, in-process) ───────────────────────
// Resets on server restart; Firestore holds the durable summary.

const windows = new Map<string, SlidingWindow>();

function getWindow(projectId: string): SlidingWindow {
  if (!windows.has(projectId)) windows.set(projectId, new SlidingWindow());
  return windows.get(projectId)!;
}

async function tickWindow(
  res: Response,
  client: Anthropic,
  projectId: string,
  phase: number,
  context: string,
): Promise<void> {
  const win = getWindow(projectId);
  const shouldCompress = win.increment();
  if (!shouldCompress) return;

  // Producer generates the sliding-window summary
  const summaryText = await streamAgent(res, client, "producer",
    `당신은 총괄 프로듀서입니다. 지금까지의 논의를 300자 이내 [프로젝트 요약]으로 압축하세요.
형식: [프로젝트 요약 vN]\n- phase: ${phase}\n- 주요 결정:\n- 승인 에셋:\n- 다음 단계:`,
    [{ role: "user", content: `컨텍스트:\n${context.slice(0, 800)}` }],
    600, false,
  );

  // Persist to Firestore (fire-and-forget)
  saveSlidingWindowSummary(projectId, phase, { key_decisions: [summaryText.slice(0, 300)] })
    .catch(err => console.error("sliding-window save error:", err));

  sendEvent(res, "window_summary", { phase, summary: summaryText });
}

// ─── SSE helpers ──────────────────────────────────────────────────────────────

function sseHeaders(res: Response) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();
}

function sendEvent(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Stream a single agent turn via SSE.
 * Emits: agent_start, token, agent_done, search_query
 */
async function streamAgent(
  res: Response,
  client: Anthropic,
  agent: string,
  systemPrompt: string,
  messages: Anthropic.MessageParam[],
  maxTokens = 3000,
  useWebSearch = true,
): Promise<string> {
  sendEvent(res, "agent_start", { agent });

  const tools = useWebSearch ? [WEB_SEARCH_TOOL] : [];
  const stream = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
    tools: tools as Anthropic.Messages.ToolUnion[],
    stream: true,
  });

  let fullText = "";
  let currentBlockType: string | null = null;
  let toolInputBuf = "";
  let toolName: string | null = null;

  for await (const event of stream) {
    if (event.type === "content_block_start") {
      currentBlockType = event.content_block.type;
      toolName = currentBlockType === "tool_use" ? (event.content_block as { name?: string }).name ?? null : null;
      toolInputBuf = "";
    }

    if (event.type === "content_block_delta") {
      const delta = event.delta;
      if (delta.type === "text_delta") {
        fullText += delta.text;
        sendEvent(res, "token", { agent, text: delta.text });
      } else if (delta.type === "input_json_delta") {
        toolInputBuf += delta.partial_json;
      }
    }

    if (event.type === "content_block_stop") {
      if (currentBlockType === "tool_use" && toolName === "web_search" && toolInputBuf) {
        try {
          const input = JSON.parse(toolInputBuf) as { query?: string };
          if (input.query) {
            const indicator = `\n\n🔍 **웹 검색**: "${input.query}"\n\n`;
            fullText += indicator;
            sendEvent(res, "search_query", { agent, query: input.query });
            sendEvent(res, "token", { agent, text: indicator });
          }
        } catch { /* ignore */ }
      }
      currentBlockType = null;
      toolName = null;
    }
  }

  sendEvent(res, "agent_done", { agent, text: fullText });
  return fullText;
}

// ─── Phase 1: 기획 분석 (상용화 수준, 3라운드 전문가 토론) ────────────────────

const P1_STRATEGIST = `당신은 K-웹툰 시장 전문 전략 기획자(agent_strategist)입니다.
네이버웹툰/카카오페이지/레진코믹스에서 10년 이상 경험한 시니어 PD 수준의 분석을 제공합니다.

[필수 수행]
1. 웹 검색으로 현재 해당 장르 실제 인기 트렌드·플랫폼 TOP 작품 확인
2. 실제 경쟁작 2~3종 실명으로 벤치마크:
   - 작품명, 플랫폼, 연재기간, 독자 반응 수치 명시
   - 예: "《나 혼자만 레벨업》(카카오페이지, 2018~2021, 누적 14억 뷰)은..."
3. 시장 포지셔닝 평가: 대중성(0~100점) / 신규IP(0~100점) 위치 명시
4. 핵심 독자층 분석 (연령대/성별/소비 패턴)
5. USP 3~5개: "독자는 이 작품에서 [구체적 경험]을 얻습니다" 형식

[말투] 데이터 기반, 논리적, 전문적. 불확실 수치는 "(추정)" 표시.
[분량] 450~650자.`;

const P1_RESEARCHER = `당신은 스토리 논리성·현실성 검토 전문 심층 조사자(agent_researcher)입니다.

[필수 수행]
1. 웹 검색으로 기획안 배경·설정 현실성 팩트체크
2. 유사 소재 선행 웹툰 2~3종 실명 언급:
   - "이 [요소]는 《작품명》(플랫폼, 연도)의 [소재]와 유사합니다"
   - 클리셰 수준: 심각/경미/차별화 가능 평가
3. 내부 설정 모순 구체적 지적:
   - "X 능력이 Y 조건이면 Z 장면이 논리적으로 불가능해집니다"
   - 각 문제마다 구체적 대안 반드시 제시 (단순 비판 금지)
4. 전략기획자 분석 보완 또는 다른 시각 제시

[말투] 날카롭되 건설적. 작품명·수치 구체 인용. 문제마다 대안 필수.
[분량] 400~600자.`;

const P1_SCENARIO = `당신은 K-웹툰 전문 시나리오 작가(agent_scenario)입니다.

[필수 수행]
1. 3막 구조 화수 배분 (구체적 숫자):
   - 1막 도입 (1~N화): 훅, 세계관 설정, 동기 확립
   - 2막 갈등 (N~M화): 핵심 갈등, 반전 포인트
   - 3막 해결 (M~100화): 클라이맥스, 엔딩
2. 독자 이탈 방지 훅 포인트 화수 명시:
   예: "5화: 첫 반전 / 20화: 시즌1 클라이맥스 / 50화: 주인공 각성"
3. 웹 검색으로 동일 장르 장기 연재 성공 패턴 확인
4. 시즌 분리·스핀오프 잠재력 평가

[말투] 실무적, 구체적. 화수는 반드시 숫자. [분량] 350~500자.`;

const P1_SCRIPT = `당신은 K-웹툰 전문 대본/연출 작가(agent_script)입니다.

[필수 수행]
1. 웹툰 세로스크롤 특성 반영 연출 전략:
   - 독자가 스크롤 멈추는 "정지 포인트" 컷 배치 제안
   - 모바일 기준 1화 최적 분량 (컷 수)
2. 장르별 연출 문법:
   예: 로맨스→감정선 클로즈업 / 액션→와이드+스플래시 / 공포→공백 활용
3. 화 유형별 컷 배분 (구체적 숫자):
   - 도입화·클라이맥스화·일상화 각각
4. 독자 감정 조절 시각적 장치 제안

[말투] 현장감 있는 실무 언어. 컷 수 구체적. [분량] 350~500자.`;

const P1_PRODUCER_FINAL = `당신은 AI Webtoon Studio 총괄 프로듀서(agent_producer)입니다.
실제 웹툰 기획사 대표 PD 수준의 최종 보고서를 작성합니다.

[필수 수행]
1. "토론을 마무리합니다." 로 시작
2. 4에이전트 핵심 의견 종합 (충돌 지점 중재 포함)
3. Phase 2 진행 여부 명확히 안내

[말투] 권위 있고 명확. PD 보고서 수준. [분량] 300~450자 (JSON 별도).

⚠️ 응답 마지막에 반드시 아래 JSON을 정확히 포함하세요:

[PHASE1_RESULT]
{
  "feasibility_score": 0.82,
  "feasibility_breakdown": {"market": 85, "originality": 80, "producibility": 75, "commercial": 88},
  "verdict": "go",
  "summary": "80자 이내 핵심 요약",
  "usp": [{"icon": "⚡", "title": "USP 제목", "desc": "설명\\n2줄", "prediction": "독자 반응 예측"}],
  "competitors": [{"title": "실제 작품명", "platform": "네이버웹툰", "period": "2022~연재중", "readers": "주간 200만+", "strengths": "강점", "weaknesses": "약점", "differentiation": "차별점", "genre_color": "#60a5fa"}],
  "positioning": {"ours": {"x": 65, "y": 72, "label": "우리 작품"}, "competitors": [{"x": 80, "y": 30, "label": "작품명"}]},
  "radar": {"ours": [70, 85, 60, 80, 75], "avg": [65, 60, 70, 65, 70], "categories": ["신선도", "감정몰입", "세계관", "캐릭터", "상업성"]},
  "final_report": "A4 1장 기획 요약서 전문 (최소 300자)"
}
[/PHASE1_RESULT]

verdict: "go" ≥ 0.70 | "conditional" 0.50~0.69 | "reject" < 0.50
모든 수치는 실제 토론 기반으로 정직하게 산정.`;

phasesRouter.post("/:projectId/phase-1", authMiddleware, async (req: Request, res: Response) => {
  const { genre, concept } = req.body as { genre?: string; concept?: string };
  if (!genre || !concept) { res.status(400).json({ error: "genre와 concept이 필요합니다" }); return; }

  const client = new Anthropic();
  sseHeaders(res);

  try {
    const userPrompt = `장르: ${genre}\n\n기획 아이디어:\n${concept}`;

    // ── Round 1: 전략기획자 ──
    sendEvent(res, "round_start", { round: 1, label: "시장 분석 · 팩트체크" });
    const s1Text = await streamAgent(res, client, "strategist", P1_STRATEGIST,
      [{ role: "user", content: userPrompt }], 2000, true);

    // ── Round 1: 심층조사자 ──
    const r1Text = await streamAgent(res, client, "researcher", P1_RESEARCHER, [
      { role: "user", content: userPrompt },
      { role: "assistant", content: `[전략기획자]\n${s1Text}` },
      { role: "user", content: "심층 조사 분석을 진행해주세요." },
    ], 2000, true);

    const r1Context = `[전략기획자 Round 1]\n${s1Text}\n\n[심층조사자 Round 1]\n${r1Text}`;

    // ── Round 2: 시나리오 작가 ──
    sendEvent(res, "round_start", { round: 2, label: "구조 설계 · 연출 전략" });
    const sc2Text = await streamAgent(res, client, "scenario", P1_SCENARIO, [
      { role: "user", content: `${userPrompt}\n\n[1라운드 토론]\n${r1Context}\n\n2라운드 시나리오 구조 분석을 진행해주세요.` },
    ], 2000, true);

    // ── Round 2: 연출 작가 ──
    const sp2Text = await streamAgent(res, client, "script", P1_SCRIPT, [
      { role: "user", content: `${userPrompt}\n\n[1라운드 토론]\n${r1Context}\n\n2라운드 연출 전략을 분석해주세요.` },
    ], 2000, false);

    const allContext = `${r1Context}\n\n[시나리오 작가 Round 2]\n${sc2Text}\n\n[연출 작가 Round 2]\n${sp2Text}`;

    // ── Round 3: 총괄 프로듀서 ──
    sendEvent(res, "round_start", { round: 3, label: "최종 종합 · PD 보고서" });
    await streamAgent(res, client, "producer", P1_PRODUCER_FINAL, [
      { role: "user", content: `${userPrompt}\n\n[전체 토론]\n${allContext}\n\n최종 종합 평가를 진행해주세요.` },
    ], 3500, true);

    void sp2Text; // used via allContext
    await tickWindow(res, client, req.params.projectId, 1, userPrompt);
    sendEvent(res, "done", { phase: 1 });
  } catch (err) {
    sendEvent(res, "error", { message: err instanceof Error ? err.message : String(err) });
  } finally {
    res.end();
  }
});

// ─── Phase 2: 세계관/에셋 설계 ────────────────────────────────────────────────

const WORLDBUILDER_PROMPT = `당신은 AI Webtoon Studio 세계관 설계자(agent_worldbuilder)입니다.
웹 검색으로 장르 트렌드를 조사하고 독창적인 세계관을 설계합니다.
응답 마지막에 [WORLD_CARD]{"era":"...","atmosphere":"...","rules":["...","...","..."]}[/WORLD_CARD] 포함.
말투: 전문적이고 창의적. 자연스러운 한국어. 분량: 150자 후 JSON.`;

const CHARACTER_PROTAGONIST_PROMPT = `당신은 캐릭터 디자이너(agent_character)입니다. 주인공을 초정밀하게 설계합니다.
응답 마지막에 [CHAR_CARD]{"name":"...","role":"protagonist","appearance":{...},"personality":"...","speech":"...","abilities":[...],"trauma":"..."}[/CHAR_CARD] 포함.
말투: 전문적. 자연스러운 한국어. 분량: 100자 후 JSON.`;

const CHARACTER_ANTAGONIST_PROMPT = `당신은 캐릭터 디자이너(agent_character)입니다. 빌런을 초정밀하게 설계합니다.
응답 마지막에 [CHAR_CARD]{"name":"...","role":"antagonist","appearance":{...},"personality":"...","speech":"...","abilities":[...],"trauma":"..."}[/CHAR_CARD] 포함.
말투: 전문적. 자연스러운 한국어. 분량: 100자 후 JSON.`;

const MST_PROMPT = `당신은 캐릭터 디자이너(agent_character)입니다. MST(마스터 스타일 토큰)를 설계합니다.
웹 검색으로 장르 화풍 트렌드를 조사하세요.
응답 마지막에 [MST_CARD]{"line_weight":"...","coloring":"...","perspective":"...","forbidden_tags":[...],"style_keywords":[...]}[/MST_CARD] 포함.
말투: 전문적. 자연스러운 한국어. 분량: 100자 후 JSON.`;

const AB_PROMPT = `당신은 세계관 설계자(agent_worldbuilder)입니다. 디자인 방향 A/B안을 제안합니다.
응답 마지막에 [AB_CARD]{"options":[{"label":"A안","style":"...","keywords":[...],"desc":"..."},{"label":"B안","style":"...","keywords":[...],"desc":"..."}]}[/AB_CARD] 포함.
말투: 친근하고 설득력 있게. 자연스러운 한국어. 분량: 80자 후 JSON.`;

phasesRouter.post("/:projectId/phase-2", authMiddleware, async (req: Request, res: Response) => {
  const { genre, phase1Summary } = req.body as { genre?: string; phase1Summary?: string };
  if (!genre) { res.status(400).json({ error: "genre가 필요합니다" }); return; }

  const client = new Anthropic();
  sseHeaders(res);

  try {
    const ctx = `장르: ${genre}${phase1Summary ? `\nPhase 1 요약: ${phase1Summary}` : ""}`;

    const worldText = await streamAgent(res, client, "worldbuilder", WORLDBUILDER_PROMPT,
      [{ role: "user", content: `${genre} 장르 세계관을 설계해주세요.\n${ctx}` }]);

    const worldMatch = worldText.match(/\[WORLD_CARD\]([\s\S]*?)\[\/WORLD_CARD\]/);
    const worldSummary = worldMatch ? JSON.stringify(JSON.parse(worldMatch[1])).slice(0, 200) : worldText.slice(0, 200);

    const char1Text = await streamAgent(res, client, "character", CHARACTER_PROTAGONIST_PROMPT, [
      { role: "user", content: ctx },
      { role: "assistant", content: `[세계관]\n${worldSummary}` },
      { role: "user", content: "주인공 캐릭터 시트를 작성해주세요." },
    ], 3000, false);

    const char2Text = await streamAgent(res, client, "character", CHARACTER_ANTAGONIST_PROMPT, [
      { role: "user", content: ctx },
      { role: "assistant", content: `[세계관]\n${worldSummary}\n[주인공]\n${char1Text.slice(0, 150)}` },
      { role: "user", content: "빌런 캐릭터 시트를 작성해주세요." },
    ], 3000, false);

    const mstText = await streamAgent(res, client, "character", MST_PROMPT, [
      { role: "user", content: `${ctx}\n세계관: ${worldSummary}` },
      { role: "user", content: "MST를 설계해주세요." },
    ]);

    const mstMatch = mstText.match(/\[MST_CARD\]([\s\S]*?)\[\/MST_CARD\]/);
    const mstSummary = mstMatch ? JSON.stringify(JSON.parse(mstMatch[1])).slice(0, 150) : "";

    await streamAgent(res, client, "worldbuilder", AB_PROMPT, [
      { role: "user", content: `${ctx}\n세계관: ${worldSummary}\nMST: ${mstSummary}` },
      { role: "user", content: "디자인 방향 A/B안을 제안해주세요." },
    ], 2000, false);

    void char2Text; // used implicitly through pipeline
    await tickWindow(res, client, req.params.projectId, 2, ctx);
    sendEvent(res, "done", { phase: 2 });
  } catch (err) {
    sendEvent(res, "error", { message: err instanceof Error ? err.message : String(err) });
  } finally {
    res.end();
  }
});

// ─── Phase 3: 100화 로드맵 ────────────────────────────────────────────────────

phasesRouter.post("/:projectId/phase-3", authMiddleware, async (req: Request, res: Response) => {
  const { genre, context } = req.body as { genre?: string; context?: string };
  if (!genre) { res.status(400).json({ error: "genre가 필요합니다" }); return; }

  const client = new Anthropic();
  sseHeaders(res);

  try {
    const ctx = context ?? `장르: ${genre}`;

    // Researcher
    await streamAgent(res, client, "researcher",
      `당신은 심층 조사자입니다. ${genre} 장르 장기 연재 독자 유지율 패턴과 막 구조를 웹 검색으로 분석하세요. 분량: 200자.`,
      [{ role: "user", content: `${genre} 장르 100화 로드맵 전략을 분석해주세요.` }]);

    // Roadmap overview
    const roadmapText = await streamAgent(res, client, "scenario",
      `당신은 시나리오 작가입니다. 4막 구조 100화 로드맵을 설계하세요.
응답 마지막에 [ROADMAP_CARD]{"arcs":[{"num":1,"name":"...","theme":"...","eps":[1,25],"color":"#60a5fa"},{"num":2,"name":"...","theme":"...","eps":[26,50],"color":"#34d399"},{"num":3,"name":"...","theme":"...","eps":[51,75],"color":"#fbbf24"},{"num":4,"name":"...","theme":"...","eps":[76,100],"color":"#f472b6"}],"totalEps":100}[/ROADMAP_CARD] 포함.`,
      [{ role: "user", content: `${ctx}\n4막 로드맵을 작성해주세요.` }],
      2000, false);

    const rmMatch = roadmapText.match(/\[ROADMAP_CARD\]([\s\S]*?)\[\/ROADMAP_CARD\]/);
    interface ArcInfo { num: number; name: string; theme: string; eps: [number, number] }
    let arcs: ArcInfo[] = [];
    try { if (rmMatch) arcs = (JSON.parse(rmMatch[1]) as { arcs: ArcInfo[] }).arcs; } catch { /* ignore */ }
    if (arcs.length === 0) {
      arcs = [
        { num: 1, name: "서막", theme: "도입", eps: [1, 25] },
        { num: 2, name: "전개", theme: "갈등", eps: [26, 50] },
        { num: 3, name: "위기", theme: "반전", eps: [51, 75] },
        { num: 4, name: "결말", theme: "해결", eps: [76, 100] },
      ];
    }

    // Episodes per arc
    const ARC_COLORS = ["#60a5fa", "#34d399", "#fbbf24", "#f472b6"];
    for (const arc of arcs) {
      const tag = `EPISODE_CARD_${arc.num}`;
      const arcColor = ARC_COLORS[arc.num - 1];
      await streamAgent(res, client, "scenario",
        `당신은 시나리오 작가입니다. ${arc.num}막 "${arc.name}" EP ${arc.eps[0]}–${arc.eps[1]} 25화를 설계하세요.
응답 마지막에 [${tag}]{"episodes":[{"ep":${arc.eps[0]},"title":"화 제목","event":"핵심 사건","characters":["주인공"],"emotion":"감정","foreshadow":"복선","cliffhanger":"","arc":${arc.num},"tension":3}],"arcLabel":"${arc.num}막 — ${arc.name}","arcColor":"${arcColor}"}[/${tag}] 포함. 정확히 25개 에피소드.`,
        [{ role: "user", content: `${ctx}\n${arc.num}막 에피소드를 작성해주세요.` }],
        8000, false);
    }

    // Producer sign-off
    await streamAgent(res, client, "producer",
      `당신은 총괄 프로듀서입니다. 100화 로드맵 검토 및 Phase 4 안내를 해주세요. 분량: 150자.`,
      [{ role: "user", content: "로드맵 최종 검토를 부탁합니다." }],
      1000, false);

    await tickWindow(res, client, req.params.projectId, 3, ctx);
    sendEvent(res, "done", { phase: 3 });
  } catch (err) {
    sendEvent(res, "error", { message: err instanceof Error ? err.message : String(err) });
  } finally {
    res.end();
  }
});

// ─── Phase 4: 30컷 대본 ───────────────────────────────────────────────────────

phasesRouter.post("/:projectId/phase-4/:episode", authMiddleware, async (req: Request, res: Response) => {
  const episode = parseInt(req.params.episode, 10);
  const { genre, context } = req.body as { genre?: string; context?: string };
  if (!genre || isNaN(episode)) { res.status(400).json({ error: "genre와 유효한 episode 번호가 필요합니다" }); return; }

  const client = new Anthropic();
  sseHeaders(res);

  try {
    const ctx = context ?? `장르: ${genre}, 화: ${episode}화`;
    const tag = `CUT_SCRIPT_${episode}`;

    // Script writer intro
    await streamAgent(res, client, "script",
      `당신은 대본/연출 작가입니다. ${episode}화 대본 작성 방향을 20자로 안내하세요.`,
      [{ role: "user", content: ctx }], 200, false);

    // Character SCC intro
    await streamAgent(res, client, "character",
      `당신은 캐릭터 디자이너입니다. ${episode}화 SCC 검증 시작을 10자로 안내하세요.`,
      [{ role: "user", content: ctx }], 100, false);

    // 30-cut script
    await streamAgent(res, client, "script",
      `당신은 대본/연출 작가입니다. ${episode}화 30컷 대본을 작성하세요.
응답 마지막에 [${tag}]{"ep":${episode},"cuts":[{"cut":1,"panel":"와이드","angle":"정면","placement":"중앙 단독","expression":"결의","dialogue":"대사","sfx":"효과음","direction":"연출 의도","mstTags":["태그1","태그2"],"scc":"pass"}],"sccRate":0.9}[/${tag}] 포함. 정확히 30개 컷. sccRate는 pass 비율.`,
      [{ role: "user", content: `${ctx}\n30컷 대본을 작성해주세요.` }],
      8000, false);

    // SCC report
    await streamAgent(res, client, "character",
      `당신은 캐릭터 디자이너입니다. ${episode}화 SCC 검증 결과를 100자로 보고하세요.`,
      [{ role: "user", content: ctx }], 500, false);

    // Producer review
    await streamAgent(res, client, "producer",
      `당신은 총괄 프로듀서입니다. ${episode}화 대본 검토 및 다음 단계 안내를 100자로 해주세요.`,
      [{ role: "user", content: ctx }], 500, false);

    await tickWindow(res, client, req.params.projectId, 4, ctx);
    sendEvent(res, "done", { phase: 4, episode });
  } catch (err) {
    sendEvent(res, "error", { message: err instanceof Error ? err.message : String(err) });
  } finally {
    res.end();
  }
});

// ─── Phase GATING ─────────────────────────────────────────────────────────────

phasesRouter.post("/:projectId/gate/:phase", authMiddleware, async (req: Request, res: Response) => {
  const phase = parseInt(req.params.phase, 10);
  const { feasibility_score } = req.body as { feasibility_score?: number };

  // GATING conditions per CLAUDE.md
  const gates: Record<number, () => { pass: boolean; reason?: string }> = {
    1: () => {
      if (feasibility_score === undefined) return { pass: false, reason: "feasibility_score가 필요합니다" };
      if (feasibility_score < 0.5) return { pass: false, reason: `feasibility_score ${feasibility_score} < 0.5 — Phase 2 진행 불가` };
      return { pass: true };
    },
    2: () => ({ pass: true }),  // A/B 선택 완료 여부는 클라이언트에서 확인
    3: () => ({ pass: true }),  // 사용자 확인은 클라이언트에서 처리
    4: () => ({ pass: true }),
  };

  const gate = gates[phase];
  if (!gate) { res.status(400).json({ error: `Phase ${phase}의 GATING이 정의되지 않았습니다` }); return; }

  const result = gate();
  if (result.pass) {
    res.json({ pass: true, next_phase: phase + 1, message: `Phase ${phase} GATING 통과` });
  } else {
    res.status(422).json({ pass: false, reason: result.reason });
  }
});
