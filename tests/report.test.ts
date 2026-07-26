import assert from "node:assert/strict";
import test from "node:test";
import { buildDiscordMessages, buildMarkdownReport } from "../src/report.js";
import type { MovieResult } from "../src/types.js";

test("builds a paste-ready dead-link report", () => {
  const results: MovieResult[] = [
    {
      movie: "Example Movie",
      editor: "Jane Editor",
      url: "https://example.com/dead",
      page: 2,
      state: "dead",
      reason: "404 Not Found",
      status: 404
    }
  ];

  const messages = buildDiscordMessages(results);
  assert.equal(messages.length, 1);
  assert.match(messages[0] ?? "", /🚨 \*\*Dead Movie Links\*\*/);
  assert.match(messages[0] ?? "", /\*\*Example Movie\*\*/);
  assert.match(messages[0] ?? "", /<https:\/\/example\.com\/dead>/);
  assert.doesNotMatch(messages[0] ?? "", /404 Not Found/);
});

test("returns a success message when every link is valid", () => {
  const results: MovieResult[] = [
    {
      movie: "Working Movie",
      editor: "John Editor",
      url: "https://example.com/working",
      page: 1,
      state: "valid",
      reason: "200 OK",
      status: 200
    }
  ];

  assert.deepEqual(buildDiscordMessages(results), [
    "✅ **Movie Link Check Complete**\nNo dead links found."
  ]);
});

test("labels test-mode local reports as TESTING", () => {
  const results: MovieResult[] = [];
  assert.match(buildDiscordMessages(results, 2_000, true)[0] ?? "", /TESTING/);

  const report = buildMarkdownReport({
    results,
    sourceUrl: "https://example.com/#movies",
    checkedAt: new Date("2026-07-25T12:00:00Z"),
    testing: true
  });
  assert.match(report, /^# TESTING — Dead Movie Links/);
});

test("builds one complete Markdown report for Discord upload", () => {
  const results: MovieResult[] = [
    {
      movie: "Example Movie",
      editor: "Jane Editor",
      url: "https://example.com/dead",
      page: 2,
      state: "dead",
      reason: "404 Not Found",
      status: 404
    },
    {
      movie: "Working Movie",
      editor: "John Editor",
      url: "https://example.com/working",
      page: 1,
      state: "valid",
      reason: "200 OK",
      status: 200
    }
  ];

  const report = buildMarkdownReport({
    results,
    sourceUrl: "https://example.com/#movies",
    checkedAt: new Date("2026-07-25T12:00:00Z")
  });

  assert.match(report, /^# Dead Movie Links as of July 25, 2026 \(ET\)/);
  assert.match(report, /\| Title \| Editor \| Link \|/);
  assert.match(
    report,
    /\| Example Movie \| Jane Editor \| <https:\/\/example\.com\/dead> \|/
  );
  assert.doesNotMatch(report, /Working Movie/);
  assert.doesNotMatch(report, /404 Not Found/);
  assert.doesNotMatch(report, /Watch on Drive/);
});

test("splits reports without exceeding Discord's message limit", () => {
  const results: MovieResult[] = Array.from({ length: 20 }, (_, index) => ({
    movie: `Movie ${index} ${"x".repeat(40)}`,
    editor: `Editor ${index}`,
    url: `https://example.com/dead/${index}`,
    page: 1,
    state: "dead" as const,
    reason: "404 Not Found",
    status: 404
  }));

  const messages = buildDiscordMessages(results, 400);
  assert.ok(messages.length > 1);
  assert.ok(messages.every((message) => message.length <= 400));
});
