"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import s from "./page.module.css";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

interface Episode {
  ep: number; title: string; summary: string;
  tension: number; flags: Array<"hook"|"peak"|"reversal">; arc: number;
}
interface Arc {
  num: number; name: string; theme: string; eps: [number,number]; color: string;
}
interface Phase3Data {
  arcs: Arc[]; episodes: Episode[]; structure_note: string;
}
interface SavedResult {
  data: Phase3Data; gating_passed: boolean; isMock: boolean; savedAt: string;
}
type RunState = "idle"|"running"|"done";
type AgentStatus = "idle"|"running"|"done";

const ARC_COLORS = ["#60a5fa","#34d399","#fbbf24","#f472b6"];

const AGENTS = [
  { id:"researcher",   label:"심층 조사자",   desc:"장르 트렌드 · 독자 유지율 패턴 분석" },
  { id:"worldbuilder", label:"세계관 설계자",  desc:"세계관 확장 축 · 4막 기승전결 설계" },
  { id:"scenario",     label:"시나리오 작가", desc:"100화 에피소드 타이틀 · 완급 배분" },
  { id:"producer",     label:"총괄 프로듀서", desc:"로드맵 검토 · 최종 승인" },
];

function buildMock(genre: string, title: string): Phase3Data {
  const arcNameMap: Record<string,string[]> = {
    "판타지":["각성과 출발","시련과 성장","위기와 반전","결전과 완성"],
    "로맨스":["첫 만남과 설렘","갈등과 오해","위기와 화해","사랑의 완성"],
    "액션":  ["입문과 각성","훈련과 도전","배신과 극복","최후의 결전"],
    "SF":    ["발견과 탐험","갈등과 생존","진실과 반전","귀환과 새 시작"],
    "스릴러":["불안의 씨앗","추적과 회피","함정과 폭로","최후의 대결"],
  };
  const arcThemes = [
    "주인공 확립 · 세계관 도입",
    "핵심 갈등 심화 · 중간 보스 등장",
    "반전 연속 · 동료 위기",
    "클라이맥스 · 해결 · 여운",
  ];
  const names = arcNameMap[genre] ?? ["서막","갈등","전환","결말"];
  const arcs: Arc[] = names.map((name,i) => ({
    num:i+1, name, theme:arcThemes[i],
    eps:([[1,25],[26,50],[51,75],[76,100]] as [number,number][])[i],
    color:ARC_COLORS[i],
  }));

  const bases = ["각성","시련","선택","배신","동맹","위기","반전","진실","결심","돌파",
                 "희생","복수","화해","성장","도전","승리","상처","비밀","각오","폭풍"];
  const HOOK_EPS = new Set([5,10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90,95,100]);
  const PEAK_EPS = new Set([25,50,75,100]);
  const REV_EPS  = new Set([13,26,38,51,63,76,88,99]);

  const episodes: Episode[] = Array.from({length:100},(_,i) => {
    const ep = i+1;
    const arc = ep<=25?1:ep<=50?2:ep<=75?3:4;
    const tension = Math.min(5,Math.max(1,Math.round(2+(ep/100)*2.5+Math.sin(ep*0.3)*0.8)));
    const flags: Episode["flags"] = [];
    if (HOOK_EPS.has(ep)) flags.push("hook");
    if (PEAK_EPS.has(ep)) flags.push("peak");
    if (REV_EPS.has(ep))  flags.push("reversal");
    const base = bases[(ep-1)%bases.length];
    return { ep, title:`${ep}화 — ${base}${arc>=3?"의 끝":""}`,
      summary:`${arc}막 진행. ${tension>=4?"긴장감이 최고조":"이야기가 전개됨"}.`,
      tension, flags, arc };
  });

  return { arcs, episodes,
    structure_note:`${genre} 장르 "${title||"이 작품"}"의 100화 4막 구조 로드맵입니다. 매 25화마다 정점(PEAK)을 배치하고, 5화 간격으로 훅을 넣어 독자 이탈을 방지합니다.`,
  };
}

function loadResult(id:string): SavedResult|null {
  try { return JSON.parse(localStorage.getItem(`wts_phase3_${id}`)??'null'); } catch { return null; }
}
function saveResult(id:string, r:SavedResult) {
  localStorage.setItem(`wts_phase3_${id}`,JSON.stringify(r));
}

function TensionBar({ level }: { level: number }) {
  const colors = ["","#4ade80","#a3e635","#fbbf24","#f97316","#ef4444"];
  return (
    <div className={s.tensionBar}>
      {[1,2,3,4,5].map(n=>(
        <div key={n} className={s.tensionDot}
          style={{background: n<=level ? colors[level] : "#252535"}} />
      ))}
    </div>
  );
}

