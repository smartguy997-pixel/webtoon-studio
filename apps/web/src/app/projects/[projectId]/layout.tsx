import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  params: { projectId: string };
}

// TODO: 프로젝트 사이드바 + Phase 진행 상태 네비게이션 레이아웃
export default function ProjectLayout({ children }: Props) {
  return <div className="project-layout">{children}</div>;
}
