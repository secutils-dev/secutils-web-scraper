import { createHash } from 'node:crypto';
import { setTimeout as setTimeoutAsync } from 'timers/promises';

import type { FastifyBaseLogger } from 'fastify';
import type { Browser } from 'playwright';

import type { ExternalResource, InlineResource } from './resource.js';
import type { APIRouteParams } from '../api_route_params.js';
import { Diagnostics } from '../diagnostics.js';

/**
 * Default timeout for the page load, in ms.
 */
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Default delay to wait after page load, in ms.
 */
const DEFAULT_DELAY_MS = 2000;

/**
 * Defines type of the input parameters.
 */
interface InputBodyParamsType {
  /**
   * URL to load resources from.
   */
  url: string;

  /**
   * Number of milliseconds to wait until page enters "idle" state. Default is 5000ms.
   */
  timeout?: number;

  /**
   * Number of milliseconds to wait after page enters "idle" state. Default is 2000ms.
   */
  delay?: number;

  /**
   * Optional CSS selector to wait for before extracting resources.
   */
  waitSelector?: string;
}

export interface ResourceBundle {
  external: ExternalResource[];
  inline: InlineResource[];
}

/**
 * List of discovered resources.
 */
type OutputBodyType = {
  timestamp: number;
  scripts: ResourceBundle;
  styles: ResourceBundle;
};

const RESOURCES_SCHEMA = {
  type: 'object',
  properties: {
    external: {
      type: 'array',
      items: {
        type: 'object',
        properties: { src: { type: 'string' }, digest: { type: 'string' }, size: { type: 'number' } },
      },
    },
    inline: {
      type: 'array',
      items: { type: 'object', properties: { digest: { type: 'string' }, size: { type: 'number' } } },
    },
  },
};

export function registerResourcesListRoutes({ server, cache, acquireBrowser }: APIRouteParams) {
  return server.post<{ Body: InputBodyParamsType }>(
    '/api/resources',
    {
      schema: {
        body: { url: { type: 'string' }, delay: { type: 'number' } },
        response: {
          200: {
            type: 'object',
            properties: {
              timestamp: { type: 'number' },
              scripts: RESOURCES_SCHEMA,
              styles: RESOURCES_SCHEMA,
            },
          },
        },
      },
    },
    async (request, reply) => {
      const cacheKey = `${request.body.url}:${request.body.waitSelector ?? '-'}:${
        request.body.delay?.toString() ?? '-'
      }`;
      if (!cache.has(cacheKey)) {
        const browser = await acquireBrowser();
        const log = server.log.child({ provider: 'resources_list' });
        try {
          cache.set(cacheKey, await getResourcesList(browser, log, request.body));
          log.debug(`Successfully fetched resources for page "${request.body.url}".`);
        } catch (err) {
          log.error(`Cannot retrieve resources for page "${request.body.url}": ${Diagnostics.errorMessage(err)}`);
          await Diagnostics.screenshot(log, browser);
          return reply
            .code(500)
            .send(`Cannot retrieve resources for page "${request.body.url}". Check the server logs for more details.`);
        }
      }

      return cache.get(cacheKey);
    },
  );
}

