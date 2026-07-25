import assert from "node:assert/strict";
import test from "node:test";
import {
  extractReportedBadLinks,
  normalizeLinkKey
} from "../src/report-input.js";

test("extracts and deduplicates bad links from an old Markdown report", () => {
  const report = `
## Dead links

- **Link:** <https://drive.google.com/file/d/abc123/view?usp=sharing>
- **Link:** <https://drive.google.com/file/d/abc123/view?usp=drivesdk>
- **Link:** <https://example.com/dead>
`;

  assert.deepEqual(extractReportedBadLinks(report), [
    "https://drive.google.com/file/d/abc123/view?usp=drivesdk",
    "https://example.com/dead"
  ]);
});

test("matches Google Drive URLs by file id despite formatting differences", () => {
  assert.equal(
    normalizeLinkKey("https://drive.google.com/file/d/abc123/view)>"),
    normalizeLinkKey("https://drive.google.com/file/d/abc123/view?usp=sharing")
  );
});
