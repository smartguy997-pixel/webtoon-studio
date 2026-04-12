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

const OTHER_KEYS: KeyConfig[] = [
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
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

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
            stream: true,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (res.ok) {
          ok = true;
        } else {
          try {
            const data = await res.json() as { error?: { message?: string } };
            msg = data.error?.message ?? `HTTP ${res.status}`;
          } catch {
            msg = `HTTP ${res.status}`;
          }
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

// ── Runway API Key Card ───────────────────────────────────
const RUNWAY_STORAGE_KEY = "wts_runway_key";
const API_BASE = "http://localhost:4000";

function RunwayCard({ onSaved }: { onSaved: () => void }) {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState("");
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<TestStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const s = localStorage.getItem(RUNWAY_STORAGE_KEY) ?? "";
    setSaved(s); setValue(s); if (s) setStatus("ok");
  }, []);

  const isSaved = !!saved && status === "ok" && !dirty;

  async function handleSaveAndTest() {
    const val = value.trim();
    if (!val) return;
    if (val.length < 16) { setStatus("error"); setErrorMsg("키가 너무 짧습니다"); return; }

    setStatus("testing"); setErrorMsg("");

    try {
      const r = await fetch(`${API_BASE}/api/test-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service: "runway", key: val }),
      });
      const data = await r.json() as { ok: boolean; error?: string };
      if (data.ok) {
        localStorage.setItem(RUNWAY_STORAGE_KEY, val);
        setSaved(val); setStatus("ok"); setErrorMsg(""); setDirty(false);
        onSaved();
        // 마스킹된 키를 Firestore에도 저장 (키 자체가 아닌 마스킹 표시만)
        void fetch(`${API_BASE}/api/settings/runway`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ maskedKey: mask(val), savedAt: new Date().toISOString() }),
        });
      } else {
        setStatus("error"); setErrorMsg(data.error ?? "연결 실패");
      }
    } catch {
      setStatus("error"); setErrorMsg("서버 연결 실패 — API 서버가 실행 중인지 확인해주세요");
    }
  }

  function handleClear() {
    localStorage.removeItem(RUNWAY_STORAGE_KEY);
    setSaved(""); setValue(""); setStatus("idle"); setErrorMsg(""); setDirty(false);
  }

  return (
    <div className={`${s.keyCard} ${isSaved ? s.hasKey : ""} ${status === "error" ? s.hasError : ""}`}>
      <div className={s.keyHeader}>
        <div className={s.keyMeta}>
          <div className={s.keyLabel}>
            Runway API Key
            <span className={s.keyOptional}>선택</span>
          </div>
          <div className={s.keyHint}>
            영상 생성(Gen-3 Alpha)에 사용됩니다. 이미지→영상 변환, 텍스트→영상 생성을 지원합니다.
          </div>
        </div>
        {status === "testing" && <div className={`${s.statusBadge} ${s.statusTesting}`}><span className={s.spin} /> 테스트 중</div>}
        {status === "ok" && !dirty && <div className={`${s.statusBadge} ${s.statusSaved}`}>✓ 연결됨</div>}
        {status === "error" && <div className={`${s.statusBadge} ${s.statusError}`}>✗ 실패</div>}
        {(status === "idle" || dirty) && <div className={`${s.statusBadge} ${s.statusNone}`}>미설정</div>}
      </div>

      <div className={s.inputRow}>
        <input
          className={`${s.keyInput} ${isSaved && !visible ? s.masked : ""}`}
          type={visible || !isSaved ? "text" : "password"}
          value={isSaved && !visible ? mask(saved) : value}
          onChange={(e: { target: HTMLInputElement }) => {
            setValue(e.target.value); setDirty(true); setStatus("idle"); setErrorMsg("");
          }}
          onFocus={() => { if (isSaved) { setVisible(true); setDirty(true); } }}
          placeholder="런웨이 API 키 입력..."
          spellCheck={false}
          autoComplete="off"
        />
        <button className={s.btnIcon} onClick={() => setVisible((v: boolean) => !v)} title={visible ? "숨기기" : "표시"} type="button">
          {visible ? "🙈" : "👁"}
        </button>
        <button
          className={s.btnSave}
          onClick={handleSaveAndTest}
          disabled={status === "testing" || !value.trim()}
          type="button"
        >
          {status === "testing" ? "테스트 중…" : "저장 & 테스트"}
        </button>
      </div>

      {status === "error" && errorMsg && (
        <div style={{ fontSize: 12, color: "#f87171", marginTop: 6 }}>✗ {errorMsg}</div>
      )}

      <div className={s.docsLink}>
        발급처:&nbsp;
        <a href="https://app.runwayml.com/settings" target="_blank" rel="noopener noreferrer">
          app.runwayml.com/settings ↗
        </a>
      </div>

      {saved && (
        <button className={s.btnClear} onClick={handleClear} type="button">✕ 키 삭제</button>
      )}
    </div>
  );
}

// ── Firebase config card ──────────────────────────────────
const FIREBASE_FIELDS = [
  { key: "wts_firebase_api_key",             label: "API Key",             placeholder: "AIzaSy..." },
  { key: "wts_firebase_auth_domain",         label: "Auth Domain",         placeholder: "your-project.firebaseapp.com" },
  { key: "wts_firebase_project_id",          label: "Project ID",          placeholder: "your-project-id" },
  { key: "wts_firebase_storage_bucket",      label: "Storage Bucket",      placeholder: "your-project.appspot.com" },
  { key: "wts_firebase_messaging_sender_id", label: "Messaging Sender ID", placeholder: "123456789012" },
  { key: "wts_firebase_app_id",              label: "App ID",              placeholder: "1:123456789012:web:abc123..." },
];

// ── Anthropic Multi-Key Card ─────────────────────────────
interface AnthropicKeyState {
  value: string;
  saved: string;
  visible: boolean;
  status: TestStatus;
  errorMsg: string;
  dirty: boolean;
}

function AnthropicMultiKeyCard({ onSaved }: { onSaved: () => void }) {
  const [keys, setKeys] = useState<AnthropicKeyState[]>([]);
  const [addingNew, setAddingNew] = useState(false);

  useEffect(() => {
    // Load all existing Anthropic keys (wts_anthropic_key_1, wts_anthropic_key_2, etc.)
    const loadedKeys: AnthropicKeyState[] = [];
    for (let i = 1; i <= 10; i++) {
      const storageKey = `wts_anthropic_key_${i}`;
      const saved = localStorage.getItem(storageKey) ?? "";
      if (saved) {
        loadedKeys.push({
          value: saved,
          saved,
          visible: false,
          status: "ok",
          errorMsg: "",
          dirty: false,
        });
      }
    }
    setKeys(loadedKeys);
  }, []);

  async function testKey(val: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

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
          stream: true,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (res.ok) {
        return { ok: true };
      } else {
        let errMsg = `HTTP ${res.status}`;
        try {
          const data = await res.json() as { error?: { message?: string } };
          errMsg = data.error?.message ?? errMsg;
        } catch {
          // body가 JSON이 아닐 수 있음
        }
        return { ok: false, error: errMsg };
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "연결 실패";
      return { ok: false, error: errMsg };
    }
  }

  async function handleSave(index: number) {
    const state = keys[index];
    const val = state.value.trim();
    if (!val) return;

    const fmtErr = validateFormat({ validatePrefix: "sk-ant-" } as KeyConfig, val);
    if (fmtErr) {
      const newKeys = [...keys];
      newKeys[index] = { ...state, status: "error", errorMsg: fmtErr };
      setKeys(newKeys);
      return;
    }

    const newKeys = [...keys];
    newKeys[index] = { ...state, status: "testing", errorMsg: "" };
    setKeys(newKeys);

    const result = await testKey(val);

    if (result.ok) {
      const storageKey = `wts_anthropic_key_${index + 1}`;
      localStorage.setItem(storageKey, val);
      newKeys[index] = { value: val, saved: val, visible: false, status: "ok", errorMsg: "", dirty: false };
      setKeys(newKeys);
      onSaved();
    } else {
      newKeys[index] = { ...state, status: "error", errorMsg: result.error || "API 테스트 실패" };
      setKeys(newKeys);
    }
  }

  function handleChange(index: number, newValue: string) {
    const newKeys = [...keys];
    newKeys[index] = { ...newKeys[index], value: newValue, dirty: true, status: "idle", errorMsg: "" };
    setKeys(newKeys);
  }

  function handleClear(index: number) {
    const storageKey = `wts_anthropic_key_${index + 1}`;
    localStorage.removeItem(storageKey);
    const newKeys = keys.filter((_, i) => i !== index);
    setKeys(newKeys);
    onSaved();
  }

  function handleAddNew() {
    if (keys.length < 5) {
      setKeys([...keys, { value: "", saved: "", visible: false, status: "idle", errorMsg: "", dirty: false }]);
      setAddingNew(true);
    }
  }

  const savedCount = keys.filter((k) => k.status === "ok").length;

  return (
    <div className={`${s.keyCard} ${savedCount > 0 ? s.hasKey : ""}`}>
      <div className={s.keyHeader}>
        <div className={s.keyMeta}>
          <div className={s.keyLabel}>
            Anthropic API Keys
            <span className={s.keyRequired}>필수</span>
          </div>
          <div className={s.keyHint}>
            다중 API 키를 설정하여 에이전트 페어링의 비용을 절감합니다.
            예: Key 1 (전략가+조사자), Key 2 (세계관+캐릭터), Key 3 (시나리오+대본)
          </div>
        </div>
        {savedCount > 0 && (
          <div className={`${s.statusBadge} ${s.statusSaved}`}>✓ {savedCount}개 설정됨</div>
        )}
        {savedCount === 0 && (
          <div className={`${s.statusBadge} ${s.statusNone}`}>미설정</div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {keys.map((keyState, idx) => {
          const isSaved = !!keyState.saved && keyState.status === "ok" && !keyState.dirty;
          const formatError = keyState.value ? validateFormat({ validatePrefix: "sk-ant-" } as KeyConfig, keyState.value) : null;

          return (
            <div
              key={idx}
              style={{
                border: "1px solid var(--border-color)",
                borderRadius: 8,
                padding: 12,
                backgroundColor: keyState.status === "error" ? "rgba(248, 113, 113, 0.05)" : undefined,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>Key #{idx + 1}</span>
                {keyState.status === "testing" && (
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>테스트 중…</span>
                )}
                {isSaved && (
                  <span style={{ fontSize: 11, color: "#10b981" }}>✓ 연결됨</span>
                )}
                {keyState.status === "error" && (
                  <span style={{ fontSize: 11, color: "#f87171" }}>✗ 실패</span>
                )}
              </div>

              <div style={{ display: "flex", gap: 8, marginBottom: formatError ? 8 : 0 }}>
                <input
                  className={`${s.keyInput} ${isSaved && !keyState.visible ? s.masked : ""}`}
                  type={keyState.visible || !isSaved ? "text" : "password"}
                  value={isSaved && !keyState.visible ? mask(keyState.saved) : keyState.value}
                  onChange={(e) => handleChange(idx, e.target.value)}
                  placeholder="sk-ant-api03-..."
                  spellCheck={false}
                  autoComplete="off"
                  style={{ flex: 1 }}
                />

                <button
                  className={s.btnIcon}
                  onClick={() => {
                    const newKeys = [...keys];
                    newKeys[idx] = { ...newKeys[idx], visible: !newKeys[idx].visible };
                    setKeys(newKeys);
                  }}
                  title={keyState.visible ? "숨기기" : "표시"}
                  type="button"
                >
                  {keyState.visible ? "🙈" : "👁"}
                </button>

                <button
                  className={s.btnSave}
                  onClick={() => handleSave(idx)}
                  disabled={keyState.status === "testing" || !keyState.value.trim()}
                  type="button"
                >
                  {keyState.status === "testing" ? "테스트 중…" : "저장 & 테스트"}
                </button>

                {keyState.saved && (
                  <button
                    className={s.btnClear}
                    onClick={() => handleClear(idx)}
                    type="button"
                    style={{ marginTop: 0, width: "auto", padding: "8px 12px" }}
                  >
                    ✕
                  </button>
                )}
              </div>

              {formatError && keyState.value && (
                <div style={{ fontSize: 12, color: "#f87171", marginBottom: 8 }}>⚠ {formatError}</div>
              )}
              {keyState.status === "error" && keyState.errorMsg && (
                <div style={{ fontSize: 12, color: "#f87171" }}>✗ {keyState.errorMsg}</div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
        {keys.length < 5 && (
          <button
            onClick={handleAddNew}
            type="button"
            style={{
              padding: "8px 16px",
              fontSize: 12,
              backgroundColor: "var(--bg-hover)",
              border: "1px solid var(--border-color)",
              borderRadius: 6,
              cursor: "pointer",
              color: "var(--text-primary)",
            }}
          >
            + 키 추가
          </button>
        )}
      </div>

      <div className={s.docsLink} style={{ marginTop: 12 }}>
        발급처:&nbsp;
        <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer">
          console.anthropic.com ↗
        </a>
      </div>
    </div>
  );
}

// ── Firebase config card ──────────────────────────────
function FirebaseCard({ onSaved }: { onSaved: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const init: Record<string, string> = {};
    FIREBASE_FIELDS.forEach((f) => { init[f.key] = localStorage.getItem(f.key) ?? ""; });
    setValues(init);
    setSaved(Object.values(init).some(Boolean));
  }, []);

  function handleChange(key: string, val: string) {
    setValues((prev) => ({ ...prev, [key]: val }));
    setDirty(true);
    setSaved(false);
  }

  function handleSave() {
    FIREBASE_FIELDS.forEach((f) => {
      const v = (values[f.key] ?? "").trim();
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
        {isSaved
          ? <div className={`${s.statusBadge} ${s.statusSaved}`}>✓ 설정됨</div>
          : <div className={`${s.statusBadge} ${s.statusNone}`}>미설정</div>
        }
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
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
    let anthropicCount = 0;
    for (let i = 1; i <= 10; i++) {
      if (localStorage.getItem(`wts_anthropic_key_${i}`)) anthropicCount++;
    }
    const otherKeys = OTHER_KEYS.filter((k) => !!localStorage.getItem(k.storageKey)).length;
    const fbSaved = FIREBASE_FIELDS.some((f) => !!localStorage.getItem(f.key)) ? 1 : 0;
    const runwaySaved = localStorage.getItem(RUNWAY_STORAGE_KEY) ? 1 : 0;
    setSavedCount(Math.min(1, anthropicCount) + otherKeys + fbSaved + runwaySaved);
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
        <strong>Anthropic API Keys</strong>가 설정되면 실제 AI 에이전트가 동작합니다.
        키가 없으면 Phase 페이지에서 <strong>mock 데이터</strong>로 미리보기 할 수 있습니다.
        <br />
        <span style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8, display: "block" }}>
          💡 다중 API 키를 설정하면 에이전트 페어링의 비용을 절감할 수 있습니다. 예를 들어 3개의 키로 6개의 에이전트를 커버할 수 있습니다.
        </span>
      </div>

      <div className={s.sectionLabel}>API 키 관리</div>

      <AnthropicMultiKeyCard onSaved={countSaved} />

      {OTHER_KEYS.map((cfg) => (
        <KeyCard key={cfg.id} cfg={cfg} onSaved={countSaved} />
      ))}

      <RunwayCard onSaved={countSaved} />

      <div className={s.sectionLabel} style={{ marginTop: 32 }}>Firebase 설정</div>

      <FirebaseCard onSaved={countSaved} />

      <div className={s.envTip}>
        <div className={s.envTipTitle}>💡 .env.local 파일로도 설정할 수 있습니다</div>
        <pre className={s.envTipCode}>{`ANTHROPIC_API_KEY=sk-ant-api03-...
WHISK_API_KEY=whisk-...
REPLICATE_API_KEY=r8_...
RUNWAY_API_KEY=...

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
