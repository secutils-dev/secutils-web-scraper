import { createHash } from 'node:crypto';
import { setTimeout as setTimeoutAsync } from 'timers/promises';

import jsonStableStringify from 'fast-json-stable-stringify';
import type { FastifyBaseLogger } from 'fastify';
import jsBeautify from 'js-beautify';
import type { Browser, JSHandle, Page, Response } from 'playwright';

import { createObjectHash } from '../../../utilities/index.js';
import type { ApiResult } from '../../api_result.js';
import type { ApiRouteParams } from '../../api_route_params.js';
import { Diagnostics } from '../../diagnostics.js';
import { DEFAULT_DELAY_MS, DEFAULT_TIMEOUT_MS } from '../constants.js';
import { type FetchedResource, FetchInterceptor } from '../fetch_interceptor.js';
import type { SecutilsWindow } from '../index.js';

// Maximum size of the content in bytes (200KB).
const MAX_CONTENT_SIZE_BYTES = 1024 * 200;

/**
 * Defines type of the input parameters.
 */
interface InputBodyParamsType {
  /**
   * URL to load web page content from.
   */
  url: string;

  /**
   * Number of milliseconds to wait until page enters "idle" state. Default is 10000ms.
   */
  timeout?: number;

  /**
   * Number of milliseconds to wait after page enters "idle" state. Default is 2000ms.
   */
  delay?: number;

  /**
   * Optional CSS selector to wait for before extracting content.
   */
  waitSelector?: string;

  /**
   * Optional web page content that has been extracted previously.
   */
  previousContent?: string;

  /**
   * Optional list of scripts (content) to inject into the page before extracting resources.
   */
  scripts?: {
    /**
     * A content for a function that accepts a previously saved web page "content", if available and returns a new one.
     * The function is supposed to return any JSON-serializable value that will be used as a new web page "content".
     */
    extractContent?: string;
  };

  /**
   * Optional list of HTTP headers that should be sent with the tracker requests.
   */
  headers?: Record<string, string>;
}

/**
 * Extracted web page content.
 */
interface OutputBodyType {
  timestamp: number;
  content: string;
}

