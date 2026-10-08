import { Page } from 'playwright';

export function normalizeUrl(
  rawUrl: string,
  baseUrl: string,
  excludePatterns: string[] = [],
  preserveTrailingSlash: boolean = false
): string | null {
  try {
    const base = new URL(baseUrl);
    const resolved = new URL(rawUrl, base.origin);

    // Only allow http and https
    if (!['http:', 'https:'].includes(resolved.protocol)) {
      return null;
    }

    // Domain check: must belong to same domain or subdomain (handles www vs non-www)
    const normalizeHost = (h: string) => h.toLowerCase().replace(/^www\./, '');
    const baseHost = normalizeHost(base.hostname);
    const resolvedHost = normalizeHost(resolved.hostname);

    if (resolvedHost !== baseHost && !resolvedHost.endsWith(`.${baseHost}`)) {
      return null;
    }

    // Strip hash / anchor
    resolved.hash = '';

    // Normalize trailing slash (keep root / as is, remove trailing / for subpaths unless preserveTrailingSlash is true)
    let cleanUrl = resolved.toString();
    if (!preserveTrailingSlash && resolved.pathname !== '/' && cleanUrl.endsWith('/')) {
      cleanUrl = cleanUrl.slice(0, -1);
    }

    // Check exclude patterns
    for (const pattern of excludePatterns) {
      const reg = new RegExp(pattern, 'i');
      if (reg.test(cleanUrl) || reg.test(resolved.pathname)) {
        return null;
      }
    }

    return cleanUrl;
  } catch {
    return null;
  }
}

export function urlToPageName(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    let pathPart = parsed.pathname.replace(/^\/|\/$/g, '').replace(/[^a-zA-Z0-9_-]/g, '-');
    if (!pathPart) {
      pathPart = 'home';
    }
    if (parsed.search) {
      const searchPart = parsed.search.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 30);
      pathPart += `-${searchPart}`;
    }
    return pathPart;
  } catch {
    return 'page';
  }
}

export async function extractLinksFromPage(
  page: Page,
  baseUrl: string,
  excludePatterns: string[]
): Promise<string[]> {
  try {
    const rawHrefs = await page.$$eval('a[href]', (elements) =>
      elements.map((el) => (el as HTMLAnchorElement).href)
    );

    const validLinks = new Set<string>();
    for (const href of rawHrefs) {
      const normalized = normalizeUrl(href, baseUrl, excludePatterns);
      if (normalized) {
        validLinks.add(normalized);
      }
    }

    return Array.from(validLinks);
  } catch {
    return [];
  }
}
