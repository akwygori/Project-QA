import dotenv from 'dotenv';
import path from 'path';
import { CrawlConfig } from './types.js';

dotenv.config();

export function urlToOutputDirName(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
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
  const targetUrl = overrides.baseUrl || process.env.TARGET_URL || 'https://example.com';
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

  return {
    baseUrl: targetUrl,
    siteName,
    maxPages: overrides.maxPages ?? Number(process.env.MAX_PAGES || 15),
    maxDepth: overrides.maxDepth ?? Number(process.env.MAX_DEPTH || 2),
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
    timeoutMs: overrides.timeoutMs ?? Number(process.env.TIMEOUT_MS || 30000),
    delayBetweenPagesMs: overrides.delayBetweenPagesMs ?? Number(process.env.DELAY_MS || 1000),
    excludePatterns: [
      'logout',
      'signout',
      'auth/logout',
      '\\.pdf$',
      '\\.zip$',
      '\\.tar$',
      '\\.gz$',
      '\\.mp4$',
      '\\.mp3$',
      'mailto:',
      'tel:',
      'javascript:',
      '#.*',
    ],
    outputDir,
    customUrls: overrides.customUrls,
    headless: overrides.headless ?? (process.env.HEADLESS !== 'false'),
    annotateAlt: overrides.annotateAlt ?? (process.env.ANNOTATE_ALT !== 'false'),
  };
}
