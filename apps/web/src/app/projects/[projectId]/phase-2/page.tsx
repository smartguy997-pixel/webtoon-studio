
"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import s from "./page.module.css";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

const AGENTS = {
  strategist:  { label: "전략 기획자",    color: "#a78bfa", bg: "rgba(167,139,250,0.12)", ini: "전" },
  researcher:  { label: "심층 조사자",    color: "#34d399", bg: "rgba(52,211,153,0.12)",  ini: "심" },
  worldbuilder:{ label: "세계관 설계자",  color: "#60a5fa", bg: "rgba(96,165,250,0.12)",  ini: "세" },
  character:   { label: "캐릭터 디자이너",color: "#fb923c", bg: "rgba(251,146,60,0.12)",  ini: "캐" },
  scenario:    { label: "시나리오 작가",  color: "#fbbf24", bg: "rgba(251,191,36,0.12)",  ini: "시" },
  script:      { label: "대본/연출 작가", color: "#f87171", bg: "rgba(248,113,113,0.12)", ini: "대" },
  producer:    { label: "총괄 프로듀서",  color: "#f1f5f9", bg: "rgba(241,245,249,0.12)", ini: "총" },
  user:        { label: "나",             color: "#7c6cfc", bg: "rgba(124,108,252,0.12)", ini: "나" },
} as const;
type AgentId = keyof typeof AGENTS;

type CardType = "world" | "character" | "mst" | "ab";

interface CharSheet {
  name: string; role: string;
  appearance: { face:string; eyes:string; nose:string; mouth:string; hair:string; body:string; outfit:string; };
  personality: string; speech: string; abilities: string[]; trauma: string;
}
interface WorldCard { era:string; atmosphere:string; rules:string[]; }
interface MstCard {
  line_weight:string; coloring:string; perspective:string;
  forbidden_tags:string[]; style_keywords:string[];
}
interface AbCard { options: Array<{label:string; style:string; keywords:string[]; desc:string}>; chosen?:string; }

interface Msg {
  id: string; agent: AgentId; text: string;
  type: "text" | "card"; cardType?: CardType;
  world?: WorldCard; character?: CharSheet; mst?: MstCard; ab?: AbCard;
  done: boolean;
}

function mkId() { return Math.random().toString(36).slice(2); }
function wait(ms:number) { return new Promise<void>(r=>setTimeout(r,ms)); }

function ThinkingDots() {
  return <div className={s.dots}><span/><span/><span/></div>;
}

function WorldCardView({ w }: { w: WorldCard }) {
  return (
    <div className={s.worldCard}>
      <div className={s.cardLabel} style={{color:"#60a5fa"}}>세계관 설계</div>
      <div className={s.worldRow}><span className={s.wLabel}>시대/배경</span><span className={s.wVal}>{w.era}</span></div>
      <div className={s.worldRow}><span className={s.wLabel}>분위기</span><span className={s.wVal}>{w.atmosphere}</span></div>
      <div className={s.worldRules}>
        <div className={s.wLabel}>세계관 규칙</div>
        {w.rules.map((r,i)=><div key={i} className={s.ruleItem}>◆ {r}</div>)}
      </div>
    </div>
  );
}

function CharCardView({ c }: { c: CharSheet }) {
  const roleColor = c.role==="protagonist"?"#a78bfa":c.role==="antagonist"?"#f87171":"#60a5fa";
  const roleLabel = c.role==="protagonist"?"주인공":c.role==="antagonist"?"빌런":"조력자";
  return (
    <div className={s.charCard}>
      <div className={s.charHeader}>
        <div className={s.charName}>{c.name}</div>
        <span className={s.charRole} style={{background:`${roleColor}20`,color:roleColor,border:`1px solid ${roleColor}40`}}>{roleLabel}</span>
      </div>
      <div className={s.charSection}>
        <div className={s.charSectionTitle} style={{color:"#fb923c"}}>외형</div>
        <div className={s.charGrid}>
          {Object.entries(c.appearance).map(([k,v])=>(
            <div key={k} className={s.charField}>
              <span className={s.fieldKey}>{({face:"얼굴형",eyes:"눈",nose:"코",mouth:"입",hair:"헤어",body:"체형",outfit:"의상"})[k]??k}</span>
              <span className={s.fieldVal}>{v}</span>
            </div>
          ))}
        </div>
      </div>
      <div className={s.charSection}>
        <div className={s.charSectionTitle} style={{color:"#fb923c"}}>내면</div>
        <div className={s.charField}><span className={s.fieldKey}>성격</span><span className={s.fieldVal}>{c.personality}</span></div>
        <div className={s.charField}><span className={s.fieldKey}>말투</span><span className={s.fieldVal}>{c.speech}</span></div>
        <div className={s.charField}><span className={s.fieldKey}>트라우마</span><span className={s.fieldVal}>{c.trauma}</span></div>
      </div>
      <div className={s.charSection}>
        <div className={s.charSectionTitle} style={{color:"#fb923c"}}>능력/특기</div>
        <div className={s.abilityList}>{c.abilities.map((a,i)=><span key={i} className={s.abilityTag}>{a}</span>)}</div>
      </div>
    </div>
  );
}

