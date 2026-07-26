import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { MovieResult, ReportSummary } from "./types.js";

const DISCORD_LIMIT = 2_000;

function escapeDiscord(value: string): string {
  return value.replace(/([\\*_~`|>])/g, "\\$1").trim();
}

function renderItem(result: MovieResult): string {
  return [
    `**${escapeDiscord(result.movie)}**`,
    `Editor: ${escapeDiscord(result.editor)}`,
    `<${result.url}>`
  ].join("\n");
}

export function buildDiscordMessages(
  results: MovieResult[],
  maxLength = DISCORD_LIMIT,
  testing = false
): string[] {
  const testingPrefix = testing ? "🧪 **TESTING**\n" : "";
  const dead = results.filter((result) => result.state === "dead");
  const sections: Array<{ heading: string; items: MovieResult[] }> = [];

  if (dead.length > 0) {
    sections.push({
      heading: `${testingPrefix}🚨 **Dead Movie Links** (${dead.length})`,
      items: dead
    });
  }
  if (sections.length === 0) {
    return [
      `${testingPrefix}✅ **Movie Link Check Complete**\nNo dead links found.`
    ];
  }

  const messages: string[] = [];
  let current = "";

  const appendBlock = (block: string): void => {
    const proposed = current ? `${current}\n\n${block}` : block;
    if (proposed.length <= maxLength) {
      current = proposed;
      return;
    }
    if (current) messages.push(current);
    current = block;
  };

  for (const section of sections) {
    appendBlock(section.heading);
    for (const item of section.items) {
      appendBlock(renderItem(item));
    }
  }
  if (current) messages.push(current);

  if (messages.length > 1) {
    return messages.map((message, index) => {
      const suffix = `\n\n_Message ${index + 1} of ${messages.length}_`;
      if (message.length + suffix.length <= maxLength) return `${message}${suffix}`;
      return message;
    });
  }
  return messages;
}

export function buildMarkdownReport(input: {
  results: MovieResult[];
  sourceUrl: string;
  checkedAt: Date;
  summary?: ReportSummary;
  testing?: boolean;
}): string {
  const dead = input.results
    .filter((result) => result.state === "dead")
    .sort((left, right) => left.movie.localeCompare(right.movie));
  const easternDate = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(input.checkedAt);
  const testingPrefix = input.testing ? "TESTING — " : "";
  const lines = [
    `# ${testingPrefix}Dead Movie Links as of ${easternDate} (ET)`,
    "",
    "| Title | Editor | Link |",
    "| --- | --- | --- |"
  ];

  if (dead.length === 0) {
    lines.push("| No dead links found | — | — |");
  } else {
    for (const result of dead) {
      lines.push(
        `| ${escapeDiscord(result.movie)} | ${escapeDiscord(result.editor)} | <${result.url}> |`
      );
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

function timestampForFile(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

export async function writeReports(input: {
  results: MovieResult[];
  outputDirectory: string;
  sourceUrl: string;
  checkedAt?: Date;
  summary?: ReportSummary;
  testing?: boolean;
}): Promise<{ markdownFile: string; jsonFile: string; messages: string[] }> {
  const checkedAt = input.checkedAt ?? new Date();
  const outputDirectory = resolve(input.outputDirectory);
  await mkdir(outputDirectory, { recursive: true });

  const stamp = timestampForFile(checkedAt);
  const messages = buildDiscordMessages(
    input.results,
    DISCORD_LIMIT,
    input.testing ?? false
  );
  const markdownFile = join(outputDirectory, `movie-link-report-${stamp}.md`);
  await writeFile(
    markdownFile,
    buildMarkdownReport({
      results: input.results,
      sourceUrl: input.sourceUrl,
      checkedAt,
      ...(input.testing !== undefined ? { testing: input.testing } : {}),
      ...(input.summary ? { summary: input.summary } : {})
    }),
    "utf8"
  );

  const jsonFile = join(outputDirectory, `link-results-${stamp}.json`);
  await writeFile(
    jsonFile,
    `${JSON.stringify(
      {
        sourceUrl: input.sourceUrl,
        checkedAt: checkedAt.toISOString(),
        testing: input.testing ?? false,
        summary: input.summary ?? {
          total: input.results.length,
          valid: input.results.filter((result) => result.state === "valid").length,
          dead: input.results.filter((result) => result.state === "dead").length,
          review: input.results.filter((result) => result.state === "review").length
        },
        failures: input.results
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return { markdownFile, jsonFile, messages };
}
