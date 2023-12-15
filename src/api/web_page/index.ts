import { registerWebPageContentGetRoutes } from './content/index.js';
import type { FetchedResource } from './fetch_interceptor.js';
import { registerWebPageResourcesListRoutes } from './resources/index.js';
import type { WebPageResourceWithRawData } from './resources/list.js';
import type { ApiRouteParams } from '../api_route_params.js';

export interface SecutilsWindow extends Window {
  __secutils?: {
    resourceFilterMap?: (resource: WebPageResourceWithRawData) => WebPageResourceWithRawData | null;
    extractContent?: (
      previousContent: unknown,
      externalResources: FetchedResource[],
      responseHeaders: Record<string, string>,
    ) => Promise<unknown>;
  };
}

export function registerRoutes(params: ApiRouteParams) {
  registerWebPageResourcesListRoutes(params);
  registerWebPageContentGetRoutes(params);
}
