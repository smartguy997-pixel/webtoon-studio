"use client";

import { useState, useEffect } from "react";

interface AuthState {
  uid: string | null;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  loading: boolean;
  isLocalMode: boolean;
}

/**
 * Returns current Firebase Auth user state.
 * Falls back to local mode if Firebase is not configured or the user
 * is not signed in but has previously chosen local mode.
 */
export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    uid: null, email: null, displayName: null, photoURL: null,
    loading: true, isLocalMode: false,
  });

  useEffect(() => {
    const localMode = typeof window !== "undefined" && !!localStorage.getItem("wts_local_mode");
    if (localMode) {
      setState({ uid: "local", email: null, displayName: "로컬 사용자", photoURL: null, loading: false, isLocalMode: true });
      return;
    }

    // Try Firebase Auth
    let unsub: (() => void) | undefined;
    import("firebase/auth").then(({ onAuthStateChanged }) =>
      import("@/lib/firebase").then(({ auth }) => {
        unsub = onAuthStateChanged(auth, user => {
          if (user) {
            setState({
              uid: user.uid, email: user.email, displayName: user.displayName,
              photoURL: user.photoURL, loading: false, isLocalMode: false,
            });
          } else {
            // Not signed in — treat as local mode for DX
            setState({ uid: null, email: null, displayName: null, photoURL: null, loading: false, isLocalMode: false });
          }
        });
      })
    ).catch(() => {
      // Firebase not available
      setState({ uid: "local", email: null, displayName: "로컬 사용자", photoURL: null, loading: false, isLocalMode: true });
    });

    return () => unsub?.();
  }, []);

  return state;
}

/** Sign out from Firebase and clear local mode flag */
export async function signOut() {
  localStorage.removeItem("wts_local_mode");
  try {
    const { signOut: fbSignOut } = await import("firebase/auth");
    const { auth } = await import("@/lib/firebase");
    await fbSignOut(auth);
  } catch { /* ignore */ }
  window.location.href = "/login";
}
