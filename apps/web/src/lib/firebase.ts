import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

function resolveConfig() {
  // 1) 환경변수 우선
  const envApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const envProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (envApiKey && envProjectId) {
    return {
      apiKey: envApiKey,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: envProjectId,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    };
  }

  // 2) 클라이언트 localStorage 폴백 (설정 페이지에서 입력)
  if (typeof window !== "undefined") {
    const lsApiKey = localStorage.getItem("wts_firebase_api_key");
    const lsProjectId = localStorage.getItem("wts_firebase_project_id");
    if (lsApiKey && lsProjectId) {
      return {
        apiKey: lsApiKey,
        authDomain:
          localStorage.getItem("wts_firebase_auth_domain") ??
          `${lsProjectId}.firebaseapp.com`,
        projectId: lsProjectId,
        storageBucket:
          localStorage.getItem("wts_firebase_storage_bucket") ??
          `${lsProjectId}.appspot.com`,
        messagingSenderId:
          localStorage.getItem("wts_firebase_messaging_sender_id") ?? "",
        appId: localStorage.getItem("wts_firebase_app_id") ?? "",
      };
    }
  }

  return { apiKey: undefined, projectId: undefined };
}

const firebaseConfig = resolveConfig();

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

try {
  if (firebaseConfig.apiKey && firebaseConfig.projectId) {
    app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
    auth = getAuth(app);
    db = getFirestore(app);
  }
} catch (e) {
  // Firebase not configured — app runs in localStorage-only mode
  console.warn("[firebase] init skipped:", e instanceof Error ? e.message : e);
}

export { app, auth, db };
