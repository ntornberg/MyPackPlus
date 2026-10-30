import { useEffect } from "react";

import { cn } from "@/lib/utils";

import { GRADIENT_SIGN_IN_URL } from "../../../course-management/services/api/gradient/gradientApi";
import {
  getGradientAuthState,
  useGradientAuthState,
} from "../../../course-management/services/api/gradient/gradientAuthState";
import { retryGradientSignIn } from "../../../course-management/services/api/gradient/gradientClient";

/**
 * Link to sign in to Gradient, shown where grades would be when the student's Gradient
 * session is missing. Returning to the tab lets the next grade load try again.
 */
export function GradientSignInLink({ className }: { className?: string }) {
  useEffect(() => {
    const onFocus = () => {
      if (getGradientAuthState() === "signedOut") retryGradientSignIn();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  return (
    <a
      href={GRADIENT_SIGN_IN_URL}
      target="_blank"
      rel="noreferrer"
      className={cn("underline underline-offset-2", className)}
      onClick={(event) => event.stopPropagation()}
    >
      Sign in to Gradient
    </a>
  );
}

/** "No grade history" line that offers the Gradient sign-in instead when signed out. */
export function NoGradeHistory({
  fallback,
  className,
}: {
  fallback: string;
  className?: string;
}) {
  const signedOut = useGradientSignedOut();
  return (
    <p className={className}>
      {signedOut ? (
        <>
          <GradientSignInLink /> to see grade history.
        </>
      ) : (
        fallback
      )}
    </p>
  );
}

/** True when grade empty states should offer the Gradient sign-in link. */
export function useGradientSignedOut(): boolean {
  return useGradientAuthState() === "signedOut";
}
