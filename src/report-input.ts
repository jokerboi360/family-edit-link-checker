export function normalizeLinkKey(rawUrl: string): string {
  const cleaned = rawUrl.trim().replace(/^<|>$/g, "");
  const driveId = cleaned.match(
    /https?:\/\/(?:drive|docs)\.google\.com\/(?:file\/)?d\/([^/?#)>]+)/i
  )?.[1];
  if (driveId) return `google-drive:${driveId}`;

  try {
    const url = new URL(cleaned);
    url.hash = "";
    return url.href;
  } catch {
    return cleaned;
  }
}

export function extractReportedBadLinks(markdown: string): string[] {
  const links: string[] = [];
  const pattern = /^-\s+\*\*Link:\*\*\s+<(.+)>$/gm;

  for (const match of markdown.matchAll(pattern)) {
    const link = match[1]?.trim();
    if (link) links.push(link);
  }

  return [...new Map(links.map((link) => [normalizeLinkKey(link), link])).values()];
}
