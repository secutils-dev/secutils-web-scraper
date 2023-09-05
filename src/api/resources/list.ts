import { createHash } from 'node:crypto';
import { setTimeout as setTimeoutAsync } from 'timers/promises';

import type { FastifyBaseLogger } from 'fastify';
import type { Browser, JSHandle } from 'playwright';

import type { Resource, ResourceContent, ResourceContentData } from './resource.js';
import type { APIRouteParams } from '../api_route_params.js';
import { Diagnostics } from '../diagnostics.js';
import { tlsHash } from '../tls_hash.js';

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

  /**
   * Optional list of scripts (content) to inject into the page before extracting resources.
   */
  scripts?: {
    /**
     * A content for a function that accepts a resource object and returns `true` if the resource should be tracked, or
     * `false` if resource should be ignored.
     */
    includeResource?: string;
  };
}

/**
 * List of discovered resources.
 */
interface OutputBodyType {
  timestamp: number;
  scripts: Resource[];
  styles: Resource[];
}

export interface ResourceWithRawData {
  url?: string;
  rawData: string;
  resourceType: 'script' | 'stylesheet';
}

export interface SecutilsWindow extends Window {
  __secutils?: {
    includeResource?: (resource: ResourceWithRawData) => boolean;
  };
}

const RESOURCES_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      url: { type: 'string' },
      content: {
        type: 'object',
        properties: {
          digest: { type: 'string' },
          data: { type: 'object', properties: { type: { type: 'string' }, value: { type: 'string' } } },
          size: { type: 'number' },
        },
      },
    },
  },
};

