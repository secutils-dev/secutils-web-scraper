import { createHash } from 'node:crypto';
import { setTimeout as setTimeoutAsync } from 'timers/promises';

import type { FastifyBaseLogger } from 'fastify';
import type { Browser, JSHandle } from 'playwright';

import type { WebPageResource, WebPageResourceContent, WebPageResourceContentData } from './web_page_resource.js';
import type { ApiResult } from '../../api_result.js';
import type { ApiRouteParams } from '../../api_route_params.js';
import { Diagnostics } from '../../diagnostics.js';
import { tlsHash } from '../../tls_hash.js';
import { DEFAULT_DELAY_MS, DEFAULT_TIMEOUT_MS } from '../constants.js';
import type { SecutilsWindow } from '../index.js';

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
     * A content for a function that accepts a resource object and returns either resource (original or modified) or
     * `null` if the resource shouldn't be tracked.
     */
    resourceFilterMap?: string;
  };

  /**
   * Optional list of HTTP headers that should be sent with the tracker requests.
   */
  headers?: Record<string, string>;
}

/**
 * List of discovered resources.
 */
interface OutputBodyType {
  timestamp: number;
  scripts: WebPageResource[];
  styles: WebPageResource[];
}

export interface WebPageResourceWithRawData {
  url?: string;
  data: string;
  type: 'script' | 'stylesheet';
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
          data: {
            type: 'object',
            properties: { sha1: { type: 'string' }, raw: { type: 'string' }, tlsh: { type: 'string' } },
          },
          size: { type: 'number' },
        },
      },
    },
  },
};

