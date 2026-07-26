#!/usr/bin/env node

import { spawn } from "node:child_process";
import { platform } from "node:os";
import { crawlMoviePages } from "./crawl.js";
import { checkLinks } from "./check.js";
import { postDiscordReport } from "./discord.js";
import { writeReports } from "./report.js";
import type { MovieResult, ReportSummary } from "./types.js";

const DEFAULT_URL = "https://familyeditcenter.netlify.app/#movies";

interface CliOptions {
  url: string;
  outputDirectory: string;
  headless: boolean;
  copy: boolean;
  discord: boolean;
  testing: boolean;
  failOnDead: boolean;
  maxPages: number;
  concurrency: number;
  timeoutMs: number;
  settleMs: number;
  requestDelayMs: number;
  requestJitterMs: number;
  retryRateLimits: boolean;
}

function usage(): string {
  return `
Family Edit Center link checker

Usage:
  pnpm check
  pnpm check -- --copy
  pnpm check -- --url https://example.com/#movies

Options:
  --url <url>            Page to crawl (default: ${DEFAULT_URL})
  --output-dir <path>    Report folder (default: reports)
  --max-pages <number>   Pagination safety limit (default: 100)
  --concurrency <number> Simultaneous link checks (default: 8)
  --timeout <seconds>    Timeout for each link (default: 20)
  --settle <milliseconds> Wait after each page change (default: 500)
  --request-delay <ms>   Minimum pause between link checks (default: 0)
  --request-jitter <ms>  Add a random pause up to this amount (default: 0)
  --retry-rate-limits    Retry 429 responses after 10s, 30s, and 60s
  --headed               Show the browser while crawling
  --copy                 Copy the report when it fits one Discord message
  --discord              Post the finished report to a Discord webhook
  --testing              Check only the first two pages and label reports TESTING
  --fail-on-dead         Exit with status 2 when dead links are found
  --help                  Show this help
`.trim();
}

function positiveNumber(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return parsed;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    url: DEFAULT_URL,
    outputDirectory: "reports",
    headless: true,
    copy: false,
    discord: false,
    testing: false,
    failOnDead: false,
    maxPages: 100,
    concurrency: 8,
    timeoutMs: 20_000,
    settleMs: 500,
    requestDelayMs: 0,
    requestJitterMs: 0,
    retryRateLimits: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case "--":
        break;
      case "--help":
      case "-h":
        console.log(usage());
        process.exit(0);
        break;
      case "--url":
        options.url = args[++index] ?? "";
        break;
      case "--output-dir":
        options.outputDirectory = args[++index] ?? "";
        break;
      case "--max-pages":
        options.maxPages = positiveNumber(args[++index], "--max-pages");
        break;
      case "--concurrency":
        options.concurrency = positiveNumber(args[++index], "--concurrency");
        break;
      case "--timeout":
        options.timeoutMs = positiveNumber(args[++index], "--timeout") * 1_000;
        break;
      case "--settle":
        options.settleMs = positiveNumber(args[++index], "--settle");
        break;
      case "--request-delay": {
        const value = Number(args[++index]);
        if (!Number.isFinite(value) || value < 0) {
          throw new Error("--request-delay must be zero or a positive number");
        }
        options.requestDelayMs = value;
        break;
      }
      case "--request-jitter": {
        const value = Number(args[++index]);
        if (!Number.isFinite(value) || value < 0) {
          throw new Error("--request-jitter must be zero or a positive number");
        }
        options.requestJitterMs = value;
        break;
      }
      case "--retry-rate-limits":
        options.retryRateLimits = true;
        break;
      case "--headed":
        options.headless = false;
        break;
      case "--copy":
        options.copy = true;
        break;
      case "--discord":
        options.discord = true;
        break;
      case "--testing":
        options.testing = true;
        break;
      case "--fail-on-dead":
        options.failOnDead = true;
        break;
      default:
        throw new Error(`Unknown option: ${argument}`);
    }
  }

  if (!options.url) throw new Error("--url requires a value");
  if (!options.outputDirectory) throw new Error("--output-dir requires a value");
  new URL(options.url);
  if (options.testing) options.maxPages = 2;
  return options;
}

