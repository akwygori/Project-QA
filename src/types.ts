export interface ViewportConfig {
  width: number;
  height: number;
  isMobile?: boolean;
  hasTouch?: boolean;
  deviceScaleFactor?: number;
  name: string;
}

export interface SitemapGroup {
  name: string;
  url: string;
  urls: string[];
}

export interface SitemapGroupSummary {
  name: string;
  url: string;
  count: number;
}

export type ImageQualityStatus = 'HD' | 'SD' | 'BLURRY' | 'OVERSIZED' | 'DISTORTED' | 'VECTOR';

export interface CrawlConfig {
  baseUrl: string;
  siteName: string;
  maxPages: number;
  maxDepth: number;
  viewports: ViewportConfig[];
  fullPageScreenshot: boolean;
  timeoutMs: number;
  delayBetweenPagesMs: number;
  excludePatterns: string[];
  outputDir: string;
  customUrls?: string[];
  headless: boolean;
  annotateAlt?: boolean;
  checkImageQuality?: boolean;
  minHdRatio?: number;
  maxOversizedRatio?: number;
  maxImageSizeKb?: number;
  sitemapUrl?: string;
  selectedSubSitemap?: string;
  sitemapGroups?: SitemapGroupSummary[];
  crawlMode?: 'sitemap-all' | 'sitemap-partial' | 'sitemap-group' | 'bfs' | 'custom-urls';
}

export interface ImageInfo {
  src: string;
  alt: string | null;
  hasAlt: boolean;
  isEmptyAlt: boolean;
  width: number;
  height: number;
  naturalWidth?: number;
  naturalHeight?: number;
  densityRatio?: number;
  effectiveDprRatio?: number;
  aspectRatioMismatch?: boolean;
  aspectRatioDeltaPct?: number;
  fileSizeBytes?: number;
  fileFormat?: string;
  hasExplicitDimensions?: boolean;
  qualityStatus?: ImageQualityStatus;
  elementId?: string;
  className?: string;
}

export type ImageQualityAuditItem = ImageInfo;

export interface ImageAudit {
  totalImages: number;
  withAlt: number;
  missingAlt: number;
  emptyAlt: number;
  retinaHdCount?: number;
  standardResCount?: number;
  blurryCount?: number;
  oversizedCount?: number;
  distortedCount?: number;
  missingDimensionsCount?: number;
  images: ImageInfo[];
}

export interface CTAInfo {
  text: string;
  href: string;
  type: string;
  selector?: string;
  rel?: string;
  followStatus?: 'DOFOLLOW' | 'NOFOLLOW';
  status?: number;
  initialStatus?: number;
  statusText?: string;
  isRedirect?: boolean;
  redirectUrl?: string;
  condition?: string;
  is404: boolean;
  error?: string;
}

export interface CTAAudit {
  totalCTAs: number;
  validCTAs: number;
  brokenCTAs: number;
  dofollowCTAs?: number;
  nofollowCTAs?: number;
  success200CTAs?: number;
  redirect200CTAs?: number;
  failed404CTAs?: number;
  ctas: CTAInfo[];
}

export interface ConsoleLogEntry {
  type: 'error' | 'warning' | 'info' | 'log';
  text: string;
  location?: string;
  timestamp: string;
}

export interface NetworkErrorEntry {
  url: string;
  status?: number;
  statusText?: string;
  resourceType?: string;
  failureReason?: string;
  timestamp: string;
}

export interface PageScanResult {
  url: string;
  pageName: string;
  path: string;
  title: string;
  httpStatus: number;
  isSuccess: boolean;
  loadTimeMs: number;
  consoleErrors: ConsoleLogEntry[];
  consoleWarnings: ConsoleLogEntry[];
  unhandledJSErrors: string[];
  failedRequests: NetworkErrorEntry[];
  screenshots: {
    desktop?: string;
    mobile?: string;
  };
  discoveredLinks: string[];
  imageAudit: ImageAudit;
  ctaAudit: CTAAudit;
  pageTextSnippets?: string[];
}

export interface QAAuditSummary {
  siteName: string;
  baseUrl: string;
  scannedAt: string;
  totalPages: number;
  pagesWithErrors: number;
  totalConsoleErrors: number;
  totalNetworkErrors: number;
  totalImages: number;
  totalMissingAlt: number;
  totalEmptyAlt: number;
  totalRetinaHdImages?: number;
  totalStandardResImages?: number;
  totalBlurryImages?: number;
  totalOversizedImages?: number;
  totalDistortedImages?: number;
  totalCTAs: number;
  totalBrokenCTAs: number;
  sitemapFound?: boolean;
  sitemapUrl?: string;
  totalSitemapUrls?: number;
  selectedSubSitemap?: string;
  sitemapGroups?: SitemapGroupSummary[];
  crawlMode?: 'sitemap-all' | 'sitemap-partial' | 'sitemap-group' | 'bfs' | 'custom-urls';
  results: PageScanResult[];
}

