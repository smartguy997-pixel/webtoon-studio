export type ProjectStatus =
  | "draft"
  | "phase_1"
  | "phase_2"
  | "phase_3"
  | "phase_4"
  | "phase_5"
  | "completed";

export type Platform = "naver" | "kakao" | "lezhin" | "other";

export interface Project {
  project_id: string;
  title: string;
  owner_uid: string;
  status: ProjectStatus;
  current_phase: 1 | 2 | 3 | 4 | 5;
  genre: string;
  platform: Platform;
  total_episodes: number;
  completed_episodes: number;
  created_at: string;
  updated_at: string;
}
