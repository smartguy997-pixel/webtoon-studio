import express from "express";
import cors from "cors";
import { projectsRouter } from "./routes/projects.js";
import { phasesRouter } from "./routes/phases.js";
import { assetsRouter } from "./routes/assets.js";
import { scriptsRouter } from "./routes/scripts.js";

const app = express();
const PORT = process.env.API_PORT ?? 4000;

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api/projects", projectsRouter);
app.use("/api/phases", phasesRouter);
app.use("/api/assets", assetsRouter);
app.use("/api/scripts", scriptsRouter);

app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});
