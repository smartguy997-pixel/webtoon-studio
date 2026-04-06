/**
 * 토큰 카운터 유틸리티
 * Anthropic API 응답에서 토큰 사용량을 추적
 */
export class TokenCounter {
  private totalInputTokens = 0;
  private totalOutputTokens = 0;

  add(inputTokens: number, outputTokens: number): void {
    this.totalInputTokens += inputTokens;
    this.totalOutputTokens += outputTokens;
  }

  getTotal(): { input: number; output: number; total: number } {
    return {
      input: this.totalInputTokens,
      output: this.totalOutputTokens,
      total: this.totalInputTokens + this.totalOutputTokens,
    };
  }

  reset(): void {
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
  }
}
