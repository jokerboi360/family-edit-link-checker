import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { crawlMoviePages } from "../src/crawl.js";
import type { MovieLink } from "../src/types.js";

test("dismisses the gate and yields one alphabetic page at a time", async () => {
  const url = pathToFileURL(resolve("tests/fixtures/movies.html")).href;
  const batches: MovieLink[][] = [];
  const pagesProcessed = await crawlMoviePages(
    {
      url,
      headless: true,
      maxPages: 5,
      settleMs: 20
    },
    async (links) => {
      batches.push(links);
    }
  );
  const links = batches.flat();

  assert.equal(pagesProcessed, 3);
  assert.deepEqual(batches.map((batch) => batch.length), [1, 1, 1]);
  assert.deepEqual(
    links.map(({ movie, editor, url: linkUrl, page }) => ({
      movie,
      editor,
      url: linkUrl,
      page
    })),
    [
      {
        movie: "First Movie",
        editor: "Editor One",
        url: "https://example.com/first",
        page: 1
      },
      {
        movie: "Second Movie",
        editor: "Editor Two",
        url: "https://example.com/second",
        page: 2
      },
      {
        movie: "Third Movie",
        editor: "Editor Three",
        url: "https://example.com/third",
        page: 3
      }
    ]
  );
});
