import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { authMiddleware } from "../middleware/auth.js";
import { collections } from "../services/firestore.js";
import { generateConceptImage } from "../services/whisk.js";
import { generateConceptImageNanoBanana } from "../services/nano-banana.js";

export const assetsRouter = Router();

// ─── 컨셉 이미지 생성 (Phase 2 스타일 정의 & 에셋 시각화) ─────────────────────
//
// 인증 없이 호출 가능 (Phase 2 프론트는 Firebase Auth 없이 동작).
// anthropicApiKey를 body로 받아 Claude 프롬프트 번역에 사용.
assetsRouter.post("/:projectId/generate-concept", async (req, res) => {
  const {
    description,
    style,
    type,
    anthropicApiKey,
    negativePrompt,
  } = req.body as {
    description: string;           // 한국어 설명
    style?: string;                // 확정된 스타일 토큰 (없으면 기본 웹툰 스타일)
    type: "character" | "location" | "style_test" | "prop" | "mastershot";
    anthropicApiKey?: string;      // 클라이언트에서 전달 (없으면 서버 env 사용)
    negativePrompt?: string;
  };

  if (!description) {
    res.status(400).json({ error: "description이 필요합니다" });
    return;
  }

  try {
    // 1. Claude로 한국어 설명 → 영문 이미지 생성 프롬프트 변환
    const apiKey = anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      res.status(400).json({ error: "Anthropic API 키가 필요합니다" });
      return;
    }

    const claude = new Anthropic({ apiKey });
    const baseStyle = style ??
      "Korean webtoon line art, clean bold outlines, flat color, cel-shading, vivid saturation, digital illustration";

    const typeGuide: Record<string, string> = {
      character:   "full body character design, front view, neutral pose, white background, character sheet",
      location:    "wide establishing shot, environment concept art, detailed background, cinematic composition",
      prop:        "product design view, isolated object, clean background, detailed item concept art",
      mastershot:  "cinematic master shot, dramatic composition, key visual, scene illustration",
      style_test:  "style test, mood board, visual tone reference",
    };

    const promptRes = await claude.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 300,
      system:
        "You are an expert at writing image generation prompts for webtoon and animation concept art. " +
        "Convert Korean descriptions into concise English image generation prompts. " +
        "Focus on visual details: appearance, colors, mood, composition. " +
        "Output only the prompt text, no explanations.",
      messages: [{
        role: "user",
        content:
          `Type: ${type}\n` +
          `Style prefix: ${baseStyle}\n` +
          `Type guidance: ${typeGuide[type] ?? ""}\n` +
          `Korean description:\n${description}\n\n` +
          `Write a detailed English image generation prompt that combines the style prefix, type guidance, and description. ` +
          `Keep it under 200 words.`,
      }],
    });

    const block = promptRes.content[0];
    const imagePrompt = block.type === "text" ? block.text.trim() : description;

    // 2. Whisk 호출 → 실패 시 Nano Banana 폴백
    let imageUrl: string;
    try {
      imageUrl = await generateConceptImage(imagePrompt, negativePrompt);
    } catch (whiskErr) {
      try {
        imageUrl = await generateConceptImageNanoBanana(imagePrompt, negativePrompt);
      } catch (nbErr) {
        throw new Error(
          `이미지 생성 실패: Whisk(${String(whiskErr)}), NanoBanana(${String(nbErr)})`
        );
      }
    }

    res.json({ imageUrl, prompt: imagePrompt });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─── A/B 디자인 선택 확정 ──────────────────────────────────────────────────────
assetsRouter.post("/:projectId/select", authMiddleware, async (req, res) => {
  try {
    const { assetId, assetType, selected } = req.body as {
      assetId: string;
      assetType: "characters" | "locations" | "props";
      selected: "A" | "B";
    };

    await collections
      .approvedAssets(req.params.projectId)
      .collection(assetType)
      .doc(assetId)
      .update({ selected_option: selected, locked: true });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "에셋 선택 저장 실패" });
  }
});

// ─── 승인된 에셋 목록 조회 ─────────────────────────────────────────────────────
assetsRouter.get("/:projectId", authMiddleware, async (req, res) => {
  try {
    const [chars, locs, props] = await Promise.all([
      collections.approvedAssets(req.params.projectId).collection("characters").get(),
      collections.approvedAssets(req.params.projectId).collection("locations").get(),
      collections.approvedAssets(req.params.projectId).collection("props").get(),
    ]);

    res.json({
      characters: chars.docs.map((d) => ({ id: d.id, ...d.data() })),
      locations:  locs.docs.map((d)  => ({ id: d.id, ...d.data() })),
      props:      props.docs.map((d)  => ({ id: d.id, ...d.data() })),
    });
  } catch (err) {
    res.status(500).json({ error: "에셋 조회 실패" });
  }
});