export default function Phase3Page({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const router = useRouter();

  const [runState,     setRunState]     = useState<RunState>("idle");
  const [agentStates,  setAgentStates]  = useState<AgentStatus[]>(["idle","idle","idle","idle"]);
  const [result,       setResult]       = useState<SavedResult|null>(null);
  const [isMock,       setIsMock]       = useState(false);
  const [expandedArc,  setExpandedArc]  = useState<number|null>(1);
  const [view,         setView]         = useState<"timeline"|"list">("timeline");
  const [genre,        setGenre]        = useState("판타지");
  const [title,        setTitle]        = useState("");

  useEffect(() => {
    const saved = loadResult(projectId);
    if (saved) { setResult(saved); setRunState("done"); setIsMock(saved.isMock); }
    try {
      const p1 = JSON.parse(localStorage.getItem(`wts_phase1_${projectId}`)??'null');
      if (p1?.input?.genre) setGenre(p1.input.genre);
      if (p1?.input?.title) setTitle(p1.input.title);
      const projs = JSON.parse(localStorage.getItem("wts_projects")??'[]');
      const p = projs.find((x:{id:string})=>x.id===projectId);
      if (p?.title) setTitle(p.title);
    } catch {}
  }, [projectId]);

  function setAgent(i:number, st:AgentStatus) {
    setAgentStates(prev=>prev.map((v,idx)=>idx===i?st:v));
  }

  async function runRoadmap() {
    setRunState("running"); setAgentStates(["idle","idle","idle","idle"]); setResult(null);
    const key = localStorage.getItem("wts_anthropic_key")??"";
    let useMock = !key;

    if (!useMock) {
      try {
        for (let i=0;i<4;i++) { setAgent(i,"running"); await delay(500+i*200); setAgent(i,"done"); }
        const res = await fetch(`${API_BASE}/api/phases/${projectId}/phase-3`,{
          method:"POST", headers:{"Content-Type":"application/json","X-Anthropic-Key":key},
          body:JSON.stringify({genre,title}), signal:AbortSignal.timeout(90000),
        });
        if (!res.ok) throw new Error();
        const json = await res.json();
        const saved:SavedResult = {data:json.data,gating_passed:true,isMock:false,savedAt:new Date().toISOString()};
        saveResult(projectId,saved); setResult(saved); setRunState("done"); return;
      } catch { useMock=true; setAgentStates(["idle","idle","idle","idle"]); }
    }

    setIsMock(true);
    for (let i=0;i<AGENTS.length;i++) { setAgent(i,"running"); await delay(800+i*300); setAgent(i,"done"); }
    const mockData = buildMock(genre,title);
    const saved:SavedResult = {data:mockData,gating_passed:true,isMock:true,savedAt:new Date().toISOString()};
    saveResult(projectId,saved); setResult(saved); setRunState("done");
  }

  return (
    <div className={s.page}>
      <h1 className={s.pageTitle}>Phase 3 — 100화 시리즈 로드맵</h1>
      <p className={s.pageDesc}>4막 구조 · 아크별 에피소드 배분 · 완급 타임라인을 AI가 자동 설계합니다.</p>

      {runState==="idle" && (
        <div className={s.startCard}>
          <div className={s.startIcon}>📋</div>
          <div className={s.startBody}>
            <div className={s.startTitle}>100화 로드맵 생성</div>
            <div className={s.startDesc}>4인의 AI 에이전트가 장르 트렌드 → 4막 구조 → 100화 타이틀·완급 배분을 자동 생성합니다.</div>
          </div>
          <button className={s.btnRun} onClick={runRoadmap}>✦ 로드맵 생성 시작</button>
        </div>
      )}

      {runState==="running" && (
        <div className={s.progress}>
          <div className={s.progressTitle}>에이전트 실행 중</div>
          <div className={s.agentSteps}>
            {AGENTS.map((agent,i)=>{
              const st = agentStates[i];
              return (
                <div key={agent.id} className={`${s.agentStep} ${st==="done"?s.stepDone:""} ${st==="running"?s.stepActive:""}`}>
                  <div className={s.agentStepIcon}>
                    {st==="done"?"✓":st==="running"?<div className={s.spinnerDot}><span/><span/><span/></div>:i+1}
                  </div>
                  <div className={s.agentStepBody}>
                    <div className={s.agentStepName}>
                      {agent.label}
                      {st==="running"&&<span className={s.runningLabel}>작업 중…</span>}
                    </div>
                    <div className={s.agentStepDesc}>{agent.desc}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {runState==="done" && result && (
        <>
          {isMock && (
            <div className={s.mockBadge}>
              ⚠ ANTHROPIC_API_KEY 미설정 — 미리보기(mock) 데이터입니다.&nbsp;
              <a href="/settings">설정에서 키 입력 →</a>
            </div>
          )}

          <div className={s.structureNote}>{result.data.structure_note}</div>

          <div className={s.arcGrid}>
            {result.data.arcs.map(arc=>(
              <div key={arc.num} className={s.arcCard} style={{borderTopColor:arc.color}}>
                <div className={s.arcLabel} style={{color:arc.color}}>막 {arc.num}</div>
                <div className={s.arcName}>{arc.name}</div>
                <div className={s.arcEps}>EP {arc.eps[0]}–{arc.eps[1]}</div>
                <div className={s.arcTheme}>{arc.theme}</div>
              </div>
            ))}
          </div>

          <div className={s.viewToggle}>
            <button className={`${s.viewBtn} ${view==="timeline"?s.viewBtnActive:""}`} onClick={()=>setView("timeline")}>타임라인</button>
            <button className={`${s.viewBtn} ${view==="list"?s.viewBtnActive:""}`} onClick={()=>setView("list")}>목록</button>
            <button className={s.btnRetry} onClick={()=>setRunState("idle")}>↺ 재생성</button>
          </div>

          {view==="timeline" && (
            <div className={s.timeline}>
              <div className={s.timelineLabels}>
                <span>1화</span><span>25화</span><span>50화</span><span>75화</span><span>100화</span>
              </div>
              <div className={s.timelineGrid}>
                {result.data.episodes.map(ep=>{
                  const arc = result.data.arcs[ep.arc-1];
                  const isPeak = ep.flags.includes("peak");
                  const isRev  = ep.flags.includes("reversal");
                  const isHook = ep.flags.includes("hook");
                  const alpha  = isPeak?"dd":isHook?"88":"33";
                  return (
                    <div key={ep.ep}
                      className={`${s.cell} ${isPeak?s.cellPeak:""} ${isRev&&!isPeak?s.cellReversal:""}`}
                      style={{background: arc.color+alpha}}
                      title={`${ep.ep}화 — ${ep.title}\n${ep.summary}`}
                    >
                      {isHook&&!isPeak&&<div className={s.hookDot}/>}
                    </div>
                  );
                })}
              </div>
              <div className={s.legend}>
                <div className={s.legItem}><div className={s.legPeakBar}/><span>정점(PEAK)</span></div>
                <div className={s.legItem}><div className={s.legRevStripe}/><span>반전</span></div>
                <div className={s.legItem}><div className={s.legHookDot}/><span>훅</span></div>
                {result.data.arcs.map(arc=>(
                  <div key={arc.num} className={s.legItem}>
                    <div className={s.legDot} style={{background:arc.color}}/>
                    <span>{arc.num}막 {arc.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {view==="list" && (
            <div className={s.arcList}>
              {result.data.arcs.map(arc=>(
                <div key={arc.num} className={s.arcSection}>
                  <button className={s.arcSectionHeader} onClick={()=>setExpandedArc(expandedArc===arc.num?null:arc.num)}>
                    <span className={s.arcDot} style={{background:arc.color}}/>
                    <span className={s.arcSectionTitle}>{arc.num}막 — {arc.name}</span>
                    <span className={s.arcRange}>EP {arc.eps[0]}–{arc.eps[1]}</span>
                    <span className={s.chevron}>{expandedArc===arc.num?"▲":"▼"}</span>
                  </button>
                  {expandedArc===arc.num && (
                    <div className={s.epList}>
                      {result.data.episodes.filter(e=>e.arc===arc.num).map(ep=>(
                        <div key={ep.ep} className={`${s.epRow} ${ep.flags.includes("peak")?s.epPeak:""}`}>
                          <span className={s.epNum}>{ep.ep}</span>
                          <span className={s.epTitle}>{ep.title}</span>
                          <TensionBar level={ep.tension}/>
                          <div className={s.epFlags}>
                            {ep.flags.includes("peak")     &&<span className={s.tagPeak}>PEAK</span>}
                            {ep.flags.includes("reversal") &&<span className={s.tagRev}>REV</span>}
                            {ep.flags.includes("hook")     &&<span className={s.tagHook}>HOOK</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className={s.gatingBanner}>
            <div className={s.gatingText}>
              <h3>✓ GATING 통과 — Phase 4 진행 가능</h3>
              <p>100화 로드맵 생성 완료 · 4막 구조 확정<br/>Phase 4에서 첫 화 30컷 대본을 작성합니다.</p>
            </div>
            <button className={s.btnGating} onClick={()=>router.push(`/projects/${projectId}/phase-4`)}>
              Phase 4 시작 →
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function delay(ms:number) { return new Promise(r=>setTimeout(r,ms)); }
