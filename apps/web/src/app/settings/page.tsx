"use client";

import { useState, useEffect, useCallback } from "react";
import s from "./page.module.css";

// ── Config ────────────────────────────────────────────────
interface KeyConfig {
  id: "anthropic" | "whisk" | "replicate";
  label: string;
  storageKey: string;
  placeholder: string;
  hint: string;
  required: boolean;
  validatePrefix?: string;
  docsLabel: string;
  docsHref: string;
}

const KEYS: KeyConfig[] = [
  {
    id: "anthropic",
    label: "Anthropic API Key",
    storageKey: "wts_anthropic_key",
    placeholder: "sk-ant-api03-...",
    hint: "Claude 에이전트 7인 실행에 사용됩니다. Phase 1~4 모든 단계에 필요합니다.",
    required: true,
    validatePrefix: "sk-ant-",
    docsLabel: "console.anthropic.com",
    docsHref: "https://console.anthropic.com",
  },
  {
    id: "whisk",
    label: "Whisk API Key",
    storageKey: "wts_whisk_key",
    placeholder: "whisk-...",
    hint: "Phase 5 이미지 생성(텍스트→이미지)에 사용됩니다. Phase 1~4만 사용한다면 없어도 됩니다.",
    required: false,
    docsLabel: "labs.google/flow",
    docsHref: "https://labs.google/flow/about",
  },
  {
    id: "replicate",
    label: "Replicate API Token",
    storageKey: "wts_replicate_key",
    placeholder: "r8_...",
    hint: "Phase 5 SCC 화풍 검증(CLIP Score)에 사용됩니다.",
    required: false,
    validatePrefix: "r8_",
    docsLabel: "replicate.com/account",
    docsHref: "https://replicate.com/account/api-tokens",
  },
];

// ── Types ─────────────────────────────────────────────────
type TestStatus = "idle" | "testing" | "ok" | "error";

interface KeyState {
  value: string;       // 현재 입력값
  saved: string;       // localStorage에 저장된 값
  visible: boolean;    // 평문 표시 여부
  status: TestStatus;
  errorMsg: string;
  dirty: boolean;      // 저장 후 변경됐는지
}

function mask(key: string) {
  if (!key) return "";
  if (key.length <= 8) return "•".repeat(key.length);
  return key.slice(0, 6) + "•".repeat(Math.min(key.length - 10, 20)) + key.slice(-4);
}

function validateFormat(cfg: KeyConfig, val: string): string | null {
  if (!val) return null;
  if (cfg.validatePrefix && !val.startsWith(cfg.validatePrefix)) {
    return `${cfg.validatePrefix}로 시작해야 합니다`;
  }
  if (val.length < 12) return "키가 너무 짧습니다";
  return null;
}

