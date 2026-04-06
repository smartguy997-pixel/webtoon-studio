import { describe, it, expect } from "vitest";
import { detectChapterStyle } from "../../src/agents/script.js";

describe("detectChapterStyle", () => {
  it("returns climax for peak episode type", () => {
    expect(detectChapterStyle("peak", "주인공과 최종 보스의 결전")).toBe("climax");
  });

  it("returns epilogue for fanservice episode type", () => {
    expect(detectChapterStyle("fanservice", "캐릭터 일상 에피소드")).toBe("epilogue");
  });

  it("detects flashback from summary keywords", () => {
    expect(detectChapterStyle("normal", "주인공의 어린 시절 회상 장면")).toBe("flashback");
    expect(detectChapterStyle("normal", "과거의 기억이 떠오른다")).toBe("flashback");
  });

  it("detects dream from summary keywords", () => {
    expect(detectChapterStyle("normal", "꿈 속에서 이상한 세계를 본다")).toBe("dream");
    expect(detectChapterStyle("normal", "환상 속에 나타난 존재")).toBe("dream");
  });

  it("returns default for normal episode with no special keywords", () => {
    expect(detectChapterStyle("normal", "일반적인 학교 생활 묘사")).toBe("default");
    expect(detectChapterStyle("hook", "반전이 있는 훅 에피소드")).toBe("default");
    expect(detectChapterStyle("twist", "세계관 반전 에피소드")).toBe("default");
  });

  it("prioritizes episode_type over summary keywords", () => {
    // peak takes priority even if summary has no "peak" keyword
    expect(detectChapterStyle("peak", "일반적인 장면")).toBe("climax");
    // fanservice takes priority even with dream keywords
    expect(detectChapterStyle("fanservice", "꿈 속 팬서비스")).toBe("epilogue");
  });
});
