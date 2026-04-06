import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const isEmulator =
  process.env.FIRESTORE_EMULATOR_HOST !== undefined ||
  (!process.env.FIREBASE_PROJECT_ID &&
    !process.env.FIREBASE_PRIVATE_KEY &&
    !process.env.FIREBASE_CLIENT_EMAIL);

if (getApps().length === 0) {
  if (isEmulator) {
    // 개발 환경: Firebase Emulator 사용
    // FIRESTORE_EMULATOR_HOST 환경변수가 자동으로 에뮬레이터로 라우팅
    initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || "webtoon-studio-dev" });
  } else {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      }),
    });
  }
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
