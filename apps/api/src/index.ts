import express from "express";
import cors from "cors";
import { projectsRouter } from "./routes/projects.js";
import { phasesRouter } from "./routes/phases.js";
import { assetsRouter } from "./routes/assets.js";
import { scriptsRouter } from "./routes/scripts.js";
import { styleRouter } from "./routes/style.js";

const app = express();
const PORT = process.env.API_PORT ?? 4000;

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// API 키 연결 테스트
app.post("/api/test-key", async (req, res) => {
  const { service, key } = req.body as { service?: string; key?: string };

  if (!key || !service) {
    res.json({ ok: false, error: "service와 key가 필요합니다" });
    return;
  }

  if (service === "anthropic") {
    if (!key.startsWith("sk-ant-")) {
      res.json({ ok: false, error: "sk-ant- 로 시작해야 합니다" });
      return;
    }
    try {
      const r = await fetch("https://api.anthropic.com/v1/models", {
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
        signal: AbortSignal.timeout(6000),
      });
      if (r.ok) { res.json({ ok: true }); return; }
      if (r.status === 401) { res.json({ ok: false, error: "인증 실패 — 키를 확인해주세요" }); return; }
      res.json({ ok: false, error: `API 오류 (${r.status})` });
    } catch {
      res.json({ ok: false, error: "네트워크 오류 — Anthropic API 연결 실패" });
    }
    return;
  }

  if (service === "replicate") {
    if (!key.startsWith("r8_")) {
      res.json({ ok: false, error: "r8_ 로 시작해야 합니다" });
      return;
    }
    try {
      const r = await fetch("https://api.replicate.com/v1/account", {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(6000),
      });
      if (r.ok) { res.json({ ok: true }); return; }
      if (r.status === 401) { res.json({ ok: false, error: "인증 실패" }); return; }
      res.json({ ok: false, error: `API 오류 (${r.status})` });
    } catch {
      res.json({ ok: false, error: "네트워크 오류" });
    }
    return;
  }

  if (service === "whisk") {
    res.json({ ok: key.length > 8, note: "형식 확인만 가능합니다" });
    return;
  }

  res.json({ ok: false, error: "알 수 없는 서비스" });
});

app.use("/api/projects", projectsRouter);
app.use("/api/phases", phasesRouter);
app.use("/api/assets", assetsRouter);
app.use("/api/scripts", scriptsRouter);
app.use("/api/style", styleRouter);

app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});
