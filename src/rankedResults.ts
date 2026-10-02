const requestTimeoutMs = 3000;
const defaultApiUrl = "http://localhost:8080";

const apiUrl = () => (process.env.API_URL || defaultApiUrl).replace(/\/+$/, "");
const secret = () => process.env.BOT_RESULTS_SECRET;

/** How hard a Ranked result is chased: tests shorten the delay. */
export const rankedRetry = { attempts: 6, baseDelayMs: 1000, maxDelayMs: 30000 };

/** One side of a Ranked match: an Account, or a Stand-in with its fixed Rating. */
export type RankedSide = { accountId: string } | { standInId: string; rating: number };

export interface RankedResult {
  resultId: string;
  a: RankedSide;
  b: RankedSide;
  /** The winning side, or a draw. */
  outcome: "a" | "b" | "draw";
  /** The losing side gave up by leaving. */
  forfeit: boolean;
}

/** An Account's Rating around one Ranked match, as go-server answers it. */
export interface RatingChange {
  accountId: string;
  ratingBefore: number;
  ratingAfter: number;
  rankedMatches: number;
  provisional: boolean;
}

export interface RankedResponse {
  resultId: string;
  outcome: "a" | "b" | "draw";
  forfeit: boolean;
  players: RatingChange[];
}

/** Logs once, at start-up, if Ranked results can't be reported. */
export function logRankedResultsConfig() {
  if (!secret()) console.log("[rankedResults] BOT_RESULTS_SECRET is not set: Ranked results won't be reported");
}

/**
 * Asks go-server whose token this is. Resolves with the Account's id, or
 * undefined for a Guest, an invalid or expired token, or go-server being
 * unreachable (a Ranked match can't be admitted on a token nobody vouched for).
 */
export async function verifyAccount(token: unknown): Promise<string | undefined> {
  if (typeof token !== "string" || !token) return undefined;
  try {
    const response = await fetch(`${apiUrl()}/verify-token`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(requestTimeoutMs)
    });
    if (!response.ok) return undefined;
    const body: any = await response.json();
    return body?.kind === "account" && typeof body.userId === "string" && body.userId ? body.userId : undefined;
  } catch (error) {
    console.error("[rankedResults] token check failed", error);
    return undefined;
  }
}

/** The Rating an Account is treated as having when go-server can't say. */
export const DEFAULT_RATING = 1500;

/**
 * Asks go-server for an Account's Rating. Falls back to `DEFAULT_RATING` if
 * go-server is unreachable, slow or doesn't give a number: never throws.
 */
export async function fetchRating(accountId: string): Promise<number> {
  try {
    const response = await fetch(`${apiUrl()}/rating?userId=${encodeURIComponent(accountId)}`, {
      signal: AbortSignal.timeout(requestTimeoutMs)
    });
    if (!response.ok) return DEFAULT_RATING;
    const body: any = await response.json();
    return typeof body?.rating === "number" && Number.isFinite(body.rating) ? body.rating : DEFAULT_RATING;
  } catch (error) {
    console.error("[rankedResults] rating lookup failed", error);
    return DEFAULT_RATING;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Tells go-server how a Ranked match went, with the secret the two servers
 * share, retrying with backoff while go-server is unreachable or failing: the
 * `resultId` makes a repeat safe. Never throws. Resolves with go-server's
 * answer, or undefined once it gives up (or has no secret to send).
 */
export async function reportRankedResult(result: RankedResult): Promise<RankedResponse | undefined> {
  const token = secret();
  if (!token) return undefined;
  for (let attempt = 1; attempt <= rankedRetry.attempts; attempt++) {
    let retryable = true;
    try {
      const response = await fetch(`${apiUrl()}/ranked-results`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(result),
        signal: AbortSignal.timeout(requestTimeoutMs)
      });
      if (response.ok) return (await response.json()) as RankedResponse;
      // A refused report won't be accepted on a second try, only a busy or broken server might.
      retryable = response.status >= 500 || response.status === 429;
      console.error(`[rankedResults] go-server answered ${response.status} for`, result);
    } catch (error) {
      console.error("[rankedResults] report failed for", result, error);
    }
    if (!retryable || attempt === rankedRetry.attempts) break;
    await sleep(Math.min(rankedRetry.maxDelayMs, rankedRetry.baseDelayMs * 2 ** (attempt - 1)));
  }
  console.error("[rankedResults] gave up on", result);
  return undefined;
}
