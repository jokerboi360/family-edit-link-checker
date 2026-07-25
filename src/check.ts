import type { CheckOptions, LinkCheck } from "./types.js";

const GOOGLE_DEAD_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/file you have requested does not exist/i, "Google Drive file does not exist"],
  [/file is in the owner(?:'|&#39;|’)?s trash/i, "Google Drive file is in the owner's trash"],
  [/this item might have been deleted/i, "Google Drive item may have been deleted"],
  [/\byou need access\b/i, "Google Drive file requires access"],
  [/\brequest access\b/i, "Google Drive file requires access"],
  [/unable to access (?:a )?document/i, "Google Drive file is unavailable"],
  [/we(?:'|&#39;|’)?re sorry.*you can(?:not|'t) access this item/is, "Google Drive file is unavailable"]
];

const RATE_LIMIT_BACKOFFS_MS = [10_000, 30_000, 60_000] as const;

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function delayWithJitter(baseMs: number, options: CheckOptions): number {
  const jitterMs = Math.max(0, options.jitterMs ?? 0);
  if (jitterMs === 0) return baseMs;
  const randomValue = Math.min(0.999_999, Math.max(0, (options.random ?? Math.random)()));
  return baseMs + Math.floor(randomValue * jitterMs);
}

function isGoogleFileUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === "drive.google.com" ||
      host === "docs.google.com" ||
      host.endsWith(".drive.google.com") ||
      host.endsWith(".docs.google.com")
    );
  } catch {
    return false;
  }
}

export function classifyResponse(input: {
  originalUrl: string;
  finalUrl: string;
  status: number;
  statusText: string;
  bodySample: string;
}): LinkCheck {
  const { originalUrl, finalUrl, status, statusText, bodySample } = input;
  const reasonStatus = `${status} ${statusText}`.trim();
  const googleLink = isGoogleFileUrl(originalUrl) || isGoogleFileUrl(finalUrl);

  if (googleLink) {
    try {
      if (new URL(finalUrl).hostname.toLowerCase() === "accounts.google.com") {
        return {
          url: originalUrl,
          finalUrl,
          state: "dead",
          reason: "Google Drive file requires sign-in",
          status
        };
      }
    } catch {
      // The URL was already validated before this function was called.
    }

    for (const [pattern, reason] of GOOGLE_DEAD_PATTERNS) {
      if (pattern.test(bodySample)) {
        return { url: originalUrl, finalUrl, state: "dead", reason, status };
      }
    }
  }

  if (status >= 200 && status < 300) {
    return {
      url: originalUrl,
      finalUrl,
      state: "valid",
      reason: reasonStatus,
      status
    };
  }

  if (status === 429) {
    return {
      url: originalUrl,
      finalUrl,
      state: "review",
      reason: "429 rate limited",
      status
    };
  }

  if (status >= 500 || status === 408 || (status >= 300 && status < 400)) {
    return {
      url: originalUrl,
      finalUrl,
      state: "review",
      reason: reasonStatus,
      status
    };
  }

  return {
    url: originalUrl,
    finalUrl,
    state: "dead",
    reason: reasonStatus,
    status
  };
}

async function readBodySample(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";

  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - total;
      const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      text += decoder.decode(chunk, { stream: true });
      total += chunk.byteLength;
      if (chunk.byteLength < value.byteLength) break;
    }
    text += decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return text;
}

export async function checkLink(url: string, options: CheckOptions): Promise<LinkCheck> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { url, state: "dead", reason: "Malformed URL" };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { url, state: "dead", reason: `Unsupported protocol: ${parsed.protocol}` };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const maximumAttempts = options.retryRateLimits
    ? RATE_LIMIT_BACKOFFS_MS.length + 1
    : 1;

  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const response = await fetchImpl(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
          Range: `bytes=0-${options.sampleBytes - 1}`,
          "User-Agent": "FamilyEditCenterLinkChecker/1.0"
        }
      });

      const backoffMs = RATE_LIMIT_BACKOFFS_MS[attempt];
      if (
        options.retryRateLimits &&
        response.status === 429 &&
        backoffMs !== undefined
      ) {
        await response.body?.cancel().catch(() => undefined);
        clearTimeout(timeout);
        const waitMs = delayWithJitter(backoffMs, options);
        options.onRateLimit?.(attempt + 1, waitMs);
        await sleep(waitMs);
        continue;
      }

      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      const shouldReadBody =
        contentType.includes("text/") ||
        contentType.includes("html") ||
        isGoogleFileUrl(url) ||
        isGoogleFileUrl(response.url);
      const bodySample = shouldReadBody
        ? await readBodySample(response, options.sampleBytes)
        : "";

      return classifyResponse({
        originalUrl: url,
        finalUrl: response.url || url,
        status: response.status,
        statusText: response.statusText,
        bodySample
      });
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === "AbortError";
      return {
        url,
        state: "review",
        reason: isTimeout
          ? `Timed out after ${options.timeoutMs / 1000}s`
          : `Network error: ${error instanceof Error ? error.message : String(error)}`
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  return { url, state: "review", reason: "429 rate limited" };
}

export async function checkLinks(
  urls: string[],
  options: CheckOptions,
  onProgress?: (completed: number, total: number) => void
): Promise<Map<string, LinkCheck>> {
  const uniqueUrls = [...new Set(urls)];
  const results = new Map<string, LinkCheck>();
  let nextIndex = 0;
  let completed = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < uniqueUrls.length) {
      const index = nextIndex;
      nextIndex += 1;
      const url = uniqueUrls[index];
      if (!url) continue;
      results.set(url, await checkLink(url, options));
      completed += 1;
      onProgress?.(completed, uniqueUrls.length);
      if (options.delayMs) {
        const sleep = options.sleep ?? defaultSleep;
        await sleep(delayWithJitter(options.delayMs, options));
      }
    }
  };

  const workers = Array.from(
    { length: Math.min(options.concurrency, uniqueUrls.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}
