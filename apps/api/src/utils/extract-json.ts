/**
 * 에이전트 응답에서 JSON을 추출하는 유틸리티
 *
 * 다음 형태를 모두 처리한다:
 * 1. 순수 JSON
 * 2. ```json ... ``` 코드 블록
 * 3. ``` ... ``` 코드 블록
 * 4. 텍스트 중간에 삽입된 JSON 오브젝트
 */

export class JsonExtractionError extends Error {
  constructor(
    message: string,
    public readonly raw: string
  ) {
    super(message);
    this.name = "JsonExtractionError";
  }
}

/**
 * 응답 문자열에서 첫 번째 유효한 JSON 오브젝트를 추출한다.
 */
export function extractJson<T = unknown>(raw: string): T {
  const trimmed = raw.trim();

  // 1. ```json ... ``` 코드 블록
  const jsonBlock = trimmed.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonBlock) {
    return parseOrThrow<T>(jsonBlock[1], raw);
  }

  // 2. ``` ... ``` 코드 블록
  const codeBlock = trimmed.match(/```\s*([\s\S]*?)\s*```/);
  if (codeBlock) {
    return parseOrThrow<T>(codeBlock[1], raw);
  }

  // 3. 순수 JSON (전체가 { 또는 [ 로 시작)
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseOrThrow<T>(trimmed, raw);
  }

  // 4. 텍스트 안에 삽입된 JSON 오브젝트 (첫 { 부터 대응하는 } 까지)
  const jsonStart = trimmed.indexOf("{");
  if (jsonStart !== -1) {
    const candidate = extractBalancedBraces(trimmed, jsonStart);
    if (candidate) {
      return parseOrThrow<T>(candidate, raw);
    }
  }

  throw new JsonExtractionError("응답에서 JSON을 찾을 수 없습니다.", raw);
}

function parseOrThrow<T>(text: string, raw: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new JsonExtractionError(`JSON 파싱 실패: ${text.slice(0, 200)}`, raw);
  }
}

/**
 * 중첩된 중괄호를 추적해 균형 잡힌 JSON 오브젝트를 추출한다.
 */
function extractBalancedBraces(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
