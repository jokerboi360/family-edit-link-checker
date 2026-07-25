import assert from "node:assert/strict";
import test from "node:test";
import { checkLink, checkLinks, classifyResponse } from "../src/check.js";

test("marks a normal 200 response as valid", () => {
  const result = classifyResponse({
    originalUrl: "https://example.com/movie",
    finalUrl: "https://example.com/movie",
    status: 200,
    statusText: "OK",
    bodySample: "<h1>Movie</h1>"
  });
  assert.equal(result.state, "valid");
});

test("marks a 404 response as dead", () => {
  const result = classifyResponse({
    originalUrl: "https://example.com/missing",
    finalUrl: "https://example.com/missing",
    status: 404,
    statusText: "Not Found",
    bodySample: ""
  });
  assert.equal(result.state, "dead");
  assert.equal(result.reason, "404 Not Found");
});

test("detects a Google Drive gone page even when it returns 200", () => {
  const result = classifyResponse({
    originalUrl: "https://drive.google.com/file/d/example/view",
    finalUrl: "https://drive.google.com/file/d/example/view",
    status: 200,
    statusText: "OK",
    bodySample: "Sorry, the file you have requested does not exist."
  });
  assert.equal(result.state, "dead");
  assert.equal(result.reason, "Google Drive file does not exist");
});

test("detects a public Google Drive access failure", () => {
  const result = classifyResponse({
    originalUrl: "https://drive.google.com/file/d/example/view",
    finalUrl: "https://drive.google.com/file/d/example/view",
    status: 200,
    statusText: "OK",
    bodySample: "<button>Request access</button>"
  });
  assert.equal(result.state, "dead");
  assert.equal(result.reason, "Google Drive file requires access");
});

test("treats rate limiting as needing review instead of a dead link", () => {
  const result = classifyResponse({
    originalUrl: "https://example.com/busy",
    finalUrl: "https://example.com/busy",
    status: 429,
    statusText: "Too Many Requests",
    bodySample: ""
  });
  assert.equal(result.state, "review");
});

test("retries a 429 response after 10, 30, and 60 second backoffs", async () => {
  let requests = 0;
  const delays: number[] = [];
  const fetchImpl = (async () => {
    requests += 1;
    if (requests <= 3) {
      return new Response(null, {
        status: 429,
        statusText: "Too Many Requests"
      });
    }
    return new Response("<h1>Working</h1>", {
      status: 200,
      statusText: "OK",
      headers: { "Content-Type": "text/html" }
    });
  }) as typeof fetch;

  const result = await checkLink("https://drive.google.com/file/d/example/view", {
    concurrency: 1,
    timeoutMs: 1_000,
    sampleBytes: 1_024,
    retryRateLimits: true,
    jitterMs: 1_000,
    random: () => 0,
    fetchImpl,
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    }
  });

  assert.equal(result.state, "valid");
  assert.equal(requests, 4);
  assert.deepEqual(delays, [10_000, 30_000, 60_000]);
});

test("keeps a repeatedly rate-limited link out of the dead-link list", async () => {
  const result = await checkLink("https://drive.google.com/file/d/example/view", {
    concurrency: 1,
    timeoutMs: 1_000,
    sampleBytes: 1_024,
    retryRateLimits: true,
    fetchImpl: (async () =>
      new Response(null, {
        status: 429,
        statusText: "Too Many Requests"
      })) as typeof fetch,
    sleep: async () => undefined
  });

  assert.equal(result.state, "review");
  assert.equal(result.reason, "429 rate limited");
});

test("adds randomized pacing between sequential link checks", async () => {
  const delays: number[] = [];
  const results = await checkLinks(
    ["https://example.com/one", "https://example.com/two"],
    {
      concurrency: 1,
      timeoutMs: 1_000,
      sampleBytes: 1_024,
      delayMs: 3_000,
      jitterMs: 1_000,
      random: () => 0.5,
      fetchImpl: (async () =>
        new Response(null, { status: 200, statusText: "OK" })) as typeof fetch,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      }
    }
  );

  assert.equal(results.size, 2);
  assert.deepEqual(delays, [3_500, 3_500]);
});
