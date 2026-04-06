import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { collections } from "../services/firestore.js";

export const scriptsRouter = Router();

// 화별 대본 조회
scriptsRouter.get("/:projectId/episodes/:episode", authMiddleware, async (req, res) => {
  try {
    const epId = `ep_${String(req.params.episode).padStart(3, "0")}`;
    const cuts = await collections
      .scripts(req.params.projectId)
      .collection("episodes")
      .doc(epId)
      .collection("cuts")
      .orderBy("cut")
      .get();

    res.json({
      episode: Number(req.params.episode),
      cuts: cuts.docs.map((d) => ({ id: d.id, ...d.data() })),
    });
  } catch (err) {
    res.status(500).json({ error: "대본 조회 실패" });
  }
});

// 컷 수동 편집
scriptsRouter.put("/:projectId/episodes/:episode/cuts/:cut", authMiddleware, async (req, res) => {
  try {
    const epId = `ep_${String(req.params.episode).padStart(3, "0")}`;
    const cutId = `cut_${String(req.params.cut).padStart(2, "0")}`;

    await collections
      .scripts(req.params.projectId)
      .collection("episodes")
      .doc(epId)
      .collection("cuts")
      .doc(cutId)
      .update(req.body);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "컷 편집 실패" });
  }
});
