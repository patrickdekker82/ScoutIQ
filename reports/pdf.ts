import { getConfig } from '@/lib/config';
import { logger } from '@/lib/logger';

/**
 * PDF generation (§51).
 *
 * Playwright renders the report HTML to a real A4 PDF - vector text, selectable
 * and searchable, with page numbers in the footer. Explicitly NOT a screenshot.
 *
 * Playwright is imported lazily so the web process never loads it unless a PDF
 * is actually requested, and so an installation without browsers can still run
 * everything else (PDF_ENABLED=false).
 */

export interface PdfOptions {
  headerText?: string;
  footerText?: string;
  landscape?: boolean;
}

export class PdfUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfUnavailableError';
  }
}

export async function htmlToPdf(html: string, options: PdfOptions = {}): Promise<Buffer> {
  const config = getConfig();
  if (!config.reports.pdfEnabled) {
    throw new PdfUnavailableError('PDF generation is disabled (PDF_ENABLED=false)');
  }

  let chromium: typeof import('playwright').chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (error) {
    throw new PdfUnavailableError(
      'Playwright is not installed in this environment. Install it, or generate ' +
        'reports from the worker container which bundles it.',
    );
  }

  // PDF_BROWSER_EXECUTABLE lets an operator point at a system Chromium rather
  // than Playwright's downloaded build - useful on a locked-down VM.
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    ...(config.reports.browserExecutable
      ? { executablePath: config.reports.browserExecutable }
      : {}),
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, {
      waitUntil: 'load',
      timeout: config.reports.pdfTimeoutMs,
    });

    const footer = options.footerText ?? config.reports.organisation;

    const pdf = await page.pdf({
      format: 'A4',
      landscape: options.landscape ?? false,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: `<div style="font-size:7pt;color:#94a3b8;width:100%;padding:0 14mm;">
        ${escapeHtml(options.headerText ?? '')}
      </div>`,
      footerTemplate: `<div style="font-size:7pt;color:#94a3b8;width:100%;padding:0 14mm;display:flex;justify-content:space-between;">
        <span>${escapeHtml(footer)}</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>`,
      margin: { top: '18mm', bottom: '20mm', left: '14mm', right: '14mm' },
    });

    logger.info({ bytes: pdf.length }, 'pdf rendered');
    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
