import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDiscordPayloads,
  postDiscordReport
} from "../src/discord.js";
import type { MovieResult, ReportSummary } from "../src/types.js";

const summary: ReportSummary = {
  total: 3,
  valid: 1,
  dead: 1,
  review: 1
};

function result(
  movie: string,
  state: MovieResult["state"],
  index = 1
): MovieResult {
  return {
    movie,
    editor: `Editor ${index}`,
    url: `https://example.com/movie/${index}`,
    page: 1,
    state,
    reason: state === "dead" ? "404 Not Found" : "200 OK",
    status: state === "dead" ? 404 : 200
  };
}

test("builds a Discord embed containing only dead movie details", () => {
  const payloads = buildDiscordPayloads({
    results: [
      result("Working Movie", "valid", 1),
      result("Dead Movie", "dead", 2),
      result("Needs Review", "review", 3)
    ],
    summary,
    checkedAt: new Date("2026-07-25T16:00:00Z")
  });

  assert.equal(payloads.length, 1);
  const serialized = JSON.stringify(payloads[0]);
  assert.match(serialized, /Dead Movie/);
  assert.match(serialized, /Editor 2/);
  assert.match(serialized, /https:\/\/example\.com\/movie\/2/);
  assert.match(serialized, /July 25, 2026/);
  assert.equal(payloads[0]?.embeds[0]?.fields?.[0]?.value.endsWith("\n\u200B"), true);
  assert.doesNotMatch(serialized, /Working Movie/);
  assert.doesNotMatch(serialized, /Needs Review/);
  assert.doesNotMatch(serialized, /404 Not Found/);
});

test("splits a large dead-link list within Discord field limits", () => {
  const results = Array.from({ length: 60 }, (_, index) =>
    result(`Movie ${String(index).padStart(2, "0")}`, "dead", index)
  );
  const payloads = buildDiscordPayloads({
    results,
    summary: { total: 60, valid: 0, dead: 60, review: 0 },
    checkedAt: new Date("2026-07-25T16:00:00Z")
  });

  assert.equal(payloads.length, 3);
  assert.ok(
    payloads.every(
      (item) => (item.embeds[0]?.fields?.length ?? 0) <= 25
    )
  );
  assert.match(
    payloads[2]?.embeds[0]?.footer?.text ?? "",
    /Part 3 of 3/
  );
});

test("posts sequentially and retries a rate-limited Discord response", async () => {
  let requests = 0;
  const delays: number[] = [];
  const fetchImpl = (async () => {
    requests += 1;
    if (requests === 1) {
      return new Response(JSON.stringify({ retry_after: 0.001 }), {
        status: 429,
        statusText: "Too Many Requests",
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  const posted = await postDiscordReport(
    "https://discord.com/api/webhooks/example/token",
    {
      results: [result("Dead Movie", "dead")],
      summary: { total: 1, valid: 0, dead: 1, review: 0 },
      checkedAt: new Date("2026-07-25T16:00:00Z")
    },
    {
      fetchImpl,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      }
    }
  );

  assert.equal(posted, 1);
  assert.equal(requests, 2);
  assert.deepEqual(delays, [250]);
});

test("rejects non-Discord webhook URLs before making a request", async () => {
  await assert.rejects(
    postDiscordReport(
      "https://example.com/webhook",
      {
        results: [],
        summary: { total: 0, valid: 0, dead: 0, review: 0 },
        checkedAt: new Date("2026-07-25T16:00:00Z")
      }
    ),
    /must be an HTTPS Discord webhook URL/
  );
});
