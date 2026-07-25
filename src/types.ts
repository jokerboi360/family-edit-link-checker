export interface MovieLink {
  movie: string;
  editor: string;
  url: string;
  page: number;
}

export type CheckState = "valid" | "dead" | "review";

export interface LinkCheck {
  url: string;
  finalUrl?: string;
  state: CheckState;
  reason: string;
  status?: number;
}

export interface MovieResult extends MovieLink, LinkCheck {}

export interface ReportSummary {
  total: number;
  valid: number;
  dead: number;
  review: number;
}

export interface CrawlOptions {
  url: string;
  headless: boolean;
  maxPages: number;
  settleMs: number;
}

export interface CheckOptions {
  concurrency: number;
  timeoutMs: number;
  sampleBytes: number;
  delayMs?: number;
  jitterMs?: number;
  retryRateLimits?: boolean;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  onRateLimit?: (attempt: number, waitMs: number) => void;
}
