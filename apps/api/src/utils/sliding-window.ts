import { collections } from "../services/firestore.js";

const WINDOW_SIZE = 10;

/**
 * 슬라이딩 윈도우 토큰 관리
 * 대화 10회 도달 시 총괄 프로듀서가 요약을 생성하고 Firestore에 저장
 */
export class SlidingWindow {
  private conversationCount = 0;

  increment(): boolean {
    this.conversationCount++;
    return this.conversationCount % WINDOW_SIZE === 0;
  }

  shouldCompress(): boolean {
    return this.conversationCount > 0 && this.conversationCount % WINDOW_SIZE === 0;
  }
}

/**
 * 슬라이딩 윈도우 요약을 Firestore에 저장
 */
export async function saveSlidingWindowSummary(
  projectId: string,
  phase: number,
  summary: {
    genre?: string;
    usp?: string[];
    feasibility_score?: number;
    key_decisions?: string[];
    approved_asset_ids?: { characters: string[]; locations: string[]; props: string[] };
    next_phase_ready?: boolean;
  }
): Promise<void> {
  const version = await getNextSummaryVersion(projectId, phase);
  await collections
    .projectSummary(projectId)
    .collection(`phase_${phase}`)
    .doc(`v${version}`)
    .set({
      summary_version: version,
      phase,
      ...summary,
      created_at: new Date(),
    });
}

async function getNextSummaryVersion(projectId: string, phase: number): Promise<number> {
  const snap = await collections
    .projectSummary(projectId)
    .collection(`phase_${phase}`)
    .orderBy("summary_version", "desc")
    .limit(1)
    .get();

  return snap.empty ? 1 : (snap.docs[0].data().summary_version as number) + 1;
}
