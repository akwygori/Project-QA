import { test, expect } from '@playwright/test';
import { normalizeUrl, urlToPageName } from '../src/crawler.js';
import { ensureAbsoluteUrl, urlToOutputDirName } from '../src/config.js';

test.describe('Crawler Unit Tests', () => {
  test('normalizeUrl properly validates, strips hash, and respects same-domain rule', () => {
    const baseUrl = 'https://example.com';

    // Same domain valid link
    expect(normalizeUrl('/about', baseUrl)).toBe('https://example.com/about');
    expect(normalizeUrl('https://example.com/contact#form', baseUrl)).toBe('https://example.com/contact');

    // Subdomain handling
    expect(normalizeUrl('https://sub.example.com/page', baseUrl)).toBe('https://sub.example.com/page');

    // External domain rejected
    expect(normalizeUrl('https://otherdomain.com/page', baseUrl)).toBeNull();

    // Invalid protocols rejected
    expect(normalizeUrl('javascript:void(0)', baseUrl)).toBeNull();
    expect(normalizeUrl('mailto:test@example.com', baseUrl)).toBeNull();

    // Exclude patterns
    expect(normalizeUrl('/wp-admin/post.php', baseUrl, ['wp-admin'])).toBeNull();
  });

  test('urlToPageName generates safe sanitized slugs', () => {
    expect(urlToPageName('https://example.com')).toBe('home');
    expect(urlToPageName('https://example.com/')).toBe('home');
    expect(urlToPageName('https://example.com/about-us/')).toBe('about-us');
    expect(urlToPageName('https://example.com/search?q=test')).toBe('search-q-test');
  });

  test('ensureAbsoluteUrl and urlToOutputDirName work correctly', () => {
    expect(ensureAbsoluteUrl('example.com')).toBe('https://example.com');
    expect(ensureAbsoluteUrl('http://insecure.com')).toBe('http://insecure.com');
    expect(urlToOutputDirName('https://example.com/sub/path')).toBe('example.com_sub_path');
  });
});
