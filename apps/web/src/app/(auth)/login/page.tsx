"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type Tab = "google" | "email";
type Mode = "signin" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("google");
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [firebaseReady, setFirebaseReady] = useState<boolean | null>(null); // null = checking

  // Check if Firebase is configured (env vars OR localStorage fallback)
  useEffect(() => {
    const hasEnv = !!(
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY &&
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
    );
    const hasLS = !!(
      localStorage.getItem("wts_firebase_api_key") &&
      localStorage.getItem("wts_firebase_project_id")
    );
    setFirebaseReady(hasEnv || hasLS);
  }, []);

  async function handleGoogle() {
    setBusy(true);
    setError("");
    try {
      const { GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
      const { auth } = await import("@/lib/firebase");
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      router.push("/projects");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Google 로그인 실패");
    } finally {
      setBusy(false);
    }
  }

  async function handleEmail(e: { preventDefault: () => void }) {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setBusy(true);
    setError("");
    try {
      if (mode === "signup") {
        const { createUserWithEmailAndPassword } = await import("firebase/auth");
        const { auth } = await import("@/lib/firebase");
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      } else {
        const { signInWithEmailAndPassword } = await import("firebase/auth");
        const { auth } = await import("@/lib/firebase");
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
      router.push("/projects");
    } catch (e) {
      const code = (e as { code?: string }).code ?? "";
      if (code === "auth/user-not-found" || code === "auth/wrong-password" || code === "auth/invalid-credential") {
        setError("이메일 또는 비밀번호가 올바르지 않습니다.");
      } else if (code === "auth/email-already-in-use") {
        setError("이미 사용 중인 이메일입니다. 로그인을 시도해주세요.");
      } else if (code === "auth/weak-password") {
        setError("비밀번호는 6자 이상이어야 합니다.");
      } else {
        setError(e instanceof Error ? e.message : "로그인 실패");
      }
    } finally {
      setBusy(false);
    }
  }

  function handleLocalMode() {
    // Skip auth — use localStorage-based local mode
    localStorage.setItem("wts_local_mode", "true");
    router.push("/projects");
  }

  return (
    <div style={{
      minHeight: "100vh", background: "#0d0d14",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      padding: "20px",
    }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16,
            background: "linear-gradient(135deg, #7c6cfc, #a78bfa)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 28, margin: "0 auto 16px",
          }}>
            ✦
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#f1f5f9", letterSpacing: "-0.5px", margin: 0 }}>
            AI Webtoon Studio
          </h1>
          <p style={{ fontSize: 14, color: "#64748b", marginTop: 6 }}>
            7인의 AI 에이전트와 함께 웹툰을 제작하세요
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: "#16161f", border: "1px solid #2a2a3d",
          borderRadius: 20, padding: "32px 28px",
        }}>
          {firebaseReady === null ? (
            <div style={{ textAlign: "center", color: "#64748b", fontSize: 14 }}>로딩 중...</div>
          ) : !firebaseReady ? (
            /* Firebase not configured — local mode only */
            <div>
              <div style={{
                background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)",
                borderRadius: 10, padding: "12px 16px", marginBottom: 24, fontSize: 13, color: "#fbbf24",
              }}>
                ⚠ Firebase가 설정되지 않았습니다. 로컬 모드로 사용합니다.
              </div>
              <button onClick={handleLocalMode} style={btnPrimaryStyle}>
                ✦ 로컬 모드로 시작
              </button>
              <p style={{ fontSize: 12, color: "#64748b", marginTop: 14, textAlign: "center", lineHeight: 1.6 }}>
                프로젝트 데이터가 브라우저에만 저장됩니다.<br />
                Firebase 설정 방법은 <code style={{ color: "#a78bfa" }}>docs/firebase.md</code>를 참조하세요.
              </p>
            </div>
          ) : (
            /* Firebase configured */
            <>
              {/* Tab: Google / Email */}
              <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
                {(["google", "email"] as Tab[]).map(t => (
                  <button key={t} onClick={() => { setTab(t); setError(""); }} style={{
                    flex: 1, padding: "8px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer",
                    background: tab === t ? "rgba(124,108,252,0.15)" : "transparent",
                    border: tab === t ? "1px solid rgba(124,108,252,0.5)" : "1px solid #2a2a3d",
                    color: tab === t ? "#a78bfa" : "#64748b",
                    transition: "all 0.15s",
                  }}>
                    {t === "google" ? "🔑 Google" : "✉ 이메일"}
                  </button>
                ))}
              </div>

              {error && (
                <div style={{
                  background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)",
                  borderRadius: 10, padding: "10px 14px", marginBottom: 18, fontSize: 13, color: "#f87171",
                }}>
                  ⚠ {error}
                </div>
              )}

              {tab === "google" ? (
                <div>
                  <button onClick={handleGoogle} disabled={busy} style={{
                    ...btnPrimaryStyle,
                    background: busy ? "#1e1e2a" : "white",
                    color: "#1a1a2e",
                    border: "1px solid #e2e8f0",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                    opacity: busy ? 0.7 : 1,
                  }}>
                    {busy ? "연결 중..." : (
                      <>
                        <svg width="18" height="18" viewBox="0 0 24 24">
                          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                        </svg>
                        Google로 계속하기
                      </>
                    )}
                  </button>
                </div>
              ) : (
                <form onSubmit={handleEmail}>
                  {/* Mode toggle */}
                  <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "#0d0d14", borderRadius: 10, padding: 4 }}>
                    {(["signin", "signup"] as Mode[]).map(m => (
                      <button key={m} type="button" onClick={() => { setMode(m); setError(""); }} style={{
                        flex: 1, padding: "6px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                        background: mode === m ? "#1e1e2a" : "transparent",
                        border: "none", color: mode === m ? "#f1f5f9" : "#64748b",
                      }}>
                        {m === "signin" ? "로그인" : "회원가입"}
                      </button>
                    ))}
                  </div>

                  <div style={{ marginBottom: 14 }}>
                    <label style={labelStyle}>이메일</label>
                    <input type="email" required value={email} onChange={(e: { target: HTMLInputElement }) => setEmail(e.target.value)}
                      placeholder="your@email.com" style={inputStyle} autoComplete="email" />
                  </div>
                  <div style={{ marginBottom: 20 }}>
                    <label style={labelStyle}>비밀번호</label>
                    <input type="password" required value={password} onChange={(e: { target: HTMLInputElement }) => setPassword(e.target.value)}
                      placeholder={mode === "signup" ? "6자 이상" : "••••••••"} style={inputStyle} autoComplete={mode === "signup" ? "new-password" : "current-password"} />
                  </div>

                  <button type="submit" disabled={busy || !email.trim() || !password.trim()} style={{
                    ...btnPrimaryStyle,
                    opacity: (busy || !email.trim() || !password.trim()) ? 0.6 : 1,
                    cursor: (busy || !email.trim() || !password.trim()) ? "not-allowed" : "pointer",
                  }}>
                    {busy ? "처리 중..." : mode === "signin" ? "로그인" : "계정 만들기"}
                  </button>
                </form>
              )}

              <div style={{ marginTop: 20, borderTop: "1px solid #2a2a3d", paddingTop: 16, textAlign: "center" }}>
                <button onClick={handleLocalMode} style={{
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: 12, color: "#475569", textDecoration: "underline",
                }}>
                  로그인 없이 로컬 모드로 사용
                </button>
              </div>
            </>
          )}
        </div>

        <p style={{ textAlign: "center", marginTop: 20, fontSize: 12, color: "#475569" }}>
          API 키는 브라우저 localStorage에만 저장됩니다
        </p>
      </div>
    </div>
  );
}

// ─── Inline styles ─────────────────────────────────────────────────────────────

const btnPrimaryStyle: { [key: string]: string | number | undefined } = {
  width: "100%", padding: "12px 16px", borderRadius: 12,
  fontSize: 14, fontWeight: 700, cursor: "pointer",
  background: "linear-gradient(135deg, #7c6cfc, #a78bfa)",
  border: "none", color: "white", transition: "opacity 0.15s",
};

const labelStyle: { [key: string]: string | number | undefined } = {
  display: "block", fontSize: 12, fontWeight: 600,
  color: "#94a3b8", marginBottom: 6, textTransform: "uppercase" as const, letterSpacing: "0.05em",
};

const inputStyle: { [key: string]: string | number | undefined } = {
  width: "100%", padding: "10px 14px", borderRadius: 10,
  background: "#0d0d14", border: "1px solid #2a2a3d",
  color: "#f1f5f9", fontSize: 14, outline: "none",
  transition: "border-color 0.15s",
  boxSizing: "border-box" as const,
};
