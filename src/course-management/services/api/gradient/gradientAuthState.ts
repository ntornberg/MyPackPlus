import { useSyncExternalStore } from "react";

/** Whether the student's Gradient session worked on the last request. */
export type GradientAuthState = "unknown" | "ok" | "signedOut";

let state: GradientAuthState = "unknown";
const listeners = new Set<() => void>();

export function getGradientAuthState(): GradientAuthState {
  return state;
}

export function setGradientAuthState(next: GradientAuthState): void {
  if (next === state) return;
  state = next;
  for (const listener of listeners) listener();
}

export function subscribeGradientAuthState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Empty-state text for grades, for UIs that aren't React. */
export function gradeUnavailableText(fallback: string): string {
  return state === "signedOut"
    ? "Sign in to Gradient (gradient.ncsu.edu) to see grades."
    : fallback;
}

/** Re-renders when the student signs in to or out of Gradient. */
export function useGradientAuthState(): GradientAuthState {
  return useSyncExternalStore(
    subscribeGradientAuthState,
    getGradientAuthState,
    getGradientAuthState,
  );
}