async function getResourcesList(
  browser: Browser,
  log: FastifyBaseLogger,
  { url, waitSelector, timeout = DEFAULT_TIMEOUT_MS, delay = DEFAULT_DELAY_MS }: InputBodyParamsType,
): Promise<OutputBodyType> {
  const page = await browser.newPage();

  const externalResources = new Map<string, ExternalResource>();
  page.on('response', (response) => {
    response.body().then(
      (responseBody) => {
        log.debug(`Page loaded resource (${responseBody.byteLength} bytes): ${response.url()}.`);
        externalResources.set(response.url(), {
          src: response.url(),
          size: responseBody.byteLength,
          digest: createHash('sha256').update(responseBody).digest('hex'),
        });
      },
      (err) => {
        log.error(
          `Failed to fetch external resource "${response.url()}" body for page "${url}": ${Diagnostics.errorMessage(
            err,
          )}`,
        );
      },
    );
  });

  log.debug(`Fetching resources for "${url}" (timeout: ${timeout}ms).`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    log.debug(`Page "${url}" is loaded.`);
  } catch (err) {
    log.error(`Failed to load page "${url}": ${Diagnostics.errorMessage(err)}`);
    throw err;
  }

  if (waitSelector) {
    try {
      log.debug(`Waiting for selector "${waitSelector} (timeout: ${timeout}ms)".`);
      await page.waitForSelector(waitSelector, { timeout });
      log.debug(`Retrieved selector "${waitSelector}".`);
    } catch (err) {
      log.error(`Failed to retrieve selector "${waitSelector}" for page "${url}": ${Diagnostics.errorMessage(err)}`);
      throw err;
    }
  }

  log.debug(`Delaying resource extraction for ${delay}ms.`);
  await setTimeoutAsync(delay);

  const result: OutputBodyType = {
    timestamp: Date.now(),
    scripts: { external: [], inline: [] },
    styles: { external: [], inline: [] },
  };
  try {
    // Pass `window` handle as parameter to be able to shim/mock DOM APIs that aren't available in Node.js.
    const targetWindow = await page.evaluateHandle<Window>('window');
    const { scripts, styles } = await page.evaluate(async (targetWindow) => {
      async function calculateDigestHex(contentBlob: Blob) {
        const hashBuffer = await crypto.subtle.digest('SHA-256', await contentBlob.arrayBuffer());
        return Array.from(new Uint8Array(hashBuffer))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
      }

      const scripts: OutputBodyType['scripts'] = { external: [], inline: [] };
      for (const el of Array.from(targetWindow.document.querySelectorAll('script'))) {
        const src = el.src.trim();
        if (src) {
          scripts.external.push({ src });
        } else {
          const contentBlob = new Blob([el.innerHTML]);
          scripts.inline.push({
            digest: contentBlob.size > 0 ? await calculateDigestHex(contentBlob) : '',
            size: contentBlob.size,
          });
        }
      }

      const styles: OutputBodyType['styles'] = {
        external: Array.from(targetWindow.document.querySelectorAll('link[rel=stylesheet]')).map((el) => ({
          src: (el as HTMLLinkElement).href.trim(),
        })),
        inline: [],
      };

      for (const el of Array.from(targetWindow.document.querySelectorAll('style'))) {
        const contentBlob = new Blob([el.innerHTML]);
        styles.inline.push({
          digest: contentBlob.size > 0 ? await calculateDigestHex(contentBlob) : '',
          size: contentBlob.size,
        });
      }

      return { scripts, styles };
    }, targetWindow);

    result.scripts = scripts;
    result.styles = styles;

    log.debug(
      `Found the following resources for page "${url}": ` +
        `external scripts - ${scripts.external.length}, inline scripts - ${scripts.inline.length}, ` +
        `external styles - ${styles.external.length}, inline styles - ${styles.inline.length}.`,
    );
  } catch (err) {
    log.error(`Failed to extract resources for page "${url}: ${Diagnostics.errorMessage(err)}`);
    throw err;
  }

  const enhanceResourceMeta = (resource: ExternalResource) => {
    const externalResourceData = externalResources.get(resource.src);
    return !externalResourceData ? resource : { ...resource, ...externalResourceData };
  };

  try {
    await page.close();
    log.debug(`Closed page "${url}".`);
  } catch (err) {
    log.error(`Failed to close page "${url}": ${Diagnostics.errorMessage(err)}`);
  }

  // Replace external resources with additional data.
  log.debug(`Fetched ${externalResources.size} external resources.`);
  return {
    ...result,
    scripts: { ...result.scripts, external: result.scripts.external.map(enhanceResourceMeta) },
    styles: { ...result.styles, external: result.styles.external.map(enhanceResourceMeta) },
  };
}
