export interface ViewportConfig {
  width: number;
  height: number;
  isMobile?: boolean;
  hasTouch?: boolean;
  deviceScaleFactor?: number;
  name: string;
}

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
}

export interface ImageInfo {
  src: string;
  alt: string | null;
  hasAlt: boolean;
  isEmptyAlt: boolean;
  width: number;
  height: number;
  elementId?: string;
  className?: string;
}

export interface ImageAudit {
  totalImages: number;
  withAlt: number;
  missingAlt: number;
  emptyAlt: number;
  images: ImageInfo[];
}

export interface CTAInfo {
  text: string;
  href: string;
  type: string;
  selector?: string;
  status?: number;
  statusText?: string;
  is404: boolean;
  error?: string;
}

export interface CTAAudit {
  totalCTAs: number;
  validCTAs: number;
  brokenCTAs: number;
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
  totalCTAs: number;
  totalBrokenCTAs: number;
  results: PageScanResult[];
}

