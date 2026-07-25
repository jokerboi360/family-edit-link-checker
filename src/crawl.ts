import { chromium, type Locator, type Page } from "playwright";
import type { CrawlOptions, MovieLink } from "./types.js";

const TRACK_LINK_SELECTOR = "[data-track-link]";

async function pageMarker(page: Page): Promise<string> {
  return page.evaluate((selector) => {
    const current =
      document.querySelector('[aria-current="page"]')?.textContent?.trim() ??
      document.querySelector(".pagination .active")?.textContent?.trim() ??
      "";

    const visibleLinks = [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((element) => element.offsetParent !== null)
      .map((element) => {
        const anchor =
          element instanceof HTMLAnchorElement
            ? element
            : element.closest("a") ?? element.querySelector("a");
        return `${element.getAttribute("data-track-link") ?? ""}|${anchor?.href ?? ""}`;
      })
      .join("\n");

    return `${location.href}|${current}|${visibleLinks}`;
  }, TRACK_LINK_SELECTOR);
}

async function extractMovieLinks(page: Page, pageNumber: number): Promise<MovieLink[]> {
  // A source string avoids build-tool helper functions leaking into the browser
  // execution context when this project is run directly from TypeScript.
  const browserScript = `(() => {
    const elements = [...document.querySelectorAll(${JSON.stringify(TRACK_LINK_SELECTOR)})];
    const clean = (value) => (value ?? "").replace(/\\s+/g, " ").trim();
    const cleanEditorName = (value) =>
      clean(value)
        .replace(/^[✎✏🖉]\\ufe0f?\\s*/, "")
        .replace(/^(?:editor\\s*:|edited\\s+by\\s*:?)[\\s]*/i, "")
        .split(/[·•|]/, 1)[0]
        ?.trim() ?? "";
    const isPlausibleEditorName = (value) => {
      const name = cleanEditorName(value);
      return Boolean(
        name &&
        name.length <= 80 &&
        !/^notes?/i.test(name) &&
        !/^(?:movies?|watch on drive|subtitle file|edit|editor|pencil)$/i.test(
          name
        ) &&
        !/(?:watch on drive|📅|→|politically correct|family edition|removed any uses)/i.test(
          name
        )
      );
    };
    const looksLikeUrl = (value) => /^(https?:\\/\\/|\\/\\/|\\/)/i.test(value);
    const pencilSelector = [
      '[data-lucide="pencil"]',
      '[data-icon*="pencil"]',
      '[aria-label*="pencil" i]',
      'svg[class*="pencil"]',
      'i[class*="pencil"]',
      ".fa-pencil"
    ].join(",");
    const getContainer = (element) => {
      const knownContainer = element.closest(
        [
          "[data-movie-title]",
          "[data-title]",
          "article",
          "tr",
          ".movie-card",
          ".movie-item",
          ".movie-entry",
          '[class*="movie-card"]',
          '[class*="movie_item"]',
          '[class*="movie-item"]',
          '[class*="movie-entry"]'
        ].join(",")
      );
      if (knownContainer) return knownContainer;

      let ancestor = element.parentElement;
      for (let depth = 0; ancestor && depth < 8; depth += 1) {
        if (
          ancestor.querySelector(pencilSelector) &&
          ancestor.querySelector(${JSON.stringify(TRACK_LINK_SELECTOR)})
        ) {
          return ancestor;
        }
        ancestor = ancestor.parentElement;
      }

      ancestor = element.parentElement;
      for (let depth = 0; ancestor && depth < 8; depth += 1) {
        const hasTitle = ancestor.querySelector(
          [
            "[data-movie-title]",
            ".movie-title",
            ".movie-name",
            ".title-text",
            '[class*="movie-title"]',
            '[class*="movie_title"]',
            '[class*="movie-name"]',
            '[class*="title"]',
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6"
          ].join(",")
        );
        if (hasTitle) return ancestor;
        ancestor = ancestor.parentElement;
      }
      return element.parentElement;
    };

    const getTitle = (element) => {
      const directTitle =
        element.getAttribute("data-movie-title") ??
        element.getAttribute("data-title");
      if (clean(directTitle)) return clean(directTitle);

      const container = getContainer(element);

      const containerTitle = container?.getAttribute("data-movie-title");
      if (clean(containerTitle)) return clean(containerTitle);

      const titleElement = container?.querySelector(
        [
          "[data-movie-title]",
          "h1",
          "h2",
          "h3",
          "h4",
          "h5",
          "h6",
          ".movie-title",
          ".movie-name",
          ".title-text",
          ".title",
          '[class*="movie-title"]',
          '[class*="movie_title"]',
          '[class*="movie-name"]',
          '[class*="title"]'
        ].join(",")
      );
      if (clean(titleElement?.textContent)) return clean(titleElement?.textContent);

      const posterAlt = container?.querySelector("img[alt]")?.getAttribute("alt");
      const posterTitle = clean(posterAlt).replace(/\\s+(?:movie\\s+)?poster$/i, "");
      if (posterTitle && !/^(?:poster|movie poster)$/i.test(posterTitle)) {
        return posterTitle;
      }

      if (container?.tagName === "TR") {
        const firstCell = container.querySelector("th, td");
        if (clean(firstCell?.textContent)) return clean(firstCell?.textContent);
      }

      const ariaLabel = element.getAttribute("aria-label");
      if (clean(ariaLabel)) return clean(ariaLabel);
      if (clean(element.textContent)) return clean(element.textContent);
      return "Unknown movie";
    };

    const getEditor = (element) => {
      const directEditor =
        element.getAttribute("data-track-editor") ??
        element.getAttribute("data-editor-name") ??
        element.getAttribute("data-editor");
      if (isPlausibleEditorName(directEditor)) return cleanEditorName(directEditor);

      const container = getContainer(element);

      const containerEditor =
        container?.getAttribute("data-track-editor") ??
        container?.getAttribute("data-editor-name") ??
        container?.getAttribute("data-editor");
      if (isPlausibleEditorName(containerEditor)) {
        return cleanEditorName(containerEditor);
      }

      const trackedEditorElement = container?.querySelector("[data-track-editor]");
      const trackedEditor =
        trackedEditorElement?.getAttribute("data-track-editor") ??
        trackedEditorElement?.textContent;
      if (isPlausibleEditorName(trackedEditor)) {
        return cleanEditorName(trackedEditor);
      }

      const pencils = container?.querySelectorAll(pencilSelector) ?? [];
      for (const pencil of pencils) {
        let pencilContainer = pencil.parentElement;
        for (let depth = 0; pencilContainer && depth < 4; depth += 1) {
          if (isPlausibleEditorName(pencilContainer.textContent)) {
            return cleanEditorName(pencilContainer.textContent);
          }
          pencilContainer = pencilContainer.parentElement;
        }
      }

      const rcEditors = container?.querySelectorAll(".rc-editor") ?? [];
      for (const rcEditor of rcEditors) {
        if (isPlausibleEditorName(rcEditor.textContent)) {
          return cleanEditorName(rcEditor.textContent);
        }
      }

      const editorElement = container?.querySelector(
        [
          "[data-editor-name]",
          "[data-editor]",
          ".editor-name",
          '[class*="editor-name"]',
          '[class*="editor_name"]'
        ].join(",")
      );
      const editorText = cleanEditorName(editorElement?.textContent);
      if (isPlausibleEditorName(editorText)) return editorText;

      const textCandidates = container?.querySelectorAll("p, span, div, dt, dd") ?? [];
      for (const candidate of textCandidates) {
        const text = clean(candidate.textContent);
        if (text.length > 200) continue;
        const match = text.match(/^(?:editor|edited\\s+by)\\s*:?\\s*(.+)$/i);
        if (match?.[1] && isPlausibleEditorName(match[1])) {
          return cleanEditorName(match[1]);
        }
      }

      return "Unknown editor";
    };

    const results = [];
    for (const element of elements) {
      const anchor =
        element instanceof HTMLAnchorElement
          ? element
          : element.closest("a") ?? element.querySelector("a");
      const trackedValue = clean(element.getAttribute("data-track-link"));
      const rawUrl = looksLikeUrl(trackedValue) ? trackedValue : anchor?.getAttribute("href");
      if (!rawUrl || /^(javascript:|mailto:|tel:|#)/i.test(rawUrl)) continue;

      try {
        results.push({
          movie: getTitle(element),
          editor: getEditor(element),
          url: new URL(rawUrl, document.baseURI).href,
          page: ${pageNumber}
        });
      } catch {
        // Ignore malformed link values and continue checking the rest of the page.
      }
    }
    return results;
  })()`;

  return page.evaluate(browserScript as unknown as () => MovieLink[]);
}

async function dismissAcknowledgementGate(page: Page): Promise<void> {
  const gate = page.locator("#ack-gate");
  if ((await gate.count()) === 0 || !(await gate.isVisible())) return;

  const checkboxes = gate.locator("input[type='checkbox']");
  const checkboxCount = await checkboxes.count();
  for (let index = 0; index < checkboxCount; index += 1) {
    const checkbox = checkboxes.nth(index);
    if (await checkbox.isVisible()) {
      await checkbox.setChecked(true);
    }
  }

  const controls = gate.locator("button, [role='button'], a");
  const controlCount = await controls.count();
  let fallback: Locator | null = null;

  for (let index = 0; index < controlCount; index += 1) {
    const control = controls.nth(index);
    if (!(await control.isVisible()) || !(await control.isEnabled())) continue;
    fallback ??= control;
    const label = await controlLabel(control);
    if (
      /\b(acknowledge|continue|enter|accept|agree|understand|got it|ok|proceed)\b/i.test(
        label
      )
    ) {
      await control.click({ timeout: 5_000 });
      await gate.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => undefined);
      return;
    }
  }

  if (fallback && controlCount === 1) {
    await fallback.click({ timeout: 5_000 });
    await gate.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => undefined);
    return;
  }

  const gateText = (await gate.innerText()).replace(/\s+/g, " ").trim().slice(0, 300);
  throw new Error(
    `The acknowledgement gate is still blocking pagination. Gate text: ${gateText}`
  );
}