async function copyToClipboard(text: string): Promise<boolean> {
  const command =
    platform() === "darwin"
      ? { executable: "pbcopy", args: [] }
      : platform() === "win32"
        ? { executable: "clip", args: [] }
        : { executable: "xclip", args: ["-selection", "clipboard"] };

  return new Promise((resolve) => {
    const child = spawn(command.executable, command.args, {
      stdio: ["pipe", "ignore", "ignore"]
    });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
    child.stdin.end(text);
  });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.testing) {
    console.log("TESTING mode: only the first two catalog pages will be checked.");
  }
  console.log(`Crawling ${options.url}`);
  const failures: MovieResult[] = [];
  const summary: ReportSummary = {
    total: 0,
    valid: 0,
    dead: 0,
    review: 0
  };

  const pagesProcessed = await crawlMoviePages(
    {
      url: options.url,
      headless: options.headless,
      maxPages: options.maxPages,
      settleMs: options.settleMs
    },
    async (movieLinks, pageNumber) => {
      if (movieLinks.length === 0) {
        console.log(`Page ${pageNumber}: no movie links found.`);
        return;
      }

      const uniqueUrlCount = new Set(movieLinks.map((item) => item.url)).size;
      console.log(
        `Page ${pageNumber}: found ${movieLinks.length} movie links (${uniqueUrlCount} unique URLs).`
      );

      const checks = await checkLinks(
        movieLinks.map((item) => item.url),
        {
          concurrency: options.concurrency,
          timeoutMs: options.timeoutMs,
          sampleBytes: 64 * 1024,
          delayMs: options.requestDelayMs,
          jitterMs: options.requestJitterMs,
          retryRateLimits: options.retryRateLimits,
          onRateLimit: (attempt, waitMs) => {
            process.stdout.write("\n");
            console.log(
              `Rate limited by Google; retry ${attempt}/3 in ${Math.ceil(
                waitMs / 1_000
              )} seconds.`
            );
          }
        },
        (completed, total) => {
          process.stdout.write(`\rPage ${pageNumber}: checking links ${completed}/${total}`);
        }
      );
      process.stdout.write("\n");

      for (const movieLink of movieLinks) {
        const check = checks.get(movieLink.url) ?? {
          url: movieLink.url,
          state: "review" as const,
          reason: "No check result was produced"
        };
        const result: MovieResult = { ...movieLink, ...check };
        summary.total += 1;
        summary[result.state] += 1;
        if (result.state !== "valid") failures.push(result);
      }
    }
  );

  if (summary.total === 0) {
    throw new Error("No elements with data-track-link were found.");
  }

  const checkedAt = new Date();
  const report = await writeReports({
    results: failures,
    summary,
    outputDirectory: options.outputDirectory,
    sourceUrl: options.url,
    checkedAt,
    testing: options.testing
  });

  console.log(
    `Done after ${pagesProcessed} pages: ${summary.valid} valid, ${summary.dead} dead, ${summary.review} could not be verified.`
  );
  console.log(`Markdown report for Discord upload:\n  ${report.markdownFile}`);
  console.log(`Failure details JSON:\n  ${report.jsonFile}`);

  if (options.discord) {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) {
      throw new Error(
        "DISCORD_WEBHOOK_URL is required with --discord. Add it as a GitHub Actions secret or environment variable."
      );
    }
    const messageCount = await postDiscordReport(webhookUrl, {
      results: failures,
      summary,
      checkedAt,
      testing: options.testing
    });
    console.log(
      `Posted ${messageCount} Discord embed${messageCount === 1 ? "" : "s"}.`
    );
  }

  if (options.copy) {
    if (report.messages.length !== 1) {
      console.log("The report spans multiple Discord messages, so it was not copied.");
    } else if (await copyToClipboard(report.messages[0] ?? "")) {
      console.log("Discord report copied to the clipboard.");
    } else {
      console.log("Clipboard copy was unavailable; use the report file above.");
    }
  }

  if (options.failOnDead && summary.dead > 0) process.exitCode = 2;
}

main().catch((error) => {
  console.error(`Link checker failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
