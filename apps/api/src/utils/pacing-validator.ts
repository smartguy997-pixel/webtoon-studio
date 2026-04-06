import type { Episode, Arc } from "../agents/scenario.js";

// ─── 검증 결과 타입 ────────────────────────────────────────────

export interface PacingValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ─── 완급 조절 규칙 검증 ───────────────────────────────────────

/**
 * 100화 에피소드 목록에 대해 완급 조절 규칙을 검증한다.
 *
 * 필수 규칙:
 * - ep 20, 40, 60, 80 은 반드시 `peak`
 * - 1막(1~15화) 안에 `twist` 금지
 * - 연속된 두 `twist` 사이 간격 ≥ 30화
 *
 * 경고 규칙:
 * - `hook`이 3화 연속 이상 있는 구간
 * - ep 1~100이 빠짐없이 존재하는지
 */
export function validatePacingRules(
  episodes: Episode[],
  arcs: Arc[]
): PacingValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ep → episode 맵
  const epMap = new Map<number, Episode>();
  for (const ep of episodes) {
    epMap.set(ep.ep, ep);
  }

  // ── 1. ep 1~100 완전성 확인 ─────────────────────────────────
  const missing: number[] = [];
  const duplicate: number[] = [];
  const seen = new Set<number>();
  for (const ep of episodes) {
    if (seen.has(ep.ep)) duplicate.push(ep.ep);
    seen.add(ep.ep);
  }
  for (let i = 1; i <= 100; i++) {
    if (!epMap.has(i)) missing.push(i);
  }
  if (missing.length > 0) {
    errors.push(`누락된 화: ${missing.join(", ")}`);
  }
  if (duplicate.length > 0) {
    errors.push(`중복 화 번호: ${duplicate.join(", ")}`);
  }

  // ── 2. 필수 peak 위치 (20, 40, 60, 80) ─────────────────────
  for (const peakEp of [20, 40, 60, 80]) {
    const ep = epMap.get(peakEp);
    if (!ep) continue; // 누락은 위에서 이미 오류 처리
    if (ep.episode_type !== "peak") {
      errors.push(`${peakEp}화는 episode_type이 'peak'여야 합니다 (현재: '${ep.episode_type}')`);
    }
  }

  // ── 3. 1막(1~15화) 내 twist 금지 ────────────────────────────
  for (let i = 1; i <= 15; i++) {
    const ep = epMap.get(i);
    if (ep?.episode_type === "twist") {
      errors.push(`${i}화: 1막(1~15화) 내 반전 화(twist)는 허용되지 않습니다`);
    }
  }

  // ── 4. 연속 두 twist 사이 간격 ≥ 30 ────────────────────────
  const twistEps = episodes
    .filter((e) => e.episode_type === "twist")
    .map((e) => e.ep)
    .sort((a, b) => a - b);

  for (let i = 1; i < twistEps.length; i++) {
    const gap = twistEps[i] - twistEps[i - 1];
    if (gap < 30) {
      errors.push(
        `반전 화 간격 부족: ${twistEps[i - 1]}화 → ${twistEps[i]}화 (간격 ${gap}화, 최소 30화 필요)`
      );
    }
  }

  // ── 5. hook 3화 연속 이상 경고 ──────────────────────────────
  let hookStreak = 0;
  let hookStreakStart = 0;
  for (let i = 1; i <= 100; i++) {
    const ep = epMap.get(i);
    if (ep?.episode_type === "hook") {
      if (hookStreak === 0) hookStreakStart = i;
      hookStreak++;
    } else {
      if (hookStreak >= 3) {
        warnings.push(
          `${hookStreakStart}~${i - 1}화: hook이 ${hookStreak}화 연속 배치됨 (독자 피로도 주의)`
        );
      }
      hookStreak = 0;
    }
  }
  if (hookStreak >= 3) {
    warnings.push(
      `${hookStreakStart}~100화: hook이 ${hookStreak}화 연속 배치됨 (독자 피로도 주의)`
    );
  }

  // ── 6. arc_id 참조 일관성 확인 ─────────────────────────────
  const arcIds = new Set(arcs.map((a) => a.arc_id));
  const invalidArcRefs: string[] = [];
  for (const ep of episodes) {
    if (ep.arc_id && !arcIds.has(ep.arc_id)) {
      invalidArcRefs.push(`ep${ep.ep}(${ep.arc_id})`);
    }
  }
  if (invalidArcRefs.length > 0) {
    errors.push(`존재하지 않는 arc_id 참조: ${invalidArcRefs.join(", ")}`);
  }

  // ── 7. 소아크 마지막 화는 hook 이어야 함 (경고) ────────────
  const smallArcs = arcs.filter((a) => a.arc_type === "small");
  for (const arc of smallArcs) {
    const lastEpNum = arc.episode_range[1];
    const lastEp = epMap.get(lastEpNum);
    if (lastEp && lastEp.episode_type !== "hook" && lastEp.episode_type !== "peak") {
      warnings.push(
        `소아크 '${arc.arc_id}' 마지막 화(${lastEpNum}화)의 episode_type이 'hook'이 아닙니다 (현재: '${lastEp.episode_type}')`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * 에피소드 1~100 완전 커버리지 확인 (GATING 조건 1).
 */
export function checkEpisodeCoverage(episodes: Episode[]): {
  covered: boolean;
  missing: number[];
  total: number;
} {
  const epNums = new Set(episodes.map((e) => e.ep));
  const missing: number[] = [];
  for (let i = 1; i <= 100; i++) {
    if (!epNums.has(i)) missing.push(i);
  }
  return {
    covered: missing.length === 0,
    missing,
    total: episodes.length,
  };
}