async function isUsableNext(locator: Locator): Promise<boolean> {
  if (!(await locator.isVisible())) return false;

  return locator.evaluate((element) => {
    const htmlElement = element as HTMLElement;
    const disabled =
      (element instanceof HTMLButtonElement && element.disabled) ||
      element.getAttribute("aria-disabled") === "true" ||
      htmlElement.classList.contains("disabled") ||
      element.closest(".disabled, [aria-disabled='true']") !== null;
    return !disabled;
  });
}

async function controlLabel(locator: Locator): Promise<string> {
  return locator.evaluate((element) =>
    [
      element.textContent,
      element.getAttribute("aria-label"),
      element.getAttribute("title")
    ]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
  );
}

async function isCurrentPaginationControl(locator: Locator): Promise<boolean> {
  return locator.evaluate(
    (element) =>
      element.getAttribute("aria-current") === "page" ||
      element.matches(".active, .selected, [data-active='true']") ||
      element.closest(
        ".active, .selected, [aria-current='page'], [data-active='true']"
      ) !== null
  );
}

function paginationKey(label: string): string | null {
  const normalized = label.trim().toUpperCase();
  if (/^(#|[A-Z]|\d+)$/.test(normalized)) return normalized;

  const described = normalized.match(/(?:PAGE|LETTER)\s+(#|[A-Z]|\d+)\b/);
  return described?.[1] ?? null;
}

async function findNextControl(
  page: Page,
  visitedPaginationKeys: Set<string>
): Promise<Locator | null> {
  const stableSelectors = [
    '[data-page="next"]',
    '[data-pagination="next"]',
    'a[rel="next"]',
    'button[aria-label*="next" i]',
    'a[aria-label*="next" i]',
    'button[title*="next" i]',
    'a[title*="next" i]',
    ".pagination .next button",
    ".pagination .next a",
    "button.next",
    "a.next"
  ];

  for (const selector of stableSelectors) {
    const matches = page.locator(selector);
    const count = await matches.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = matches.nth(index);
      if (await isUsableNext(candidate)) return candidate;
    }
  }

  const paginationButtons = page.locator(
    [
      ".pagination button",
      '[aria-label*="pagination" i] button',
      'nav[aria-label*="pagination" i] button',
      "button"
    ].join(",")
  );
  const count = await paginationButtons.count();

  for (let index = 0; index < count; index += 1) {
    const candidate = paginationButtons.nth(index);
    const label = await controlLabel(candidate);
    if (/^(next|next page|›|»|→)$/.test(label) && (await isUsableNext(candidate))) {
      return candidate;
    }
  }

  const paginationContainers = page.locator(
    [
      ".pagination",
      '[class*="pagination"]',
      "[data-pagination]",
      'nav[aria-label*="page" i]',
      '[role="navigation"][aria-label*="page" i]'
    ].join(",")
  );
  const containerCount = await paginationContainers.count();

  for (let containerIndex = 0; containerIndex < containerCount; containerIndex += 1) {
    const controls = paginationContainers
      .nth(containerIndex)
      .locator("button, a, [role='button']");
    const controlCount = await controls.count();
    if (controlCount < 2) continue;

    const candidates: Array<{
      locator: Locator;
      key: string;
      current: boolean;
      usable: boolean;
    }> = [];

    for (let controlIndex = 0; controlIndex < controlCount; controlIndex += 1) {
      const candidate = controls.nth(controlIndex);
      const key = paginationKey(await controlLabel(candidate));
      if (!key) continue;
      candidates.push({
        locator: candidate,
        key,
        current: await isCurrentPaginationControl(candidate),
        usable: await isUsableNext(candidate)
      });
    }
    if (candidates.length < 2) continue;

    const currentIndex = candidates.findIndex((candidate) => candidate.current);
    if (currentIndex >= 0) {
      const current = candidates[currentIndex];
      if (current) visitedPaginationKeys.add(current.key);

      for (let index = currentIndex + 1; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        if (
          candidate &&
          candidate.usable &&
          !visitedPaginationKeys.has(candidate.key)
        ) {
          visitedPaginationKeys.add(candidate.key);
          return candidate.locator;
        }
      }
    }

    // Some custom paginators do not expose an active state. On the first page,
    // their first "#" or "1" control normally represents the page already shown.
    if (visitedPaginationKeys.size === 0) {
      const first = candidates[0];
      if (first && (first.key === "#" || first.key === "1")) {
        visitedPaginationKeys.add(first.key);
      }
    }

    const unvisited = candidates.find(
      (candidate) => candidate.usable && !visitedPaginationKeys.has(candidate.key)
    );
    if (unvisited) {
      visitedPaginationKeys.add(unvisited.key);
      return unvisited.locator;
    }
  }

  // Fall back to a document-wide alphabet strip. Some sites render "# A B C …"
  // inside an unlabeled wrapper, so there is no pagination class or navigation
  // role to target. Requiring both "#" and "A" keeps this from matching normal
  // site navigation.
  const allClickables = page.locator(
    "button, a, [role='button'], [tabindex='0'], [onclick]"
  );
  const clickableCount = await allClickables.count();
  const alphabetCandidates: Array<{
    locator: Locator;
    key: string;
    current: boolean;
    usable: boolean;
  }> = [];

  for (let index = 0; index < clickableCount; index += 1) {
    const candidate = allClickables.nth(index);
    const key = paginationKey(await controlLabel(candidate));
    if (!key || !/^(#|[A-Z])$/.test(key)) continue;
    alphabetCandidates.push({
      locator: candidate,
      key,
      current: await isCurrentPaginationControl(candidate),
      usable: await isUsableNext(candidate)
    });
  }

  const alphabetKeys = new Set(alphabetCandidates.map((candidate) => candidate.key));
  if (
    alphabetCandidates.length >= 3 &&
    alphabetKeys.has("#") &&
    alphabetKeys.has("A")
  ) {
    const current = alphabetCandidates.find((candidate) => candidate.current);
    if (current) visitedPaginationKeys.add(current.key);
    if (visitedPaginationKeys.size === 0) visitedPaginationKeys.add("#");

    const unvisited = alphabetCandidates.find(
      (candidate) => candidate.usable && !visitedPaginationKeys.has(candidate.key)
    );
    if (unvisited) {
      visitedPaginationKeys.add(unvisited.key);
      return unvisited.locator;
    }
  }

  return null;
}

async function paginationDiagnostics(page: Page): Promise<string> {
  const controls = page.locator(
    "button, a, [role='button'], [tabindex='0'], [onclick]"
  );
  const count = await controls.count();
  const samples: string[] = [];

  for (let index = 0; index < Math.min(count, 80); index += 1) {
    const control = controls.nth(index);
    if (!(await control.isVisible())) continue;
    const description = await control.evaluate((element) => {
      const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
      const aria = element.getAttribute("aria-label") ?? "";
      const title = element.getAttribute("title") ?? "";
      const id = element.id;
      const classes =
        element instanceof HTMLElement ? [...element.classList].join(".") : "";
      return [
        element.tagName.toLowerCase(),
        text ? `text="${text.slice(0, 40)}"` : "",
        aria ? `aria="${aria}"` : "",
        title ? `title="${title}"` : "",
        id ? `id="${id}"` : "",
        classes ? `class="${classes}"` : ""
      ]
        .filter(Boolean)
        .join(" ");
    });
    samples.push(description);
  }

  return samples.join(" | ");
}

export async function crawlMoviePages(
  options: CrawlOptions,
  onPage: (links: MovieLink[], pageNumber: number) => Promise<void>
): Promise<number> {
  const browser = await chromium.launch({ headless: options.headless });
  const context = await browser.newContext();
  const page = await context.newPage();
  const seenPageMarkers = new Set<string>();
  const visitedPaginationKeys = new Set<string>();
  let pagesProcessed = 0;

  try {
    await page.goto(options.url, {
      waitUntil: "domcontentloaded",
      timeout: 30_000
    });
    await dismissAcknowledgementGate(page);
    await page.locator(TRACK_LINK_SELECTOR).first().waitFor({
      state: "attached",
      timeout: 15_000
    });
    await page.waitForTimeout(options.settleMs);

    for (let pageNumber = 1; pageNumber <= options.maxPages; pageNumber += 1) {
      const marker = await pageMarker(page);
      if (seenPageMarkers.has(marker)) break;
      seenPageMarkers.add(marker);

      const links = await extractMovieLinks(page, pageNumber);
      await onPage(links, pageNumber);
      pagesProcessed = pageNumber;

      await dismissAcknowledgementGate(page);
      const next = await findNextControl(page, visitedPaginationKeys);
      if (!next) {
        if (pageNumber === 1) {
          console.warn(
            `No next pagination control was detected. Visible controls: ${await paginationDiagnostics(page)}`
          );
        }
        break;
      }

      const previousMarker = marker;
      await next.click();
      await page
        .waitForFunction(
          ({ selector, before }) => {
            const current =
              document.querySelector('[aria-current="page"]')?.textContent?.trim() ??
              document.querySelector(".pagination .active")?.textContent?.trim() ??
              "";
            const links = [...document.querySelectorAll<HTMLElement>(selector)]
              .filter((element) => element.offsetParent !== null)
              .map((element) => {
                const anchor =
                  element instanceof HTMLAnchorElement
                    ? element
                    : element.closest("a") ?? element.querySelector("a");
                return `${element.getAttribute("data-track-link") ?? ""}|${anchor?.href ?? ""}`;
              })
              .join("\n");
            return `${location.href}|${current}|${links}` !== before;
          },
          { selector: TRACK_LINK_SELECTOR, before: previousMarker },
          { timeout: 5_000 }
        )
        .catch(() => undefined);
      await page.waitForTimeout(options.settleMs);
    }
  } finally {
    await context.close();
    await browser.close();
  }

  return pagesProcessed;
}

export async function crawlMovieLinks(options: CrawlOptions): Promise<MovieLink[]> {
  const collected: MovieLink[] = [];
  await crawlMoviePages(options, async (links) => {
    collected.push(...links);
  });

  const unique = new Map<string, MovieLink>();
  for (const item of collected) {
    unique.set(`${item.movie}\u0000${item.url}`, item);
  }
  return [...unique.values()];
}
