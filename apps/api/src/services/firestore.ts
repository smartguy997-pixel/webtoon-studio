import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (getApps().length === 0) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    }),
  });
}

export const db = getFirestore();

// ─── 컬렉션 헬퍼 ───────────────────────────────────────────────

export const collections = {
  projects: () => db.collection("projects"),
  projectSummary: (projectId: string) =>
    db.collection("project_summary").doc(projectId),
  approvedAssets: (projectId: string) =>
    db.collection("approved_assets").doc(projectId),
  styleRegistry: (projectId: string) =>
    db.collection("style_registry").doc(projectId),
  seriesRoadmap: (projectId: string) =>
    db.collection("series_roadmap").doc(projectId),
  scripts: (projectId: string) => db.collection("scripts").doc(projectId),
};
