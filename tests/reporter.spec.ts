import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { QAReporter } from '../src/reporter.js';
import { CrawlConfig, PageScanResult } from '../src/types.js';

test.describe('QAReporter Unit & Output Tests', () => {
  test('generates accurate summary and all report files including issues.csv', () => {
    const testOutputDir = path.resolve(
      process.cwd(),
      'output',
      `test_audit_suite_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    );

    const dummyConfig: CrawlConfig = {
      baseUrl: 'https://example.com',
      siteName: 'Example Site',
      maxPages: 5,
      maxDepth: 1,
      viewports: [{ name: 'desktop', width: 1920, height: 1080 }],
      fullPageScreenshot: false,
      timeoutMs: 5000,
      delayBetweenPagesMs: 0,
      excludePatterns: [],
      outputDir: testOutputDir,
      headless: true,
    };

    const reporter = new QAReporter(dummyConfig);

    const dummyPage: PageScanResult = {
      url: 'https://example.com/test-page',
      pageName: 'test-page',
      path: '/test-page',
      title: 'Test Page Title',
      httpStatus: 200,
      isSuccess: true,
      loadTimeMs: 450,
      consoleErrors: [
        { type: 'error', text: 'Uncaught TypeError: test error', timestamp: new Date().toISOString() },
      ],
      consoleWarnings: [],
      unhandledJSErrors: [],
      failedRequests: [
        { url: 'https://example.com/missing.png', status: 404, statusText: 'Not Found', timestamp: new Date().toISOString() },
      ],
      screenshots: { desktop: 'test-desktop.png' },
      discoveredLinks: ['https://example.com/other'],
      imageAudit: {
        totalImages: 2,
        withAlt: 1,
        missingAlt: 1,
        emptyAlt: 0,
        images: [
          {
            src: 'https://example.com/img1.jpg',
            alt: null,
            hasAlt: false,
            isEmptyAlt: false,
            width: 300,
            height: 200,
            qualityStatus: 'BLURRY',
            densityRatio: 0.8,
          },
          {
            src: 'https://example.com/img2.jpg',
            alt: 'Hero banner',
            hasAlt: true,
            isEmptyAlt: false,
            width: 800,
            height: 400,
            qualityStatus: 'HD',
            densityRatio: 2.0,
          },
        ],
      },
      ctaAudit: {
        totalCTAs: 2,
        validCTAs: 1,
        brokenCTAs: 1,
        ctas: [
          {
            text: 'Book Consultation',
            href: 'https://example.com/broken-link',
            type: 'a',
            is404: true,
            status: 404,
            condition: '404 gagal',
          },
          {
            text: 'Home',
            href: 'https://example.com',
            type: 'a',
            is404: false,
            status: 200,
            condition: '200 success',
          },
        ],
      },
    };

    reporter.addResult(dummyPage);
    const summary = reporter.generateSummary();

    expect(summary.totalPages).toBe(1);
    expect(summary.pagesWithErrors).toBe(1);
    expect(summary.totalConsoleErrors).toBe(1);
    expect(summary.totalNetworkErrors).toBe(1);
    expect(summary.totalImages).toBe(2);
    expect(summary.totalMissingAlt).toBe(1);
    expect(summary.totalCTAs).toBe(2);
    expect(summary.totalBrokenCTAs).toBe(1);

    try {
      const saved = reporter.saveAllReports(12.5);

      expect(fs.existsSync(saved.jsonPath)).toBe(true);
      expect(fs.existsSync(saved.markdownPath)).toBe(true);
      expect(fs.existsSync(saved.aiPromptPath)).toBe(true);
      expect(fs.existsSync(saved.htmlReportPath)).toBe(true);
      expect(fs.existsSync(saved.csvPath)).toBe(true);

      const csvContent = fs.readFileSync(saved.csvPath, 'utf-8');
      expect(csvContent).toContain('Broken CTA / Link');
      expect(csvContent).toContain('Book Consultation');
      expect(csvContent).toContain('Missing Alt Text');
      expect(csvContent).toContain('Blurry Image');
      expect(csvContent).toContain('Failed Network Request');
    } finally {
      if (fs.existsSync(testOutputDir)) {
        fs.rmSync(testOutputDir, { recursive: true, force: true });
      }
    }
  });
});