export function registerWebPageResourcesListRoutes({ server, cache, acquireBrowser }: ApiRouteParams) {
  return server.post<{ Body: InputBodyParamsType }>(
    '/api/web_page/resources',
    {
      schema: {
        body: {
          url: { type: 'string' },
          delay: { type: 'number' },
          scripts: {
            type: 'object',
            properties: {
              resourceFilterMap: { type: 'string' },
            },
          },
          headers: { type: 'object' },
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
        const log = server.log.child({ provider: 'web_page_resources_list' });

        try {
          const result = await getResourcesList(browser, log, request.body);
          if (result.type === 'client-error') {
            log.error(`Cannot retrieve resources for page "${request.body.url}" due to client error: ${result.error}`);
            await Diagnostics.screenshot(log, browser);
            return reply.code(400).send({ message: result.error });
          }

          cache.set(cacheKey, result.data);
          log.debug(`Successfully fetched resources for page "${request.body.url}".`);
        } catch (err) {
          log.error(`Cannot retrieve resources for page "${request.body.url}": ${Diagnostics.errorMessage(err)}`);
          await Diagnostics.screenshot(log, browser);
          return reply.code(500).send({
            message: `Cannot retrieve resources for page "${request.body.url}". Check the server logs for more details.`,
          });
        }
      }

      return cache.get(cacheKey);
    },
  );
}

async function getResourcesList(
  browser: Browser,
  log: FastifyBaseLogger,
  { url, waitSelector, timeout = DEFAULT_TIMEOUT_MS, delay = DEFAULT_DELAY_MS, scripts, headers }: InputBodyParamsType,
): Promise<ApiResult<OutputBodyType>> {
  const page = await browser.newPage({ extraHTTPHeaders: headers });

  // Inject custom scripts if any.
  if (scripts?.resourceFilterMap) {
    log.debug(`[${url}] Adding "resourceFilterMap" function: ${scripts.resourceFilterMap}.`);
    await page.addInitScript({
      content: `self.__secutils = { resourceFilterMap(resource) { ${scripts.resourceFilterMap} } }`,
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

  const externalResources: Array<Omit<WebPageResourceWithRawData, 'url'> & { url: string; processed: boolean }> = [];
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
          data: responseBody.toString('utf-8'),
          type: resourceType,
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

  log.debug(`Fetching resources for "${url}" (timeout: ${timeout}ms).`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
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

  log.debug(`Delaying resource extraction for ${delay}ms.`);
  await setTimeoutAsync(delay);

  const timestamp = Math.floor(Date.now() / 1000);
  let extractedResources: WebPageResourceWithRawData[];
  try {
    // Pass `window` handle as parameter to be able to shim/mock DOM APIs that aren't available in Node.js.
    const targetWindow = await page.evaluateHandle<Window>('window');
    extractedResources = await page.evaluate(
      async ([targetWindow, externalResources]) => {
        async function parseURL(url: string): Promise<{ url: string; data: string }> {
          if (url.startsWith('data:')) {
            // For `data:` URLs we should replace the actual content the digest later.
            return { url: `${url.split(',')[0]},`, data: url };
          }

          if (url.startsWith('blob:')) {
            // For `blob:` URLs we should fetch the actual content and replace object reference with the digest later.
            return {
              url: 'blob:',
              // [BUG] There is a bug in Node.js 20.4.0 that doesn't properly handle `await response.text()` in tests.
              data: await fetch(url)
                .then((res) => res.body?.getReader().read())
                .then((res) => new TextDecoder().decode(res?.value)),
            };
          }

          return { url, data: '' };
        }

        function isResourceValid(resource: WebPageResourceWithRawData) {
          return !!(resource.url || resource.data);
        }

        const resources: WebPageResourceWithRawData[] = [];
        for (const el of Array.from(targetWindow.document.querySelectorAll('script'))) {
          // We treat script content as a concatenation of `onload` handler and its inner content. For our purposes it
          // doesn't matter if the script is loaded from an external source or is inline. If later we figure out that
          // script content was also loaded from the external source (e.g. when `script` element has both `src` and
          // `innerHTML`) we'll re-calculate its digest and size.
          const { url, data } = await parseURL(el.src.trim());

          const scriptResource: WebPageResourceWithRawData = url
            ? { url, data, type: 'script' }
            : { data, type: 'script' };
          const scriptContent = (el.onload?.toString().trim() ?? '') + el.innerHTML.trim() + data;
          if (scriptContent) {
            const contentBlob = new Blob([scriptContent]);
            scriptResource.data = await contentBlob.text();
          }

          if (isResourceValid(scriptResource)) {
            resources.push(scriptResource);
          }
        }

        for (const el of Array.from(targetWindow.document.querySelectorAll('link[rel=stylesheet]'))) {
          const { url, data } = await parseURL((el as HTMLLinkElement).href.trim());

          const styleResource: WebPageResourceWithRawData = url
            ? { url, data, type: 'stylesheet' }
            : { data, type: 'stylesheet' };
          const styleContent = data;
          if (styleContent) {
            const contentBlob = new Blob([styleContent]);
            styleResource.data = await contentBlob.text();
          }

          if (isResourceValid(styleResource)) {
            resources.push(styleResource);
          }
        }

        for (const el of Array.from(targetWindow.document.querySelectorAll('style'))) {
          const contentBlob = new Blob([el.innerHTML]);
          if (contentBlob.size > 0) {
            resources.push({
              type: 'stylesheet',
              data: await contentBlob.text(),
            });
          }
        }

        // Some inline resources may also be loaded from external sources. We should combine them with the external.
        const externalResourcesMap = new Map(externalResources.map((resource) => [resource.url, resource]));
        const combinedResources = resources.map((resource: WebPageResourceWithRawData) => {
          // Skip inline resources and resources that weren't fetched.
          const externalResource = resource.url ? externalResourcesMap.get(resource.url) : undefined;
          if (!externalResource) {
            return resource;
          }

          // Mark external resource as processed to not include it in the final output more than needed.
          if (!externalResource.processed) {
            externalResourcesMap.set(externalResource.url, { ...externalResource, processed: true });
          }

          return { ...resource, data: resource.data + externalResource.data };
        });

        // Add remaining resources that browser fetched, but we didn't process.
        for (const externalResource of externalResourcesMap.values()) {
          if (!externalResource.processed) {
            combinedResources.push(externalResource);
          }
        }

        const resourceFilterMap = targetWindow.__secutils?.resourceFilterMap;
        if (resourceFilterMap && typeof resourceFilterMap !== 'function') {
          console.error(`[browser] Invalid "resourceFilterMap" function: ${typeof resourceFilterMap}`);
        } else if (resourceFilterMap) {
          console.debug('[browser] Using custom "resourceFilterMap" function.');
        }

        try {
          return typeof resourceFilterMap === 'function'
            ? combinedResources.flatMap((resource) => {
                const mappedResource = resourceFilterMap(resource);
                if (!mappedResource) {
                  console.debug(`[browser] Skipping resource: ${resource.url ?? '<inline>'}`);
                  return [];
                }

                // Check that the resource URL is valid.
                if (mappedResource.url != null && typeof mappedResource.url !== 'string') {
                  console.debug(`[browser] Mapped resource URL is not valid: ${JSON.stringify(mappedResource.url)}`);
                  throw new Error('Mapped resource is not valid');
                }

                // Check that resource type is valid.
                if (mappedResource.type !== 'script' && mappedResource.type !== 'stylesheet') {
                  console.debug(`[browser] Mapped resource type is not valid: ${JSON.stringify(mappedResource.type)}`);
                  throw new Error('Mapped resource is not valid');
                }

                // Check that resource raw data is valid.
                if (typeof mappedResource.data !== 'string') {
                  console.debug(
                    `[browser] Mapped resource raw data is not valid: ${JSON.stringify(mappedResource.data)}`,
                  );
                  throw new Error('Mapped resource is not valid');
                }

                return [mappedResource];
              })
            : combinedResources;
        } catch (err: unknown) {
          console.error(
            `[browser] Resources filter script has thrown an exception: ${(err as Error)?.message ?? err}.`,
          );
          console.trace(err);

          throw new Error(`Resources filter script has thrown an exception: ${(err as Error)?.message ?? err}.`);
        }
      },
      [targetWindow as JSHandle<SecutilsWindow>, externalResources] as const,
    );
  } catch (err) {
    log.error(`Failed to extract resources for page "${url}: ${Diagnostics.errorMessage(err)}`);
    return { type: 'client-error', error: Diagnostics.errorMessage(err) };
  }

  log.debug(`Extracted ${extractedResources.length} resources for the page "${url}".`);

  const resultScripts: WebPageResource[] = [];
  const resultStyles: WebPageResource[] = [];
  for (const resourceWithRawData of extractedResources) {
    let content: WebPageResourceContent | undefined = undefined;
    if (resourceWithRawData.data) {
      content = {
        data: createResourceContentData(log, resourceWithRawData.data),
        size: resourceWithRawData.data.length,
      };
    }

    let url: string | undefined = undefined;
    if (
      resourceWithRawData.url &&
      (resourceWithRawData.url.startsWith('data:') || resourceWithRawData.url.startsWith('blob:'))
    ) {
      // For data:/blob: URLs we should replace the actual content the digest.
      url = `${resourceWithRawData.url}[${Object.values(content?.data ?? {})[0] ?? ''}]`;
    } else {
      url = resourceWithRawData.url;
    }

    if (url || content) {
      (resourceWithRawData.type === 'script' ? resultScripts : resultStyles).push(
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

  return { type: 'success', data: { timestamp, scripts: resultScripts, styles: resultStyles } };
}

function createResourceContentData(log: FastifyBaseLogger, data: string): WebPageResourceContentData {
  try {
    return { tlsh: tlsHash(data) };
  } catch (err) {
    // If data is too small, TLS hash will fail, but it's expected, and we shouldn't log this as an error.
    if (data.length < 50) {
      log.debug(
        `Failed to calculate TLS hash for resource as it's too small, will use raw data instead (size: ${
          data.length
        }): ${Diagnostics.errorMessage(err)}.`,
      );
    } else {
      log.error(
        `Failed to calculate TLS hash for resource, will use raw data instead (size: ${
          data.length
        }): ${Diagnostics.errorMessage(err)}.`,
      );
    }
  }

  // Protect against too big resources.
  if (data.length > 256) {
    log.warn(`Raw data is too big, will use SHA-1 digest instead (size: ${data.length}).`);
    return { sha1: createHash('sha1').update(data).digest('hex') };
  }

  return { raw: data };
}
