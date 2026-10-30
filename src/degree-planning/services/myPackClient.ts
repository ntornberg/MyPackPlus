import { fetchWithTimeout } from "../../utils/fetchWithTimeout";

export const PLANNING_SYNC_MAX_AGE = 60 * 60 * 1000;

/** Only MyPack's portal can serve these scripts with the student's session. */
export function peopleSoftScriptBase(
  location: Pick<Location, "hostname" | "pathname">,
): string | null {
  if (location.hostname !== "portalsp.acs.ncsu.edu") return null;
  const match = location.pathname.match(
    /^\/ps[pc]\/([^/]+?)(?:_\d+)?\/([^/]+)\/([^/]+)\/[chs]\//,
  );
  return match ? `/psc/${match[1]}/${match[2]}/${match[3]}/s/` : null;
}

/** Thrown when MyPack answers with its sign-in page instead of the script's data. */
export class MyPackSessionExpiredError extends Error {
  constructor() {
    super("Your MyPack session expired. Refresh the page to sign in again.");
    this.name = "MyPackSessionExpiredError";
  }
}

/** PeopleSoft sign-in page markers; script responses never contain these. */
const SIGN_IN_PAGE = /cmd=login|name=["']?pwd\b|id=["']?userid\b/i;

/**
 * True when an expired session sent the sign-in page (or a redirect to it).
 * PeopleSoft answers 200 here, so `response.ok` alone can't tell.
 */
export function isSignInResponse(
  response: Pick<Response, "redirected" | "url">,
  body: string,
): boolean {
  return (
    (response.redirected && /cmd=login/i.test(response.url)) ||
    SIGN_IN_PAGE.test(body)
  );
}

export async function fetchMyPackText(url: string): Promise<string> {
  const response = await fetchWithTimeout(url, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`${response.status} from ${url.split("?")[0]}`);
  }
  const body = await response.text();
  if (isSignInResponse(response, body)) {
    throw new MyPackSessionExpiredError();
  }
  return body;
}