function MstCardView({ m }: { m: MstCard }) {
  return (
    <div className={s.mstCard}>
      <div className={s.cardLabel} style={{color:"#a78bfa"}}>MST — 마스터 스타일 토큰</div>
      <div className={s.mstRow}><span className={s.mLabel}>선 두께</span><code className={s.mCode}>{m.line_weight}</code></div>
      <div className={s.mstRow}><span className={s.mLabel}>채색 방식</span><code className={s.mCode}>{m.coloring}</code></div>
      <div className={s.mstRow}><span className={s.mLabel}>원근감</span><code className={s.mCode}>{m.perspective}</code></div>
      <div className={s.mstRow}>
        <span className={s.mLabel}>금지 태그</span>
        <div className={s.tagList}>{m.forbidden_tags.map((t,i)=><span key={i} className={s.tagForbid}>{t}</span>)}</div>
      </div>
      <div className={s.mstRow}>
        <span className={s.mLabel}>스타일 키워드</span>
        <div className={s.tagList}>{m.style_keywords.map((t,i)=><span key={i} className={s.tagStyle}>{t}</span>)}</div>
      </div>
    </div>
  );
}

function AbCardView({ ab, onChoose }: { ab: AbCard; onChoose: (label:string)=>void }) {
  return (
    <div className={s.abWrap}>
      <div className={s.cardLabel} style={{color:"#fbbf24"}}>디자인 방향 A/B 선택</div>
      <div className={s.abRow}>
        {ab.options.map(opt=>(
          <div key={opt.label}
            className={`${s.abCard} ${ab.chosen===opt.label?s.abChosen:""}`}
            onClick={()=>!ab.chosen && onChoose(opt.label)}>
            <div className={s.abLabel}>{opt.label}</div>
            <div className={s.abStyle}>{opt.style}</div>
            <div className={s.abDesc}>{opt.desc}</div>
            <div className={s.abKwList}>{opt.keywords.map((k,i)=><span key={i} className={s.abKw}>{k}</span>)}</div>
            {ab.chosen===opt.label && <div className={s.abCheck}>✓ 선택됨</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function MsgBubble({ msg, onAbChoose }: { msg: Msg; onAbChoose: (id:string, label:string)=>void }) {
  const ag = AGENTS[msg.agent];
  const isUser = msg.agent==="user";
  return (
    <div className={`${s.msgRow} ${isUser?s.msgRowUser:""}`}>
      {!isUser && (
        <div className={s.avatar} style={{background:ag.bg,color:ag.color,border:`1px solid ${ag.color}40`}}>{ag.ini}</div>
      )}
      <div className={s.msgMain}>
        {!isUser && <div className={s.agentName} style={{color:ag.color}}>{ag.label}</div>}
        <div className={`${s.bubble} ${isUser?s.bubbleUser:""}`}
             style={!isUser?{borderLeft:`3px solid ${ag.color}60`}:{}}>
          {!msg.done ? <ThinkingDots/> : (
            <>
              {msg.text && <div className={s.msgText}>{msg.text}</div>}
              {msg.type==="card" && msg.world && <WorldCardView w={msg.world}/>}
              {msg.type==="card" && msg.character && <CharCardView c={msg.character}/>}
              {msg.type==="card" && msg.mst && <MstCardView m={msg.mst}/>}
              {msg.type==="card" && msg.ab && <AbCardView ab={msg.ab} onChoose={lbl=>onAbChoose(msg.id,lbl)}/>}
            </>
          )}
        </div>
      </div>
      {isUser && (
        <div className={s.avatar} style={{background:ag.bg,color:ag.color,border:`1px solid ${ag.color}40`}}>나</div>
      )}
    </div>
  );
}

function buildMockData(genre: string) {
  const worldByGenre: Record<string,WorldCard> = {
    "판타지":{ era:"현대 판타지 (21세기 한국)", atmosphere:"도심 속 숨겨진 이계 — 어둡고 습한 골목, 형광등이 깜빡이는 지하 세계", rules:["마법은 반드시 대가를 요구한다 — 기억, 수명, 감각 중 하나","인간과 이계의 경계는 특정 조건에서만 열린다","이계의 존재는 인간의 언어로 거짓말을 할 수 없다"] },
    "로맨스":{ era:"현대 한국 (서울)", atmosphere:"바쁜 도시 속 잠깐의 정지 — 따뜻한 조명, 빗소리, 카페 창가", rules:["주인공들의 첫 만남은 반드시 오해에서 시작된다","감정은 행동보다 항상 늦게 인식된다","세 번의 스침이 있어야 진짜 인연이 시작된다"] },
    "액션":  { era:"근미래 (2045년 메가시티)", atmosphere:"네온사인과 빈민가의 공존 — 높은 빌딩과 지하 지구 사이의 계층 사회", rules:["강함은 타고나는 것이 아니라 데이터로 증명된다","규칙은 위에서 만들고, 아래는 살아남는 법을 찾는다","모든 전투에는 반드시 목격자가 있다"] },
  };
  const world = worldByGenre[genre] ?? worldByGenre["판타지"];

  const protagonist: CharSheet = {
    name: "이하늘 (주인공)", role: "protagonist",
    appearance: {
      face: "계란형, 갸름한 턱선, 넓은 이마",
      eyes: "쌍꺼풀 없는 깊은 눈, 진한 갈색 홍채, 눈꼬리 약간 올라감",
      nose: "낮고 부드러운 콧날, 작은 코끝",
      mouth: "얇은 윗입술, 도톰한 아랫입술, 평소 입꼬리 살짝 내려감",
      hair: "새카만 단발, 앞머리가 눈썹을 살짝 덮음, 귀 뒤로 넘기는 습관",
      body: "168cm / 보통 체형 / 어깨 좁음 / 손이 크고 길쭉함",
      outfit: "검정 후드 + 흰 티셔츠 + 낡은 청바지 (고정 아이템: 왼쪽 손목 붕대)",
    },
    personality: "겉으로는 차갑고 무뚝뚝하나 타인을 깊이 염려함. 자기 파괴적 경향.",
    speech: "단답형, 존댓말/반말 혼용, 감탄사 없음, 직설적",
    abilities: ["잠재된 이계 감지 능력", "기억 조작 면역", "극한 상황 냉정 판단"],
    trauma: "7세 때 눈앞에서 부모 실종. 원인 불명.",
  };

  const antagonist: CharSheet = {
    name: "강도현 (빌런)", role: "antagonist",
    appearance: {
      face: "각진 윤곽, 높은 광대뼈, 날카로운 턱",
      eyes: "가느다란 눈, 차가운 회색 홍채, 항상 반쯤 감긴 듯",
      nose: "높고 날카로운 콧대",
      mouth: "얇은 입술, 항상 미소를 머금음 (감정이 없는 미소)",
      hair: "새치 섞인 짧은 검은 머리, 깔끔하게 정돈",
      body: "185cm / 마른 근육형 / 손가락이 길고 창백함",
      outfit: "맞춤 정장 (항상 단추 하나 풀림) / 고정 아이템: 왼쪽 새끼손가락 반지",
    },
    personality: "지성적이고 냉정함. 타인을 체스 말로 봄. 드물게 진정한 존중을 표한다.",
    speech: "느리고 명확한 발화, 항상 존댓말, 간접적 표현 선호, 칭찬을 위협처럼 씀",
    abilities: ["인간 심리 조작", "정보 독점 네트워크", "이계 계약 지식"],
    trauma: "어린 시절 동생을 잃음. 이계 때문이라 확신.",
  };

  const mst: MstCard = {
    line_weight: "0.8~1.2px 균일선, 감정 고조 시 2px, 원거리 배경 0.4px",
    coloring: "수채화 텍스처 + 셀 셰이딩 혼합 / 그림자는 보라-파랑 계열",
    perspective: "3/4 앵글 기본, 감정 씬은 정면, 로우앵글 금지(캐릭터 왜곡)",
    forbidden_tags: ["chibi","super_deformed","neon_color","lens_flare","sparkle_eyes"],
    style_keywords: ["webtoon_lineart","korean_manhwa","dark_fantasy","detailed_eyes","monochrome_shadow"],
  };

  const ab: AbCard = {
    options: [
      { label:"A안", style:"다크 모던 판타지", keywords:["어두운 배경","고대비","보라-회색 팔레트"], desc:"어둡고 무거운 톤. 이계의 위협감과 도시의 차가움을 강조. 성인 독자층 타겟." },
      { label:"B안", style:"세련된 도시 판타지", keywords:["도시적","청량함","파랑-흰색 팔레트"], desc:"세련되고 청량한 톤. 이계 요소를 신선하게 표현. 10~20대 폭넓은 독자층 타겟." },
    ],
  };

  return { world, protagonist, antagonist, mst, ab };
}

export default function Phase2Page({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const router = useRouter();
  const [genre, setGenre] = useState("판타지");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [userInput, setUserInput] = useState("");
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [abChosen, setAbChosen] = useState(false);
  const [mstDone, setMstDone] = useState(false);
  const [isMock, setIsMock] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const p1 = JSON.parse(localStorage.getItem(`wts_phase1_${projectId}`) ?? "null");
      if (p1?.input?.genre) setGenre(p1.input.genre);
      const p2 = JSON.parse(localStorage.getItem(`wts_phase2_${projectId}`) ?? "null");
      if (p2) {
        setStarted(true); setMstDone(true); setAbChosen(true); setIsMock(p2.isMock ?? true);
        setMessages([{
          id: mkId(), agent:"producer", type:"text", done:true,
          text:`이전 세계관/에셋 설계 결과를 불러왔습니다. Phase 3으로 진행하거나 수정 사항을 말씀해 주세요.`,
        }]);
      }
    } catch {}
  }, [projectId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages]);

  const addMsg = useCallback((m: Omit<Msg,"id">) => {
    const id = mkId();
    setMessages(prev => [...prev, { ...m, id }]);
    return id;
  }, []);

  const reveal = useCallback((id:string, delay:number) =>
    new Promise<void>(res => setTimeout(() => {
      setMessages(prev => prev.map(m => m.id===id ? {...m,done:true} : m));
      res();
    }, delay)), []);

  async function startChat() {
    setStarted(true); setRunning(true); setMessages([]);
    setIsMock(true);
    const { world, protagonist, antagonist, mst, ab } = buildMockData(genre);

    const id1 = addMsg({ agent:"worldbuilder", type:"text", done:false,
      text:`Phase 1 기획을 바탕으로 세계관 설계를 시작합니다. ${genre} 장르의 독자가 몰입할 수 있는 세계관 규칙을 수립하고, 이후 캐릭터 디자이너와 함께 에셋을 구체화하겠습니다.` });
    await reveal(id1, 1300); await wait(300);

    const id2 = addMsg({ agent:"worldbuilder", type:"card", cardType:"world", world, done:false, text:"" });
    await reveal(id2, 800); await wait(500);

    const id3 = addMsg({ agent:"character", type:"text", done:false,
      text:`세계관이 확정되었습니다. 이제 주요 캐릭터를 초정밀하게 정의하겠습니다. 이미지 생성 AI가 일관된 결과를 내려면 외형을 최대한 구체적으로 기술해야 합니다.` });
    await reveal(id3, 1100); await wait(300);

    const id4 = addMsg({ agent:"character", type:"card", cardType:"character", character:protagonist, done:false, text:"" });
    await reveal(id4, 900); await wait(400);

    const id5 = addMsg({ agent:"character", type:"card", cardType:"character", character:antagonist, done:false, text:"" });
    await reveal(id5, 900); await wait(500);

    const id6 = addMsg({ agent:"character", type:"text", done:false,
      text:`두 핵심 캐릭터의 외형이 확정되었습니다. 이제 화풍 일관성을 위해 MST(마스터 스타일 토큰)를 설정합니다. 이 토큰은 모든 이미지 생성 요청에 자동으로 적용됩니다.` });
    await reveal(id6, 1200); await wait(300);

    const id7 = addMsg({ agent:"character", type:"card", cardType:"mst", mst, done:false, text:"" });
    await reveal(id7, 700); setMstDone(true); await wait(500);

    const id8 = addMsg({ agent:"worldbuilder", type:"text", done:false,
      text:`MST가 확정되었습니다. 마지막으로 전체적인 디자인 방향성에 대해 두 가지 안을 제안합니다. 어떤 방향이 작품의 의도와 더 잘 맞나요?` });
    await reveal(id8, 1100); await wait(300);

    const id9 = addMsg({ agent:"worldbuilder", type:"card", cardType:"ab", ab, done:false, text:"" });
    await reveal(id9, 600); await wait(300);

    localStorage.setItem(`wts_phase2_${projectId}`, JSON.stringify({
      data:{ world, characters:[protagonist,antagonist], mst, ab },
      isMock:true, savedAt:new Date().toISOString(),
    }));
    setRunning(false);
  }

  function handleAbChoose(msgId: string, label: string) {
    setMessages(prev => prev.map(m => {
      if (m.id !== msgId || !m.ab) return m;
      return { ...m, ab: { ...m.ab, chosen: label } };
    }));
    setAbChosen(true);
    const id = addMsg({ agent:"user", type:"text", done:true, text:`${label}을 선택하겠습니다.` });
    setTimeout(() => {
      const rid = addMsg({ agent:"producer", type:"text", done:false,
        text:`${label} 방향이 확정되었습니다. 세계관 설계, 캐릭터 시트 2종, MST, 디자인 방향 모두 확정되었습니다.\n\nPhase 3에서 이 에셋을 기반으로 100화 시나리오 로드맵을 작성할 수 있습니다.` });
      setTimeout(() => setMessages(prev => prev.map(m => m.id===rid ? {...m,done:true} : m)), 1200);
    }, 500);
  }

  async function sendUserMsg() {
    const text = userInput.trim();
    if (!text || running) return;
    setUserInput(""); setRunning(true);
    addMsg({ agent:"user", type:"text", text, done:true });
    await wait(900);
    const rid = addMsg({ agent:"worldbuilder", type:"text", done:false,
      text:`"${text.slice(0,30)}${text.length>30?"...":""}" — 의견을 반영해 수정 가능합니다. 구체적으로 변경하고 싶은 항목(세계관 규칙/캐릭터 외형/MST 등)을 알려주시면 해당 부분만 재작성하겠습니다.` });
    await reveal(rid, 1300);
    setRunning(false);
  }

  const canProceed = mstDone && abChosen;

  return (
    <div className={s.page}>
      {!started ? (
        <div className={s.formWrap}>
          <h1 className={s.formTitle}>Phase 2 — 세계관 & 에셋 설계</h1>
          <p className={s.formDesc}>세계관 규칙, 캐릭터 초정밀 외형, MST(마스터 스타일 토큰)를 AI 에이전트들이 실시간으로 설계합니다.</p>
          <div className={s.formCard}>
            <div className={s.prereqNote}>
              Phase 1 데이터를 자동으로 불러옵니다. 바로 세계관 설계를 시작합니다.
            </div>
            <button className={s.btnStart} onClick={startChat}>✦ 세계관/에셋 설계 시작</button>
          </div>
        </div>
      ) : (
        <div className={s.chatLayout}>
          <div className={s.chatHeader}>
            <span className={s.chatHeaderGenre}>{genre}</span>
            <span style={{fontSize:13,color:"#7878a0"}}>세계관 · 캐릭터 시트 · MST · 디자인 방향</span>
            {isMock && <span className={s.mockChip}>MOCK</span>}
            <button className={s.btnRestart} onClick={()=>{setStarted(false);setMessages([]);setAbChosen(false);setMstDone(false);}}>↺ 다시 시작</button>
          </div>

          <div className={s.chatBody}>
            {messages.map(m => (
              <MsgBubble key={m.id} msg={m} onAbChoose={handleAbChoose}/>
            ))}
            {running && messages.length===0 && (
              <div className={s.msgRow}>
                <div className={s.avatar} style={{background:AGENTS.worldbuilder.bg,color:AGENTS.worldbuilder.color,border:`1px solid ${AGENTS.worldbuilder.color}40`}}>세</div>
                <div className={s.msgMain}>
                  <div className={s.agentName} style={{color:AGENTS.worldbuilder.color}}>세계관 설계자</div>
                  <div className={s.bubble}><ThinkingDots/></div>
                </div>
              </div>
            )}
            <div ref={bottomRef}/>
          </div>

          <div className={s.chatBottom}>
            {canProceed && (
              <div className={s.gatingRow}>
                <span className={s.gatingMsg}>✓ 세계관 · 캐릭터 · MST · 디자인 방향 확정 — Phase 3 진행 가능</span>
                <button className={s.btnGating} onClick={()=>router.push(`/projects/${projectId}/phase-3`)}>Phase 3 시작 →</button>
              </div>
            )}
            <div className={s.inputRow}>
              <textarea className={s.chatInput} rows={1}
                placeholder="수정 요청 또는 의견을 입력하세요..."
                value={userInput} onChange={e=>setUserInput(e.target.value)}
                onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendUserMsg();}}}
              />
              <button className={s.btnSend} disabled={!userInput.trim()||running} onClick={sendUserMsg}>전송</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
