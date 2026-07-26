# Family Edit Center Link Checker

Checks every letter of the Family Edit Center movie catalog and reports dead
links with the correct movie title and `data-track-editor` value.

The checker processes one catalog page at a time, follows each movie link with
a real HTTP request, and recognizes ordinary failures plus common Google Drive
“gone” and access-denied pages. Temporary failures and rate limits are marked
for review instead of being reported as dead.

## Setup

Install Node.js 20 or newer, then run:

```sh
pnpm install
pnpm exec playwright install chromium
```

## Run

```sh
pnpm check
```

The default page is `https://familyeditcenter.netlify.app/#movies`. Reports are
written to `reports/`. The Markdown table contains only the date, movie title,
editor name, and bad link.

For a short report, you can instead copy paste-ready Discord text directly to
the clipboard:

```sh
pnpm check -- --copy
```

Useful options:

```sh
pnpm check -- --headed
pnpm check -- --concurrency 5 --timeout 30
pnpm check -- --concurrency 1 --request-delay 3000 --request-jitter 1000 --retry-rate-limits
pnpm check -- --url https://example.com/#movies
pnpm check -- --fail-on-dead
```

`--fail-on-dead` exits with status 2 when definite dead links are found, which
is useful for scheduled or continuous-integration checks.

## Post directly to Discord

Create a webhook under **Discord Server Settings → Integrations → Webhooks**.
Copy `.env.example` to `.env`, replace the placeholder with the webhook URL,
then run:

```sh
pnpm check:discord
```

The webhook posts native Discord embeds. Each dead movie appears with its
title, editor, and visible link. Large reports are split into sequential
messages that stay inside Discord's limits. The webhook automatically retries
Discord rate limits and temporary server errors.

To test the webhook locally without checking the whole catalog, run:

```sh
pnpm run check:discord:test
```

This checks only the first two catalog pages and labels the Discord embed and saved
report as `TESTING`. It does not change the normal checker or scheduled job.

Never commit `.env` or paste the webhook URL into code. A webhook URL is a
secret because anyone who has it can post to that channel.

## Run automatically with GitHub Actions

The included workflow runs every Monday at 9:15 AM Eastern Time. It can also be
started manually from the repository's **Actions** tab.

After pushing this project to GitHub:

1. Open **Settings → Secrets and variables → Actions**.
2. Choose **New repository secret**.
3. Name it exactly `DISCORD_WEBHOOK_URL`.
4. Paste the Discord webhook URL as the secret value.
5. Open **Actions → Weekly Movie Link Check → Run workflow** for the first test.

The scheduled job installs Chromium, verifies the code, checks the catalog one
page at a time with conservative request pacing, and posts one final set of
Discord embeds. It sends only one link request at a time and waits a random
three to four seconds between links. If Google returns a `429` rate limit, it
waits approximately 10, 30, and 60 seconds before its three retries. A link
that remains rate-limited is marked “could not be verified,” never dead. The
secret is supplied only while the job runs.

This project is safe to keep public: `.env`, generated reports, browser output,
and dependency folders are excluded from Git. Do not manually add any of those
ignored files.

## Markdown output

```md
# Dead Movie Links as of July 25, 2026 (ET)

| Title | Editor | Link |
| --- | --- | --- |
| Example Movie | Sky65z | <https://example.com/dead-link> |
| Another Movie | Roadkillxp | <https://drive.google.com/example> |
```

Temporary failures such as timeouts, server errors, and rate limiting are kept
out of both the Markdown dead-link table and the Discord dead-link embeds.

## Rebuild a table from an existing report

If a previous run already found the dead links but missed titles or editors,
hydrate that report without rechecking any Drive links:

```sh
pnpm hydrate -- "/path/to/movie-link-report.md"
```

This reads the bad URLs, crawls the movie catalog one letter at a time, matches
the URLs to their movie cards, and writes one new title/editor/link Markdown
table in `reports/`. It does not make requests to the Drive URLs, so it avoids
Drive rate limiting.