export function registerResourcesListRoutes({ server, cache, acquireBrowser }: APIRouteParams) {
  return server.post<{ Body: InputBodyParamsType }>(
    '/api/resources',
    {
      schema: {
        body: {
          url: { type: 'string' },
          delay: { type: 'number' },
          scripts: {
            type: 'object',
            properties: {
              includeResource: { type: 'string' },
            },
          },
        },
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
  { url, waitSelector, timeout = DEFAULT_TIMEOUT_MS, delay = DEFAULT_DELAY_MS, scripts }: InputBodyParamsType,
): Promise<OutputBodyType> {
  const page = await browser.newPage();

  // Inject custom scripts if any.
  if (scripts?.includeResource) {
    log.debug(`[${url}] Adding "includeResource" function: ${scripts.includeResource}.`);
    await page.addInitScript({
      content: `self.__secutils = { includeResource(resource) { ${scripts.includeResource} } }`,
    });
  }

  page.on('console', (msg) => {
    if (msg.text().startsWith('[browser]')) {
      if (msg.type() === 'debug') {
        log.debug(msg.text());
      } else {
        log.error(msg.text());
      }
    }
  });

  const externalResources: Array<Omit<ResourceWithRawData, 'url'> & { url: string; processed: boolean }> = [];
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
        externalResources.push({
          url: response.url(),
          rawData: responseBody.toString('utf-8'),
          resourceType,
          processed: false,
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

  const result: OutputBodyType = {
    timestamp: Math.floor(Date.now() / 1000),
    scripts: [],
    styles: [],
  };

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

  let extractedResources: ResourceWithRawData[];
  try {
    // Pass `window` handle as parameter to be able to shim/mock DOM APIs that aren't available in Node.js.
    const targetWindow = await page.evaluateHandle<Window>('window');
    extractedResources = await page.evaluate(
      async ([targetWindow, externalResources]) => {
        async function parseURL(url: string): Promise<{ url: string; rawData: string }> {
          if (url.startsWith('data:')) {
            // For `data:` URLs we should replace the actual content the digest later.
            return { url: `${url.split(',')[0]},`, rawData: url };
          }

          if (url.startsWith('blob:')) {
            // For `blob:` URLs we should fetch the actual content and replace object reference with the digest later.
            return {
              url: 'blob:',
              // [BUG] There is a bug in Node.js 20.4.0 that doesn't properly handle `await response.text()` in tests.
              rawData: await fetch(url)
                .then((res) => res.body?.getReader().read())
                .then((res) => new TextDecoder().decode(res?.value)),
            };
          }

          return { url, rawData: '' };
        }

        function isResourceValid(resource: ResourceWithRawData) {
          return !!(resource.url || resource.rawData);
        }

        const resources: ResourceWithRawData[] = [];
        for (const el of Array.from(targetWindow.document.querySelectorAll('script'))) {
          // We treat script content as a concatenation of `onload` handler and its inner content. For our purposes it
          // doesn't matter if the script is loaded from an external source or is inline. If later we figure out that
          // script content was also loaded from the external source (e.g. when `script` element has both `src` and
          // `innerHTML`) we'll re-calculate its digest and size.
          const { url, rawData } = await parseURL(el.src.trim());

          const scriptResource: ResourceWithRawData = url
            ? { url, rawData, resourceType: 'script' }
            : { rawData, resourceType: 'script' };
          const scriptContent = (el.onload?.toString().trim() ?? '') + el.innerHTML.trim() + rawData;
          if (scriptContent) {
            const contentBlob = new Blob([scriptContent]);
            scriptResource.rawData = await contentBlob.text();
          }

          if (isResourceValid(scriptResource)) {
            resources.push(scriptResource);
          }
        }

        for (const el of Array.from(targetWindow.document.querySelectorAll('link[rel=stylesheet]'))) {
          const { url, rawData } = await parseURL((el as HTMLLinkElement).href.trim());

          const styleResource: ResourceWithRawData = url
            ? { url, rawData, resourceType: 'stylesheet' }
            : { rawData, resourceType: 'stylesheet' };
          const styleContent = rawData;
          if (styleContent) {
            const contentBlob = new Blob([styleContent]);
            styleResource.rawData = await contentBlob.text();
          }

          if (isResourceValid(styleResource)) {
            resources.push(styleResource);
          }
        }

        for (const el of Array.from(targetWindow.document.querySelectorAll('style'))) {
          const contentBlob = new Blob([el.innerHTML]);
          if (contentBlob.size > 0) {
            resources.push({
              resourceType: 'stylesheet',
              rawData: await contentBlob.text(),
            });
          }
        }

        // Some inline resources may also be loaded from external sources. We should combine them with the external.
        const externalResourcesMap = new Map(externalResources.map((resource) => [resource.url, resource]));
        const combinedResources = resources.map((resource: ResourceWithRawData) => {
          // Skip inline resources and resources that weren't fetched.
          const externalResource = resource.url ? externalResourcesMap.get(resource.url) : undefined;
          if (!externalResource) {
            return resource;
          }

          // Mark external resource as processed to not include it in the final output more than needed.
          if (!externalResource.processed) {
            externalResourcesMap.set(externalResource.url, { ...externalResource, processed: true });
          }

          return { ...resource, rawData: resource.rawData + externalResource.rawData };
        });

        // Add remaining resources that browser fetched, but we didn't process.
        for (const externalResource of externalResourcesMap.values()) {
          if (!externalResource.processed) {
            combinedResources.push(externalResource);
          }
        }

        const includeResource = targetWindow.__secutils?.includeResource;
        if (includeResource && typeof includeResource !== 'function') {
          console.error(`[browser] Invalid "includeResource" function: ${typeof includeResource}`);
        } else if (includeResource) {
          console.debug('[browser] Using custom "includeResource" function.');
        }

        try {
          return typeof includeResource === 'function'
            ? combinedResources.filter((resource) => {
                const includeResourceResult = includeResource(resource);
                if (!includeResourceResult) {
                  console.debug(`[browser] Skipping resource: ${resource.url ?? '<inline>'}`);
                }

                return includeResourceResult;
              })
            : combinedResources;
        } catch (err: unknown) {
          console.error(
            `[browser] Custom "includeResource" function has thrown an exception: ${(err as Error)?.message ?? err}.`,
          );

          throw err;
        }
      },
      [targetWindow as JSHandle<SecutilsWindow>, externalResources] as const,
    );
  } catch (err) {
    log.error(`Failed to extract resources for page "${url}: ${Diagnostics.errorMessage(err)}`);
    throw err;
  }

  log.debug(`Extracted ${extractedResources.length} resources for the page "${url}".`);

  for (const resourceWithRawData of extractedResources) {
    let content: ResourceContent | undefined = undefined;
    if (resourceWithRawData.rawData) {
      content = {
        data: createResourceContentData(log, resourceWithRawData.rawData),
        size: resourceWithRawData.rawData.length,
      };
    }

    let url: string | undefined = undefined;
    if (
      resourceWithRawData.url &&
      (resourceWithRawData.url.startsWith('data:') || resourceWithRawData.url.startsWith('blob:'))
    ) {
      // For data:/blob: URLs we should replace the actual content the digest.
      url = `${resourceWithRawData.url}[${content?.data.value ?? ''}]`;
    } else {
      url = resourceWithRawData.url;
    }

    if (url || content) {
      (resourceWithRawData.resourceType === 'script' ? result.scripts : result.styles).push(
        url && content ? { url, content } : url ? { url } : { content },
      );
    }
  }

  try {
    await page.close();
    log.debug(`Closed page "${url}".`);
  } catch (err) {
    log.error(`Failed to close page "${url}": ${Diagnostics.errorMessage(err)}`);
  }

  return result;
}

function createResourceContentData(log: FastifyBaseLogger, rawData: string): ResourceContentData {
  try {
    return { type: 'tlsh', value: tlsHash(rawData) };
  } catch (err) {
    // If data is too small, TLS hash will fail, but it's expected, and we shouldn't log this as an error.
    if (rawData.length < 50) {
      log.debug(
        `Failed to calculate TLS hash for resource as it's too small, will use raw data instead (size: ${
          rawData.length
        }): ${Diagnostics.errorMessage(err)}.`,
      );
    } else {
      log.error(
        `Failed to calculate TLS hash for resource, will use raw data instead (size: ${
          rawData.length
        }): ${Diagnostics.errorMessage(err)}.`,
      );
    }
  }

  // Protect against too big resources.
  if (rawData.length > 256) {
    log.warn(`Raw data is too big, will use SHA-1 digest instead (size: ${rawData.length}).`);
    return { type: 'sha1', value: createHash('sha1').update(rawData).digest('hex') };
  }

  return { type: 'raw', value: rawData };
}
