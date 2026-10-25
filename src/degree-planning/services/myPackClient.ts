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

export async function fetchMyPackText(url: string): Promise<string> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`${response.status} from ${url.split("?")[0]}`);
  }
  return response.text();
}