export function registerWebPageContentGetRoutes({ server, cache, acquireBrowser }: ApiRouteParams) {
  return server.post<{ Body: InputBodyParamsType }>(
    '/api/web_page/content',
    {
      schema: {
        body: {
          url: { type: 'string' },
          waitSelector: { type: 'string' },
          previousContent: { type: 'string' },
          delay: { type: 'number' },
          scripts: {
            type: 'object',
            properties: {
              extractContent: { type: 'string' },
            },
          },
          headers: { type: 'object' },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              timestamp: { type: 'number' },
              content: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const cacheKey = createObjectHash(request.body);
      if (!cache.has(cacheKey)) {
        const browser = await acquireBrowser();
        const log = server.log.child({ provider: 'web_page_content_get' });
        try {
          const result = await getContent(browser, log, request.body);
          if (result.type === 'client-error') {
            log.error(`Cannot retrieve content for page "${request.body.url}" due to client error: ${result.error}`);
            await Diagnostics.screenshot(log, browser);
            return reply.code(400).send({ message: result.error });
          }

          cache.set(cacheKey, result.data);
          log.debug(`Successfully fetched content for page "${request.body.url}".`);
        } catch (err) {
          log.error(`Cannot retrieve content for page "${request.body.url}": ${Diagnostics.errorMessage(err)}`);
          await Diagnostics.screenshot(log, browser);
          return reply.code(500).send({
            message: `Cannot retrieve content for page "${request.body.url}". Check the server logs for more details.`,
          });
        }
      }

      return cache.get(cacheKey);
    },
  );
}

async function getContent(
  browser: Browser,
  log: FastifyBaseLogger,
  {
    url,
    waitSelector,
    timeout = DEFAULT_TIMEOUT_MS,
    delay = DEFAULT_DELAY_MS,
    scripts,
    previousContent,
    headers,
  }: InputBodyParamsType,
): Promise<ApiResult<OutputBodyType>> {
  const context = await browser.newContext({ extraHTTPHeaders: headers, bypassCSP: false });
  const page = await context.newPage();

  // Disable browser cache.
  const cdpSession = await context.newCDPSession(page);
  await cdpSession.send('Network.clearBrowserCache');
  await cdpSession.send('Network.setCacheDisabled', { cacheDisabled: true });

  const fetchInterceptor = new FetchInterceptor({ log, pageUrl: url, session: cdpSession });
  await fetchInterceptor.start();

  // Set up a proxy URL to load resources bypassing CORS and CSP.
  await page.route('**/proxy.secutils.dev/*', async (route) => {
    const response = await route.fetch({
      url: decodeURIComponent(new URL(route.request().url()).pathname.replace('/proxy.secutils.dev/', '')),
    });
    await route.fulfill({ response });
  });

  // Inject custom scripts if any.
  if (scripts?.extractContent) {
    log.debug(`[${url}] Adding "extractContent" function: ${scripts.extractContent}.`);
    await page.addInitScript({
      content: `self.__secutils = { async extractContent(previousContent, externalResources, responseHeaders) { 
        ${scripts.extractContent} }
      }`,
    });
  }

  page.on('console', (msg) => {
    if (msg.text().startsWith('[browser]')) {
      if (msg.type() === 'debug') {
        log.debug(msg.text());
      } else {
        log.error(msg.text());
      }
    } else if (msg.type() === 'trace') {
      log.error(msg.text());
    }
  });

  log.debug(`Fetching content for "${url}" (timeout: ${timeout}ms).`);
  let response: Response | null;
  try {
    response = await page.goto(url, { timeout });
    log.debug(`Page "${url}" is loaded.`);
  } catch (err) {
    const errorMessage = `Failed to load page "${url}": ${Diagnostics.errorMessage(err)}`;
    log.error(errorMessage);
    return { type: 'client-error', error: errorMessage };
  }

  if (waitSelector) {
    try {
      log.debug(`Waiting for selector "${waitSelector} (timeout: ${timeout}ms)".`);
      await page.waitForSelector(waitSelector, { timeout });
      log.debug(`Retrieved selector "${waitSelector}".`);
    } catch (err) {
      const errorMessage = `Failed to retrieve selector "${waitSelector}" for page "${url}": ${Diagnostics.errorMessage(
        err,
      )}`;
      log.error(errorMessage);
      return { type: 'client-error', error: errorMessage };
    }
  }

  log.debug(`Delaying content extraction for ${delay}ms.`);
  await setTimeoutAsync(delay);

  const timestamp = Math.floor(Date.now() / 1000);
  let extractedContent: string;
  try {
    const externalResources = await fetchInterceptor.stop();
    extractedContent = jsonStableStringify(
      scripts?.extractContent
        ? await extractContent(page, previousContent, externalResources, (await response?.allHeaders()) ?? {})
        : jsBeautify.html_beautify(await page.content()),
    );
  } catch (err) {
    log.error(`Failed to extract content for page "${url}: ${Diagnostics.errorMessage(err)}`);
    return { type: 'client-error', error: Diagnostics.errorMessage(err) };
  }

  const contentSize = Buffer.byteLength(extractedContent, 'utf8');
  if (contentSize > MAX_CONTENT_SIZE_BYTES) {
    log.error(
      `Extracted content for "${url}" is too large (size: ${contentSize} bytes, max: ${MAX_CONTENT_SIZE_BYTES} bytes).`,
    );
    extractedContent = jsonStableStringify(
      `Extracted content was too large (${contentSize} bytes) and has been replaced with the SHA-1 hash: ${createHash(
        'sha1',
      )
        .update(extractedContent)
        .digest('hex')}`,
    );
  } else {
    log.debug(`Successfully extracted content for "${url}" (${contentSize} bytes).`);
  }

  try {
    await page.close();
    await context.close();
    log.debug(`Closed page "${url}".`);
  } catch (err) {
    log.error(`Failed to close page "${url}": ${Diagnostics.errorMessage(err)}`);
  }

  return { type: 'success', data: { timestamp, content: extractedContent } };
}

async function extractContent(
  page: Page,
  previousContent: string | undefined,
  externalResources: FetchedResource[],
  responseHeaders: Record<string, string>,
): Promise<unknown> {
  const targetWindow = await page.evaluateHandle<Window>('window');
  return await page.evaluate(
    async ([targetWindow, previousContent, externalResources, responseHeaders]) => {
      const extractContent = targetWindow.__secutils?.extractContent;
      if (extractContent && typeof extractContent !== 'function') {
        console.error(`[browser] Invalid "extractContent" function: ${typeof extractContent}`);
      } else if (extractContent) {
        console.debug('[browser] Using custom "extractContent" function.');
      }

      try {
        return typeof extractContent === 'function'
          ? (await extractContent(
              previousContent !== undefined ? JSON.parse(previousContent) : previousContent,
              externalResources,
              responseHeaders,
            )) ?? null
          : null;
      } catch (err: unknown) {
        console.error(`[browser] Content extractor script has thrown an exception: ${(err as Error)?.message ?? err}.`);
        console.trace(err);

        throw new Error(`Content extractor script has thrown an exception: ${(err as Error)?.message ?? err}.`);
      }
    },
    [targetWindow as JSHandle<SecutilsWindow>, previousContent, externalResources, responseHeaders] as const,
  );
}
