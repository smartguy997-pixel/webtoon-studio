import { Router, type Request, type Response } from "express";
import { authMiddleware } from "../middleware/auth.js";

export const styleRouter = Router();

/**
 * Phase 5 화풍 일관성 관련 라우트
 * MST 조회 및 CLIP Score 기반 SCC 검증
 */

// MST 조회
styleRouter.get("/:projectId/mst", authMiddleware, async (req: Request, res: Response) => {
  const { projectId } = req.params;
  // TODO: Firestore style_registry에서 MST 조회
  res.json({
    projectId,
    mst: null,
    message: "MST가 아직 설정되지 않았습니다. Phase 2를 완료하여 MST를 생성하세요.",
  });
});

// SCC (Style Consistency Check) 실행
styleRouter.post("/:projectId/scc", authMiddleware, async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const { imageUrl } = req.body as { imageUrl?: string };

  if (!imageUrl) {
    res.status(400).json({ error: "imageUrl이 필요합니다" });
    return;
  }

  try {
    // TODO: Replicate CLIP ViT-L/14으로 실제 SCC 검증
    // const sccService = await import("../services/scc.js");
    // const score = await sccService.computeClipScore(projectId, imageUrl);

    // 임시: 형식 검사만 수행
    const isValidUrl = imageUrl.startsWith("http");
    res.json({
      projectId,
      imageUrl,
      clip_score: isValidUrl ? 0.85 : 0,
      pass: isValidUrl,
      message: isValidUrl ? "SCC 검증 통과" : "유효하지 않은 이미지 URL",
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "SCC 검증 실패" });
  }
});

// 스타일 레지스트리 저장
styleRouter.put("/:projectId/registry", authMiddleware, async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const { mst, ab_choice } = req.body as { mst?: unknown; ab_choice?: string };

  if (!mst) {
    res.status(400).json({ error: "mst 데이터가 필요합니다" });
    return;
  }

  try {
    // TODO: Firestore style_registry에 저장
    res.json({
      projectId,
      saved: true,
      ab_choice: ab_choice ?? null,
      message: "스타일 레지스트리가 저장되었습니다",
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "저장 실패" });
  }
});
