import { normalizeUrl } from './crawler.js';
import { SitemapGroup } from './types.js';

export interface SitemapDetectionResult {
  found: boolean;
  sitemapUrl?: string;
  source?: 'robots.txt' | 'standard' | 'index' | 'custom';
  subSitemaps?: string[];
  groups?: SitemapGroup[];
  urls: string[];
  error?: string;
}

function extractLocsFromXml(xmlText: string): string[] {
  const locRegex = /<loc>(?:<!\[CDATA\[)?\s*(https?:\/\/[^<\s\]]+)\s*(?:\]\]>)?<\/loc>/gi;
  const urls: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = locRegex.exec(xmlText)) !== null) {
    let raw = match[1].trim().replace(/&amp;/g, '&');
    if (raw) {
      urls.push(raw);
    }
  }
  return urls;
}

async function fetchXml(url: string, timeoutMs: number = 8000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 PlaywrightQABot/1.0',
        Accept: 'text/xml, application/xml, application/xhtml+xml, text/html;q=0.9, text/plain;q=0.8, */*;q=0.5',
      },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });

    if (!res.ok) return null;
    const text = await res.text();
    // Validate if response actually looks like XML or sitemap
    if (text.includes('<loc') || text.includes('<sitemap') || text.includes('<urlset')) {
      return text;
    }
    return null;
  } catch {
    return null;
  }
}

async function findSitemapsInRobotsTxt(origin: string): Promise<string[]> {
  try {
    const robotsUrl = `${origin}/robots.txt`;
    const res = await fetch(robotsUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 PlaywrightQABot/1.0',
      },
      signal: AbortSignal.timeout(6000),
      redirect: 'follow',
    });
    if (!res.ok) return [];
    const text = await res.text();
    const sitemaps: string[] = [];
    const regex = /^\s*Sitemap:\s*(https?:\/\/[^\s\r\n]+)/gim;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      sitemaps.push(match[1].trim());
    }
    return sitemaps;
  } catch {
    return [];
  }
}

export async function detectSitemap(
  baseUrl: string,
  excludePatterns: string[] = [],
  customSitemapUrl?: string
): Promise<SitemapDetectionResult> {
  try {
    const parsedBase = new URL(baseUrl);
    const origin = parsedBase.origin;

    // 1. Check custom sitemap first if provided
    const customCandidates = customSitemapUrl ? [customSitemapUrl] : [];

    // 2. Check robots.txt for declared sitemaps
    const robotsCandidates = await findSitemapsInRobotsTxt(origin);

    // 3. Standard common sitemap locations
    const standardCandidates = [
      `${origin}/sitemap_index.xml`,
      `${origin}/sitemap.xml`,
      `${origin}/wp-sitemap.xml`,
      `${origin}/sitemap/sitemap.xml`,
    ];

    const allCandidates = Array.from(new Set([...customCandidates, ...robotsCandidates, ...standardCandidates]));

    for (const candidate of allCandidates) {
      const xml = await fetchXml(candidate);
      if (!xml) continue;

      const locs = extractLocsFromXml(xml);
      if (locs.length === 0) continue;

      const isIndex = xml.includes('<sitemapindex') || locs.some((u) => u.toLowerCase().endsWith('.xml'));
      const subSitemaps: string[] = [];
      const groups: SitemapGroup[] = [];
      const allValidUrls = new Set<string>();

      if (isIndex) {
        for (const loc of locs) {
          if (loc.toLowerCase().endsWith('.xml') || loc.includes('sitemap')) {
            subSitemaps.push(loc);
          }
        }

        // Fetch each sub-sitemap (limit to 25 sub-sitemaps to prevent runaway loops)
        const subsToFetch = subSitemaps.slice(0, 25);
        for (const sub of subsToFetch) {
          const subXml = await fetchXml(sub);
          if (!subXml) continue;

          const subLocs = extractLocsFromXml(subXml);
          const groupUrls: string[] = [];

          for (const subLoc of subLocs) {
            if (!subLoc.toLowerCase().endsWith('.xml')) {
              const norm = normalizeUrl(subLoc, baseUrl, excludePatterns, true);
              if (norm && !groupUrls.includes(norm)) {
                groupUrls.push(norm);
                allValidUrls.add(norm);
              }
            }
          }

          if (groupUrls.length > 0) {
            let groupName = 'sub-sitemap';
            try {
              const parsedSub = new URL(sub);
              groupName = parsedSub.pathname.split('/').pop() || sub;
            } catch {
              groupName = sub;
            }
            groups.push({
              name: groupName,
              url: sub,
              urls: groupUrls,
            });
          }
        }
      } else {
        // Single flat sitemap
        const groupUrls: string[] = [];
        for (const rawUrl of locs) {
          const norm = normalizeUrl(rawUrl, baseUrl, excludePatterns, true);
          if (norm && !groupUrls.includes(norm)) {
            groupUrls.push(norm);
            allValidUrls.add(norm);
          }
        }
        let groupName = 'sitemap.xml';
        try {
          groupName = new URL(candidate).pathname.split('/').pop() || 'sitemap.xml';
        } catch {}
        if (groupUrls.length > 0) {
          groups.push({
            name: groupName,
            url: candidate,
            urls: groupUrls,
          });
        }
      }

      const finalUrls = Array.from(allValidUrls);
      if (finalUrls.length > 0) {
        const source: SitemapDetectionResult['source'] =
          candidate === customSitemapUrl
            ? 'custom'
            : robotsCandidates.includes(candidate)
              ? 'robots.txt'
              : isIndex
                ? 'index'
                : 'standard';

        return {
          found: true,
          sitemapUrl: candidate,
          source,
          subSitemaps: subSitemaps.length > 0 ? subSitemaps : undefined,
          groups: groups.length > 0 ? groups : undefined,
          urls: finalUrls,
        };
      }
    }

    return { found: false, urls: [] };
  } catch (err: any) {
    return { found: false, urls: [], error: err.message };
  }
}

// Direct execution support: tsx src/sitemap.ts [targetUrl] or node dist/sitemap.js [targetUrl]
if (process.argv[1] && /sitemap\.(ts|js)$/i.test(process.argv[1].replace(/\\/g, '/'))) {
  const urlIdx = process.argv.findIndex((a) => a === '-u' || a === '--url' || a === '-t' || a === '--target');
  const targetArg = urlIdx !== -1 && process.argv[urlIdx + 1] ? process.argv[urlIdx + 1] : process.argv.slice(2).find((a) => !a.startsWith('-'));
  const target = targetArg || process.env.TARGET_URL || 'https://example.com';
  console.log(`🔍 Mendeteksi sitemap untuk: ${target}...`);
  detectSitemap(target).then((res) => {
    if (res.found) {
      console.log(`\n======================================================`);
      console.log(`✅ Sitemap Ditemukan!`);
      console.log(`📍 URL Sitemap : ${res.sitemapUrl}`);
      console.log(`🏷️  Sumber      : ${res.source}`);
      if (res.groups && res.groups.length > 0) {
        console.log(`\n📑 Kelompok Sub-Sitemap (${res.groups.length} kelompok terdeteksi):`);
        res.groups.forEach((g, idx) => {
          console.log(`   [${idx + 1}] ${g.name} (${g.urls.length} halaman)`);
          console.log(`       ↳ URL: ${g.url}`);
        });
      }
      console.log(`\n🔗 Total URL Unik : ${res.urls.length} halaman valid`);
      console.log(`======================================================\n`);
    } else {
      console.log(`❌ Sitemap tidak ditemukan.`);
    }
  });
}

