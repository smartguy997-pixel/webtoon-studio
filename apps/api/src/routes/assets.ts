import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { collections } from "../services/firestore.js";

export const assetsRouter = Router();

// A/B 디자인 선택 확정
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

// 승인된 에셋 목록 조회
assetsRouter.get("/:projectId", authMiddleware, async (req, res) => {
  try {
    const [chars, locs, props] = await Promise.all([
      collections.approvedAssets(req.params.projectId).collection("characters").get(),
      collections.approvedAssets(req.params.projectId).collection("locations").get(),
      collections.approvedAssets(req.params.projectId).collection("props").get(),
    ]);

    res.json({
      characters: chars.docs.map((d) => ({ id: d.id, ...d.data() })),
      locations: locs.docs.map((d) => ({ id: d.id, ...d.data() })),
      props: props.docs.map((d) => ({ id: d.id, ...d.data() })),
    });
  } catch (err) {
    res.status(500).json({ error: "에셋 조회 실패" });
  }
});
