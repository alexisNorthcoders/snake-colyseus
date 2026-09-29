export type BotOutcome = "win" | "loss" | "draw";

export interface BotResult {
  resultId: string;
  botId: string;
  mode: string;
  delay: number;
  outcome: BotOutcome;
}

const reportTimeoutMs = 3000;
const defaultApiUrl = "http://localhost:8080";

const apiUrl = () => process.env.API_URL || defaultApiUrl;
const secret = () => process.env.BOT_RESULTS_SECRET;

/** Logs once, at start-up, if vs-bot rounds won't be reported. */
export function logBotResultsConfig() {
  if (!secret()) console.log("[botResults] BOT_RESULTS_SECRET is not set: vs-bot results won't be reported");
}

/**
 * Tells go-server how a vs-bot round went, with the secret the two servers
 * share. Fire and forget: never throws and never rejects, so a caller need not
 * wait on it. A failure (unreachable, timeout, non-2xx) is logged with the
 * result and dropped, with no retry.
 */
export function reportBotResult(result: BotResult): void {
  const token = secret();
  if (!token) return;
  fetch(`${apiUrl().replace(/\/+$/, "")}/bot-results`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(result),
    signal: AbortSignal.timeout(reportTimeoutMs)
  }).then(
    (response) => {
      if (!response.ok) console.error(`[botResults] go-server answered ${response.status} for`, result);
    },
    (error) => console.error("[botResults] report failed for", result, error)
  );
}
