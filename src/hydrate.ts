#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { crawlMoviePages } from "./crawl.js";
import { extractReportedBadLinks, normalizeLinkKey } from "./report-input.js";
import { writeReports } from "./report.js";
import type { MovieResult, ReportSummary } from "./types.js";

const DEFAULT_URL = "https://familyeditcenter.netlify.app/#movies";

function usage(): string {
  return `
Build a title/editor/link table from an existing dead-link report.

Usage:
  pnpm hydrate -- "/path/to/movie-link-report.md"

This crawls the movie catalog for metadata but does not recheck any Drive links.
`.trim();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((argument) => argument !== "--");
  const reportArgument = args[0];
  if (!reportArgument || reportArgument === "--help" || reportArgument === "-h") {
    console.log(usage());
    process.exitCode = reportArgument ? 0 : 1;
    return;
  }

  const inputPath = resolve(reportArgument);
  const input = await readFile(inputPath, "utf8");
  const badLinks = extractReportedBadLinks(input);
  if (badLinks.length === 0) {
    throw new Error("No '**Link:** <URL>' entries were found in the supplied report.");
  }

  const targets = new Map(
    badLinks.map((link) => [normalizeLinkKey(link), link])
  );
  const matchedKeys = new Set<string>();
  const matchedResults = new Map<string, MovieResult>();

  console.log(`Reading ${badLinks.length} unique bad links from ${inputPath}`);
  console.log(`Gathering titles and editors from ${DEFAULT_URL}`);

  const pagesProcessed = await crawlMoviePages(
    {
      url: DEFAULT_URL,
      headless: true,
      maxPages: 100,
      settleMs: 500
    },
    async (movieLinks, pageNumber) => {
      let pageMatches = 0;
      for (const movieLink of movieLinks) {
        const key = normalizeLinkKey(movieLink.url);
        if (!targets.has(key)) continue;
        matchedKeys.add(key);
        pageMatches += 1;
        const result: MovieResult = {
          ...movieLink,
          state: "dead",
          reason: "Listed as dead in supplied report"
        };
        matchedResults.set(
          `${result.movie}\u0000${result.editor}\u0000${key}`,
          result
        );
      }
      console.log(
        `Page ${pageNumber}: ${pageMatches} matching bad link${pageMatches === 1 ? "" : "s"}.`
      );
    }
  );

  const results = [...matchedResults.values()];
  const unmatched = [...targets.entries()]
    .filter(([key]) => !matchedKeys.has(key))
    .map(([, link]) => link);
  const summary: ReportSummary = {
    total: badLinks.length,
    valid: 0,
    dead: results.length,
    review: unmatched.length
  };
  const report = await writeReports({
    results,
    summary,
    outputDirectory: "reports",
    sourceUrl: DEFAULT_URL
  });

  console.log(
    `Done after ${pagesProcessed} pages: matched ${matchedKeys.size} of ${badLinks.length} unique bad URLs.`
  );
  if (unmatched.length > 0) {
    console.log(`${unmatched.length} URL(s) were not found in the current catalog.`);
  }
  console.log(`Markdown table:\n  ${report.markdownFile}`);
}

main().catch((error) => {
  console.error(
    `Report hydration failed: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
});
