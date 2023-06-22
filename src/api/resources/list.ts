import { createHash } from 'node:crypto';
import { setTimeout as setTimeoutAsync } from 'timers/promises';

import type { FastifyBaseLogger } from 'fastify';
import type { Browser } from 'playwright';

import type { Resource } from './resource.js';
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

/**
 * List of discovered resources.
 */
type OutputBodyType = {
  timestamp: number;
  scripts: Resource[];
  styles: Resource[];
};

const RESOURCES_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: { url: { type: 'string' }, digest: { type: 'string' }, size: { type: 'number' } },
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

  const externalResources = new Map<string, Resource & { resourceType: 'script' | 'stylesheet' }>();
  page.on('response', (response) => {
    const request = response.request();
    const resourceType = request.resourceType() as 'script' | 'stylesheet';
    if (
      request.isNavigationRequest() ||
      request.method() !== 'GET' ||
      (resourceType !== 'script' && resourceType !== 'stylesheet')
    ) {
      return;
    }

    response.body().then(
      (responseBody) => {
        log.debug(`Page loaded resource (${responseBody.byteLength} bytes): ${response.url()}.`);
        externalResources.set(response.url(), {
          url: response.url(),
          size: responseBody.byteLength,
          digest: createHash('sha256').update(responseBody).digest('hex'),
          resourceType,
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
    timestamp: Math.floor(Date.now() / 1000),
    scripts: [],
    styles: [],
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

      async function parseURL(url: string): Promise<{ url: string; extractedContent: string }> {
        if (url.startsWith('data:')) {
          // For `data:` URLs we should replace the actual content with `[REDACTED]` as it might be huge.
          return { url: url.split(',')[0] + ',[REDACTED]', extractedContent: url };
        }

        if (url.startsWith('blob:')) {
          // For `blob:` URLs we should fetch the actual content and replace object reference with `[REDACTED]`.
          return { url: 'blob:[REDACTED]', extractedContent: await (await fetch(url)).text() };
        }

        return { url, extractedContent: '' };
      }

      function isResourceValid(resource: Resource) {
        return resource.url || resource.digest || resource.size;
      }

      const scripts: Resource[] = [];
      for (const el of Array.from(targetWindow.document.querySelectorAll('script'))) {
        // We treat script content as a concatenation of `onload` handler and its inner content. For our purposes it
        // doesn't matter if the script is loaded from an external source or is inline. If later we figure out that
        // script content was also loaded from the external source (e.g. when `script` element has both `src` and
        // `innerHTML`) we'll re-calculate its digest and size.
        const { url, extractedContent } = await parseURL(el.src.trim());

        const scriptResource: Resource = url ? { url } : {};
        const scriptContent = (el.onload?.toString().trim() ?? '') + el.innerHTML.trim() + extractedContent;
        if (scriptContent) {
          const contentBlob = new Blob([scriptContent]);
          scriptResource.digest = contentBlob.size > 0 ? await calculateDigestHex(contentBlob) : '';
          scriptResource.size = contentBlob.size;
        }

        if (isResourceValid(scriptResource)) {
          scripts.push(scriptResource);
        }
      }

      const styles: Resource[] = [];
      for (const el of Array.from(targetWindow.document.querySelectorAll('link[rel=stylesheet]'))) {
        const { url, extractedContent } = await parseURL((el as HTMLLinkElement).href.trim());

        const styleResource: Resource = url ? { url } : {};
        const styleContent = extractedContent;
        if (styleContent) {
          const contentBlob = new Blob([styleContent]);
          styleResource.digest = contentBlob.size > 0 ? await calculateDigestHex(contentBlob) : '';
          styleResource.size = contentBlob.size;
        }

        if (isResourceValid(styleResource)) {
          styles.push(styleResource);
        }
      }

      for (const el of Array.from(targetWindow.document.querySelectorAll('style'))) {
        const contentBlob = new Blob([el.innerHTML]);
        if (contentBlob.size > 0) {
          styles.push({
            digest: await calculateDigestHex(contentBlob),
            size: contentBlob.size,
          });
        }
      }

      return { scripts, styles };
    }, targetWindow);

    result.scripts = scripts;
    result.styles = styles;

    log.debug(
      `Found the following resources for page "${url}": ` + `scripts - ${scripts.length}, styles - ${styles.length}.`,
    );
  } catch (err) {
    log.error(`Failed to extract resources for page "${url}: ${Diagnostics.errorMessage(err)}`);
    throw err;
  }

  const enhanceResourceMeta = (resource: Resource) => {
    if (!resource.url) {
      return resource;
    }

    const externalResourceData = externalResources.get(resource.url);
    if (!externalResourceData) {
      return resource;
    }
    externalResources.delete(resource.url);

    const digest =
      resource.digest && externalResourceData.digest
        ? createHash('sha256').update(resource.digest).update(externalResourceData.digest).digest('hex')
        : resource.digest || externalResourceData.digest;

    return {
      ...resource,
      digest,
      size: (resource.size ?? 0) + (externalResourceData.size ?? 0),
    };
  };

  log.debug(`Fetched ${externalResources.size} external resources.`);

  const scripts = result.scripts.map(enhanceResourceMeta);
  const styles = result.styles.map(enhanceResourceMeta);

  // Add remaining resources that browser recognized but we didn't extract.
  for (const externalResource of externalResources.values()) {
    const resourceCollection = externalResource.resourceType === 'stylesheet' ? styles : scripts;
    resourceCollection.push({
      url: externalResource.url,
      digest: externalResource.digest,
      size: externalResource.size,
    });
  }

  try {
    await page.close();
    log.debug(`Closed page "${url}".`);
  } catch (err) {
    log.error(`Failed to close page "${url}": ${Diagnostics.errorMessage(err)}`);
  }

  return { ...result, scripts, styles };
}