// ── ApiKey card ───────────────────────────────────────────
function KeyCard({ cfg, onSaved }: { key?: string; cfg: KeyConfig; onSaved: () => void }) {
  const [state, setState] = useState<KeyState>({
    value: "",
    saved: "",
    visible: false,
    status: "idle",
    errorMsg: "",
    dirty: false,
  });

  useEffect(() => {
    const saved = localStorage.getItem(cfg.storageKey) ?? "";
    setState((p: KeyState) => ({ ...p, saved, value: saved, status: saved ? "ok" : "idle" }));
  }, [cfg.storageKey]);

  const formatError = state.value ? validateFormat(cfg, state.value) : null;

  async function handleSave() {
    const val = state.value.trim();
    if (!val) return;

    const fmtErr = validateFormat(cfg, val);
    if (fmtErr) {
      setState((p: KeyState) => ({ ...p, status: "error", errorMsg: fmtErr }));
      return;
    }

    setState((p: KeyState) => ({ ...p, status: "testing", errorMsg: "" }));

    let ok = false;
    let msg = "";

    try {
      if (cfg.id === "anthropic") {
        // Direct browser test against Anthropic API
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": val,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 10,
            messages: [{ role: "user", content: "hi" }],
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (res.ok) {
          ok = true;
        } else {
          const data = await res.json() as { error?: { message?: string } };
          msg = data.error?.message ?? `HTTP ${res.status}`;
        }
      } else {
        // Format-only validation for other services (no direct test available)
        ok = true;
      }
    } catch (e) {
      msg = e instanceof Error ? e.message : "연결 실패";
    }

    if (ok) {
      localStorage.setItem(cfg.storageKey, val);
      setState((p: KeyState) => ({ ...p, saved: val, status: "ok", errorMsg: "", dirty: false }));
      onSaved();
    } else {
      setState((p: KeyState) => ({ ...p, status: "error", errorMsg: msg || "연결 실패" }));
    }
  }

  function handleClear() {
    localStorage.removeItem(cfg.storageKey);
    setState({ value: "", saved: "", visible: false, status: "idle", errorMsg: "", dirty: false });
  }

  const isSaved = !!state.saved && state.status === "ok" && !state.dirty;

  return (
    <div className={`${s.keyCard} ${isSaved ? s.hasKey : ""} ${state.status === "error" ? s.hasError : ""}`}>
      <div className={s.keyHeader}>
        <div className={s.keyMeta}>
          <div className={s.keyLabel}>
            {cfg.label}
            <span className={cfg.required ? s.keyRequired : s.keyOptional}>
              {cfg.required ? "필수" : "선택"}
            </span>
          </div>
          <div className={s.keyHint}>{cfg.hint}</div>
        </div>

        {/* Status badge */}
        {state.status === "testing" && (
          <div className={`${s.statusBadge} ${s.statusTesting}`}>
            <span className={s.spin} /> 테스트 중
          </div>
        )}
        {state.status === "ok" && !state.dirty && (
          <div className={`${s.statusBadge} ${s.statusSaved}`}>✓ 연결됨</div>
        )}
        {state.status === "error" && (
          <div className={`${s.statusBadge} ${s.statusError}`}>✗ 실패</div>
        )}
        {(state.status === "idle" || state.dirty) && (
          <div className={`${s.statusBadge} ${s.statusNone}`}>미설정</div>
        )}
      </div>

      <div className={s.inputRow}>
        <input
          className={`${s.keyInput} ${isSaved && !state.visible ? s.masked : ""}`}
          type={state.visible || !isSaved ? "text" : "password"}
          value={isSaved && !state.visible ? mask(state.saved) : state.value}
          onChange={(e: { target: HTMLInputElement }) => {
            const v = e.target.value;
            setState((p: KeyState) => ({
              ...p,
              value: v,
              dirty: true,
              status: p.saved ? "idle" : "idle",
              errorMsg: "",
            }));
          }}
          onFocus={() => {
            if (isSaved) setState((p: KeyState) => ({ ...p, visible: true, dirty: true }));
          }}
          placeholder={cfg.placeholder}
          spellCheck={false}
          autoComplete="off"
        />

        {/* Show / hide toggle */}
        <button
          className={s.btnIcon}
          onClick={() => setState((p: KeyState) => ({ ...p, visible: !p.visible }))}
          title={state.visible ? "숨기기" : "표시"}
          type="button"
        >
          {state.visible ? "🙈" : "👁"}
        </button>

        {/* Save button */}
        <button
          className={s.btnSave}
          onClick={handleSave}
          disabled={state.status === "testing" || !state.value.trim()}
          type="button"
        >
          {state.status === "testing" ? "테스트 중…" : "저장 & 테스트"}
        </button>
      </div>

      {/* Format error inline */}
      {formatError && state.value && (
        <div style={{ fontSize: 12, color: "#f87171", marginTop: 6 }}>⚠ {formatError}</div>
      )}
      {state.status === "error" && state.errorMsg && (
        <div style={{ fontSize: 12, color: "#f87171", marginTop: 6 }}>✗ {state.errorMsg}</div>
      )}

      <div className={s.docsLink}>
        발급처:&nbsp;
        <a href={cfg.docsHref} target="_blank" rel="noopener noreferrer">
          {cfg.docsLabel} ↗
        </a>
      </div>

      {state.saved && (
        <button className={s.btnClear} onClick={handleClear} type="button">
          ✕ 키 삭제
        </button>
      )}
    </div>
  );
}

// ── Firebase config card ──────────────────────────────────
const FIREBASE_FIELDS = [
  { key: "wts_firebase_api_key",            label: "API Key",            placeholder: "AIzaSy..." },
  { key: "wts_firebase_auth_domain",        label: "Auth Domain",        placeholder: "your-project.firebaseapp.com" },
  { key: "wts_firebase_project_id",         label: "Project ID",         placeholder: "your-project-id" },
  { key: "wts_firebase_storage_bucket",     label: "Storage Bucket",     placeholder: "your-project.appspot.com" },
  { key: "wts_firebase_messaging_sender_id", label: "Messaging Sender ID", placeholder: "123456789012" },
  { key: "wts_firebase_app_id",             label: "App ID",             placeholder: "1:123456789012:web:abc123..." },
];

