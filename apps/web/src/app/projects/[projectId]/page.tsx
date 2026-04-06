"use client";

interface Props {
  params: { projectId: string };
}

// TODO: 프로젝트 대시보드 — 현재 Phase 진행 상태 요약
export default function ProjectPage({ params }: Props) {
  return (
    <main>
      <h1>프로젝트 {params.projectId}</h1>
    </main>
  );
}
