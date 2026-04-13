/**
 * Runway ML API — 텍스트→이미지 생성 서비스
 *
 * 모델: gen4_image (Runway Gen-4 Image)
 * 방식: 태스크 생성 → 폴링 → URL 반환
 *
 * API Reference: https://docs.runwayml.com
 */

const RUNWAY_API_BASE = "https://api.runwayml.com/v1";
const RUNWAY_VERSION  = "2024-11-06";

interface RunwayTaskResponse {
  id: string;
}

interface RunwayTaskStatus {
  id: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  output?: string[];     // SUCCEEDED 시 이미지 URL 배열
  failure?: string;      // FAILED 시 사유
  progress?: number;     // 0~1
}

function getRunwayHeaders(apiKey: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`,
    "X-Runway-Version": RUNWAY_VERSION,
  };
}

/**
 * 이미지 타입에 맞는 aspect ratio 반환
 * character/prop → 1:1 (캐릭터 시트)
 * location/mastershot → 16:9 (와이드 배경)
 * style_test → 4:3
 */
function getRatioForType(type: string): string {
  switch (type) {
    case "location":
    case "mastershot":
      return "1280:720";
    case "character":
    case "prop":
      return "720:720";
    default:
      return "1024:768";
  }
}

/**
 * 컨셉 이미지 생성 (Phase 2 에셋 시각화)
 * @param prompt   영문 이미지 생성 프롬프트
 * @param apiKey   Runway API 키 (없으면 env 사용)
 * @param type     에셋 타입 — aspect ratio 결정용
 * @returns 생성된 이미지 URL
 */
export async function generateConceptImageRunway(
  prompt: string,
  apiKey?: string,
  type: string = "style_test",
): Promise<string> {
  const key = apiKey ?? process.env.RUNWAY_API_KEY;
  if (!key) throw new Error("RUNWAY_API_KEY not configured");

  const ratio = getRatioForType(type);

  // 1. 태스크 생성
  const createRes = await fetch(`${RUNWAY_API_BASE}/text_to_image`, {
    method: "POST",
    headers: getRunwayHeaders(key),
    body: JSON.stringify({
      model: "gen4_image",
      promptText: prompt,
      ratio,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!createRes.ok) {
    const errBody = await createRes.text();
    throw new Error(`Runway create error ${createRes.status}: ${errBody.slice(0, 200)}`);
  }

  const taskData = await createRes.json() as RunwayTaskResponse;
  const taskId = taskData.id;
  if (!taskId) throw new Error("Runway: no task id returned");

  // 2. 폴링 — 최대 120초 (2초 간격 × 60회)
  for (let i = 0; i < 60; i++) {
    await new Promise<void>((r) => setTimeout(r, 2000));

    const pollRes = await fetch(`${RUNWAY_API_BASE}/tasks/${taskId}`, {
      headers: getRunwayHeaders(key),
      signal: AbortSignal.timeout(8000),
    });

    if (!pollRes.ok) continue;

    const status = await pollRes.json() as RunwayTaskStatus;

    if (status.status === "SUCCEEDED") {
      const url = status.output?.[0];
      if (!url) throw new Error("Runway: task succeeded but no output URL");
      return url;
    }

    if (status.status === "FAILED" || status.status === "CANCELLED") {
      throw new Error(`Runway task ${status.status}: ${status.failure ?? "unknown reason"}`);
    }
    // PENDING / RUNNING — 계속 폴링
  }

  throw new Error("Runway image generation timed out (120s)");
}
