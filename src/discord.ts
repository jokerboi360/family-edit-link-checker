import type { MovieResult, ReportSummary } from "./types.js";

const DISCORD_EMBED_LIMIT = 6_000;
const DISCORD_FIELD_LIMIT = 25;
const SAFE_EMBED_LIMIT = 5_500;
const MAX_RETRIES = 3;

interface DiscordEmbedField {
  name: string;
  value: string;
  inline: boolean;
}

interface DiscordEmbed {
  title: string;
  color: number;
  fields?: DiscordEmbedField[];
  description?: string;
  footer?: { text: string };
}

export interface DiscordPayload {
  username: string;
  allowed_mentions: { parse: string[] };
  embeds: DiscordEmbed[];
}

export interface DiscordReportInput {
  results: MovieResult[];
  summary: ReportSummary;
  checkedAt: Date;
}

interface PostDiscordOptions {
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}

function truncate(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return `${value.slice(0, Math.max(0, maximum - 1))}…`;
}

function cleanText(value: string, fallback: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}

function formatEasternDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function buildField(result: MovieResult): DiscordEmbedField {
  const title = truncate(cleanText(result.movie, "Untitled movie"), 256);
  const editor = truncate(cleanText(result.editor, "Unknown"), 900);
  const value = truncate(`Editor: **${editor}**\n<${result.url}>\n\u200B`, 1_024);
  return { name: title, value, inline: false };
}

function embedCharacterCount(embed: DiscordEmbed): number {
  return (
    embed.title.length +
    (embed.description?.length ?? 0) +
    (embed.footer?.text.length ?? 0) +
    (embed.fields ?? []).reduce(
      (total, field) => total + field.name.length + field.value.length,
      0
    )
  );
}

function footerText(summary: ReportSummary, part?: { current: number; total: number }): string {
  const review =
    summary.review > 0 ? ` • ${summary.review} could not be verified` : "";
  const partText = part ? ` • Part ${part.current} of ${part.total}` : "";
  return `${summary.total} links checked${review}${partText}`;
}

function payload(embed: DiscordEmbed): DiscordPayload {
  if (embedCharacterCount(embed) > DISCORD_EMBED_LIMIT) {
    throw new Error("A Discord embed exceeded Discord's character limit");
  }

  return {
    username: "Family Edit Link Checker",
    allowed_mentions: { parse: [] },
    embeds: [embed]
  };
}

export function buildDiscordPayloads(input: DiscordReportInput): DiscordPayload[] {
  const date = formatEasternDate(input.checkedAt);
  const dead = input.results
    .filter((result) => result.state === "dead")
    .sort((left, right) => left.movie.localeCompare(right.movie));

  if (dead.length === 0) {
    const hasReviewItems = input.summary.review > 0;
    return [
      payload({
        title: hasReviewItems
          ? `⚠️ Link Check Finished — ${date}`
          : `✅ All Movie Links Are Working — ${date}`,
        description: hasReviewItems
          ? `No confirmed dead links were found. ${input.summary.review} link${
              input.summary.review === 1 ? "" : "s"
            } could not be verified and may need another run.`
          : "No dead movie links were found.",
        color: hasReviewItems ? 0xf1c40f : 0x2ecc71,
        footer: { text: footerText(input.summary) }
      })
    ];
  }

  const fieldGroups: DiscordEmbedField[][] = [];
  let current: DiscordEmbedField[] = [];

  for (const result of dead) {
    const field = buildField(result);
    const proposed = [...current, field];
    const proposedEmbed: DiscordEmbed = {
      title: `🚨 Dead Movie Links — ${date}`,
      color: 0xe74c3c,
      fields: proposed,
      footer: { text: footerText(input.summary) }
    };

    if (
      current.length > 0 &&
      (proposed.length > DISCORD_FIELD_LIMIT ||
        embedCharacterCount(proposedEmbed) > SAFE_EMBED_LIMIT)
    ) {
      fieldGroups.push(current);
      current = [field];
    } else {
      current = proposed;
    }
  }
  if (current.length > 0) fieldGroups.push(current);

  return fieldGroups.map((fields, index) =>
    payload({
      title: `🚨 Dead Movie Links — ${date}`,
      color: 0xe74c3c,
      fields,
      footer: {
        text: footerText(
          input.summary,
          fieldGroups.length > 1
            ? { current: index + 1, total: fieldGroups.length }
            : undefined
        )
      }
    })
  );
}

function validateWebhookUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("DISCORD_WEBHOOK_URL is not a valid URL");
  }

  const allowedHosts = new Set(["discord.com", "discordapp.com"]);
  if (
    parsed.protocol !== "https:" ||
    !allowedHosts.has(parsed.hostname.toLowerCase()) ||
    !parsed.pathname.startsWith("/api/webhooks/")
  ) {
    throw new Error("DISCORD_WEBHOOK_URL must be an HTTPS Discord webhook URL");
  }
  return parsed;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function retryDelay(response: Response, attempt: number): Promise<number> {
  if (response.status === 429) {
    try {
      const body = (await response.clone().json()) as { retry_after?: unknown };
      if (typeof body.retry_after === "number" && Number.isFinite(body.retry_after)) {
        return Math.max(250, Math.ceil(body.retry_after * 1_000));
      }
    } catch {
      // Fall back to the response header or exponential delay.
    }

    const header = Number(response.headers.get("retry-after"));
    if (Number.isFinite(header) && header > 0) return Math.ceil(header * 1_000);
  }

  return 1_000 * 2 ** attempt;
}

async function postPayload(
  webhookUrl: URL,
  discordPayload: DiscordPayload,
  fetchImpl: typeof fetch,
  sleep: (milliseconds: number) => Promise<void>
): Promise<void> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(discordPayload)
      });
    } catch (error) {
      if (attempt === MAX_RETRIES) {
        throw new Error(
          `Discord webhook request failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
      await sleep(1_000 * 2 ** attempt);
      continue;
    }

    if (response.ok) return;

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === MAX_RETRIES) {
      throw new Error(
        `Discord webhook returned ${response.status} ${response.statusText}`.trim()
      );
    }
    await sleep(await retryDelay(response, attempt));
  }
}

export async function postDiscordReport(
  webhookUrl: string,
  input: DiscordReportInput,
  options: PostDiscordOptions = {}
): Promise<number> {
  const parsedWebhookUrl = validateWebhookUrl(webhookUrl);
  const payloads = buildDiscordPayloads(input);
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;

  for (const discordPayload of payloads) {
    await postPayload(parsedWebhookUrl, discordPayload, fetchImpl, sleep);
  }
  return payloads.length;
}
