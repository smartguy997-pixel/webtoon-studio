import { Router } from "express";
import { FieldValue } from "firebase-admin/firestore";
import { collections } from "../services/firestore.js";
import { authMiddleware } from "../middleware/auth.js";

export const projectsRouter = Router();

// 프로젝트 목록 조회
projectsRouter.get("/", authMiddleware, async (req, res) => {
  try {
    const uid = (req as typeof req & { uid: string }).uid;
    const snap = await collections.projects().where("owner_uid", "==", uid).get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (err) {
    res.status(500).json({ error: "프로젝트 목록 조회 실패" });
  }
});

// 프로젝트 생성
projectsRouter.post("/", authMiddleware, async (req, res) => {
  try {
    const uid = (req as typeof req & { uid: string }).uid;
    const { title, genre, platform } = req.body as {
      title: string;
      genre: string;
      platform: string;
    };

    const ref = await collections.projects().add({
      title,
      genre,
      platform: platform ?? "other",
      owner_uid: uid,
      status: "phase_1",
      current_phase: 1,
      total_episodes: 100,
      completed_episodes: 0,
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });

    res.status(201).json({ id: ref.id });
  } catch (err) {
    res.status(500).json({ error: "프로젝트 생성 실패" });
  }
});

// 프로젝트 조회
projectsRouter.get("/:projectId", authMiddleware, async (req, res) => {
  try {
    const snap = await collections.projects().doc(req.params.projectId).get();
    if (!snap.exists) {
      res.status(404).json({ error: "프로젝트를 찾을 수 없습니다" });
      return;
    }
    res.json({ id: snap.id, ...snap.data() });
  } catch (err) {
    res.status(500).json({ error: "프로젝트 조회 실패" });
  }
});