function FirebaseCard({ onSaved }: { onSaved: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const init: Record<string, string> = {};
    FIREBASE_FIELDS.forEach((f) => {
      init[f.key] = localStorage.getItem(f.key) ?? "";
    });
    setValues(init);
    const hasAny = Object.values(init).some(Boolean);
    setSaved(hasAny);
  }, []);

  function handleChange(key: string, val: string) {
    setValues((prev) => ({ ...prev, [key]: val }));
    setDirty(true);
    setSaved(false);
  }

  function handleSave() {
    FIREBASE_FIELDS.forEach((f) => {
      const v = values[f.key]?.trim() ?? "";
      if (v) localStorage.setItem(f.key, v);
      else localStorage.removeItem(f.key);
    });
    setSaved(true);
    setDirty(false);
    onSaved();
  }

  function handleClear() {
    FIREBASE_FIELDS.forEach((f) => localStorage.removeItem(f.key));
    const empty: Record<string, string> = {};
    FIREBASE_FIELDS.forEach((f) => { empty[f.key] = ""; });
    setValues(empty);
    setSaved(false);
    setDirty(false);
    onSaved();
  }

  const isSaved = saved && !dirty;
  const hasValues = FIREBASE_FIELDS.some((f) => (values[f.key] ?? "").trim());

  return (
    <div className={`${s.keyCard} ${isSaved ? s.hasKey : ""}`}>
      <div className={s.keyHeader}>
        <div className={s.keyMeta}>
          <div className={s.keyLabel}>
            Firebase 설정
            <span className={s.keyOptional}>선택</span>
          </div>
          <div className={s.keyHint}>
            Firestore 데이터 영속성 및 Firebase Auth에 사용됩니다. 없으면 localStorage 전용 모드로 동작합니다.
            <br />
            <strong style={{ color: "#fbbf24" }}>저장 후 페이지를 새로고침해야 적용됩니다.</strong>
          </div>
        </div>
        {isSaved ? (
          <div className={`${s.statusBadge} ${s.statusSaved}`}>✓ 설정됨</div>
        ) : (
          <div className={`${s.statusBadge} ${s.statusNone}`}>미설정</div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {FIREBASE_FIELDS.map((f) => (
          <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 160, fontSize: 12, color: "var(--text-muted)", flexShrink: 0 }}>{f.label}</span>
            <input
              className={s.keyInput}
              type="text"
              value={values[f.key] ?? ""}
              onChange={(e: { target: HTMLInputElement }) => handleChange(f.key, e.target.value)}
              placeholder={f.placeholder}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14 }}>
        <div className={s.docsLink}>
          발급처:&nbsp;
          <a href="https://console.firebase.google.com" target="_blank" rel="noopener noreferrer">
            console.firebase.google.com ↗
          </a>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {hasValues && (
            <button className={s.btnClear} onClick={handleClear} type="button" style={{ marginTop: 0 }}>
              ✕ 초기화
            </button>
          )}
          <button
            className={s.btnSave}
            onClick={handleSave}
            disabled={!dirty && !hasValues}
            type="button"
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────
export default function SettingsPage() {
  const [savedCount, setSavedCount] = useState(0);

  const countSaved = useCallback(() => {
    const apiKeys = KEYS.filter((k) => !!localStorage.getItem(k.storageKey)).length;
    const fbKeys = FIREBASE_FIELDS.filter((f) => !!localStorage.getItem(f.key)).length;
    setSavedCount(apiKeys + (fbKeys > 0 ? 1 : 0));
  }, []);

  useEffect(() => {
    countSaved();
  }, [countSaved]);

  return (
    <div className={s.page}>
      <h1 className={s.pageTitle}>설정</h1>
      <p className={s.pageDesc}>
        API 키는 브라우저 localStorage에만 저장되며 서버로 전송되지 않습니다.
        <br />각 서비스 콘솔에서 키를 발급받아 입력해주세요.
      </p>

      <div className={s.infoBox}>
        <strong>ANTHROPIC_API_KEY</strong>가 설정되면 실제 AI 에이전트가 동작합니다.
        키가 없으면 Phase 페이지에서 <strong>mock 데이터</strong>로 미리보기 할 수 있습니다.
      </div>

      <div className={s.sectionLabel}>API 키 관리</div>

      {KEYS.map((cfg) => (
        <KeyCard key={cfg.id} cfg={cfg} onSaved={countSaved} />
      ))}

      <div className={s.sectionLabel} style={{ marginTop: 32 }}>Firebase 설정</div>

      <FirebaseCard onSaved={countSaved} />

      <div className={s.envTip}>
        <div className={s.envTipTitle}>💡 .env.local 파일로도 설정할 수 있습니다</div>
        <pre className={s.envTipCode}>{`ANTHROPIC_API_KEY=sk-ant-api03-...
WHISK_API_KEY=whisk-...
REPLICATE_API_KEY=r8_...

NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSy...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789012
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789012:web:abc123...`}</pre>
        <div className={s.envTipDesc}>
          프로덕션 배포 시에는 환경변수를 직접 서버에 설정하세요. localStorage 키는 개발 편의용입니다.
        </div>
      </div>
    </div>
  );
}
