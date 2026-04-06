import type { AssetList, DesignOption } from "./asset.js";

export type PhaseType =
  | "기획 분석"
  | "세계관_에셋_설계"
  | "100화_로드맵"
  | "30컷_대본";

// ─── Phase 1 ─────────────────────────────────────────────────

export interface Competitor {
  title: string;
  strength: string;
  weakness: string;
  our_edge: string;
}

export interface MarketAnalysis {
  genre: string;
  positioning: string;
  trend_keywords: string[];
  competitors: Competitor[];
}

export interface Phase1Output {
  phase: "기획 분석";
  summary: string;
  market_analysis: MarketAnalysis;
  usp: string[];
  feasibility_score: number;
  agent_notes: {
    strategist: string;
    researcher: string;
    producer: string;
  };
  asset_list: AssetList;
  revision_history: RevisionEntry[];
}

// ─── Phase 2 ─────────────────────────────────────────────────

export interface WorldDesign {
  physical_env: {
    era: string;
    geography: string;
    climate: string;
  };
  social_system: {
    power_structure: string;
    class_system: string;
    economy: string;
  };
  unique_rules: Array<{
    rule_name: string;
    description: string;
    limitation: string;
  }>;
  information_asymmetry: {
    reader_knows: string[];
    character_knows: string[];
  };
}

export interface Phase2Output {
  phase: "세계관_에셋_설계";
  summary: string;
  world_design: WorldDesign;
  asset_list: AssetList;
  design_options: DesignOption[];
  approved_assets: string[];
  agent_notes: {
    worldbuilder: string;
    researcher: string;
    character_designer: string;
    producer: string;
  };
  revision_history: RevisionEntry[];
}

// ─── Phase 3 ─────────────────────────────────────────────────

export type EpisodeType = "normal" | "hook" | "peak" | "twist" | "fanservice" | "info";
export type ArcType = "small" | "medium" | "large";

export interface Arc {
  arc_id: string;
  arc_type: ArcType;
  title: string;
  episode_range: [number, number];
  theme: string;
  resolution: string;
}

export interface Episode {
  ep: number;
  title: string;
  summary: string;
  arc_id: string;
  episode_type: EpisodeType;
  featured_characters: string[];
  featured_locations: string[];
  cliffhanger: string | null;
}

export interface Phase3Output {
  phase: "100화_로드맵";
  summary: string;
  arc_structure: {
    act_1: { range: [1, 15]; theme: string; key_events: string[] };
    act_2: { range: [16, 55]; theme: string; key_events: string[] };
    act_3: { range: [56, 80]; theme: string; key_events: string[] };
    act_4: { range: [81, 100]; theme: string; key_events: string[] };
  };
  arcs: Arc[];
  episodes: Episode[];
  pacing_plan: {
    hook_episodes: number[];
    peak_episodes: number[];
    twist_episodes: number[];
    estimated_weekly_schedule: string;
  };
  agent_notes: {
    scenario_writer: string;
    producer: string;
  };
  revision_history: RevisionEntry[];
}

// ─── Phase 4 ─────────────────────────────────────────────────

export type CameraAngle = "ELS" | "LS" | "MS" | "MCU" | "CU" | "ECU" | "OTS" | "POV" | "BIRD" | "WORM" | "DUTCH";
export type AspectRatio = "1:1" | "1:1.5" | "1:2" | "1:3";
export type BackgroundVariant = "day_clear" | "day_cloudy" | "evening" | "night" | "rain" | "snow";
export type BalloonType = "normal" | "shout" | "whisper" | "thought" | "narration";
export type Expression = "기쁨" | "분노" | "슬픔" | "놀람" | "무표정" | "긴장";
export type Effect = "none" | "speed_lines" | "impact_lines" | "glow" | "blur";
export type ChapterStyle = "default" | "flashback" | "dream" | "climax" | "epilogue";

export interface ScriptCut {
  cut: number;
  angle: CameraAngle;
  aspect_ratio: AspectRatio;
  scene_description: string;
  characters: Array<{
    char_id: string;
    position: "left" | "center" | "right" | "background";
    expression: Expression;
    pose: string;
  }>;
  location_id: string;
  background_variant: BackgroundVariant;
  dialogue: Array<{
    char_id: string;
    text: string;
    balloon_type: BalloonType;
  }>;
  sfx: string[];
  effect: Effect;
  image_prompt: {
    auto_injected_mst: string;
    cut_specific_tags: string;
    negative_prompt: string;
  };
  director_note: string;
}

export interface Phase4Output {
  phase: "30컷_대본";
  episode: number;
  episode_title: string;
  chapter_style: ChapterStyle;
  script_data: ScriptCut[]; // 정확히 30개
  episode_summary_for_next: string;
  assets_used: {
    characters: string[];
    locations: string[];
    props: string[];
  };
  agent_notes: {
    script_writer: string;
    producer: string;
  };
  revision_history: RevisionEntry[];
}

// ─── 공통 ────────────────────────────────────────────────────

export interface RevisionEntry {
  version: number;
  changed_by: string;
  changed_at: string;
  description: string;
  prev_value: unknown;
}
