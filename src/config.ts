import dotenv from 'dotenv';
import path from 'path';
import { CrawlConfig } from './types.js';

dotenv.config();

function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value.trim() === '') return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  return defaultValue;
}

function parseNumberEnv(value: string | undefined, fallback: number): number {
  if (!value || value.trim() === '') return fallback;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function ensureAbsoluteUrl(urlStr: string): string {
  const trimmed = (urlStr || '').trim();
  if (!trimmed) return 'https://example.com';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function urlToOutputDirName(urlStr: string): string {
  try {
    const safeUrl = ensureAbsoluteUrl(urlStr);
    const parsed = new URL(safeUrl);
    let host = parsed.hostname.replace(/^www\./, '');
    if (parsed.port) {
      host += `_${parsed.port}`;
    }
    const cleanPath = parsed.pathname.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9_-]/g, '_');
    if (cleanPath) {
      return `${host}_${cleanPath}`;
    }
    return host || 'target_site';
  } catch {
    return 'target_site';
  }
}

export function getDefaultConfig(overrides: Partial<CrawlConfig> = {}): CrawlConfig {
  const rawTargetUrl = overrides.baseUrl || process.env.TARGET_URL || 'https://example.com';
  const targetUrl = ensureAbsoluteUrl(rawTargetUrl);
  let siteName = overrides.siteName || process.env.SITE_NAME || '';

  if (!siteName) {
    try {
      const parsed = new URL(targetUrl);
      siteName = parsed.hostname.replace(/^www\./, '');
    } catch {
      siteName = 'Target Website';
    }
  }

  const baseOutputDir = process.env.OUTPUT_BASE_DIR || 'output';
  const siteFolderName = urlToOutputDirName(targetUrl);

  let outputDir: string;
  if (overrides.outputDir) {
    outputDir = path.isAbsolute(overrides.outputDir)
      ? overrides.outputDir
      : path.resolve(process.cwd(), overrides.outputDir);
  } else if (process.env.OUTPUT_DIR && process.env.OUTPUT_DIR !== 'output' && process.env.OUTPUT_DIR !== './output') {
    outputDir = path.isAbsolute(process.env.OUTPUT_DIR)
      ? process.env.OUTPUT_DIR
      : path.resolve(process.cwd(), process.env.OUTPUT_DIR);
  } else {
    outputDir = path.resolve(process.cwd(), baseOutputDir, siteFolderName);
  }

  const envHeadless = process.env.HEADLESS ?? process.env.headless;
  const envAnnotateAlt = process.env.ANNOTATE_ALT ?? process.env.annotate_alt;
  const envCheckQuality = process.env.CHECK_IMAGE_QUALITY ?? process.env.check_image_quality;

  return {
    baseUrl: targetUrl,
    siteName,
    maxPages: overrides.maxPages ?? parseNumberEnv(process.env.MAX_PAGES, 15),
    maxDepth: overrides.maxDepth ?? parseNumberEnv(process.env.MAX_DEPTH, 2),
    viewports: [
      {
        name: 'desktop',
        width: 1920,
        height: 1080,
        isMobile: false,
        deviceScaleFactor: 1,
      },
      {
        name: 'mobile',
        width: 375,
        height: 844,
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    ],
    fullPageScreenshot: overrides.fullPageScreenshot ?? true,
    timeoutMs: overrides.timeoutMs ?? parseNumberEnv(process.env.TIMEOUT_MS, 30000),
    delayBetweenPagesMs: overrides.delayBetweenPagesMs ?? parseNumberEnv(process.env.DELAY_MS, 1000),
    excludePatterns: [
      'logout',
      'signout',
      'auth/logout',
      '\\.(pdf|zip|tar|gz|mp4|mp3|docx|xlsx|pptx|csv|xml|kml|json|svg|png|jpg|jpeg|webp)$',
      'mailto:',
      'tel:',
      'javascript:',
      '#.*',
    ],
    outputDir,
    customUrls: overrides.customUrls,
    headless: overrides.headless ?? parseBooleanEnv(envHeadless, true),
    annotateAlt: overrides.annotateAlt ?? parseBooleanEnv(envAnnotateAlt, true),
    checkImageQuality: overrides.checkImageQuality ?? parseBooleanEnv(envCheckQuality, true),
    minHdRatio: overrides.minHdRatio ?? parseNumberEnv(process.env.IMAGE_MIN_HD_RATIO, 1.9),
    maxOversizedRatio: overrides.maxOversizedRatio ?? parseNumberEnv(process.env.IMAGE_MAX_OVERSIZED_RATIO, 3.5),
    maxImageSizeKb: overrides.maxImageSizeKb ?? parseNumberEnv(process.env.IMAGE_MAX_SIZE_KB, 500),
    sitemapUrl: overrides.sitemapUrl || process.env.SITEMAP_URL || undefined,
    crawlMode: overrides.crawlMode,
  };
}
