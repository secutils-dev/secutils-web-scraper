import { registerWebPageContentGetRoutes } from './content/index.js';
import type { WebPageContext } from './content/index.js';
import { registerWebPageResourcesListRoutes } from './resources/index.js';
import type { WebPageResourceWithRawData } from './resources/list.js';
import type { ApiRouteParams } from '../api_route_params.js';

export interface SecutilsWindow extends Window {
  __secutils?: {
    resourceFilterMap?: (resource: WebPageResourceWithRawData) => WebPageResourceWithRawData | null;
    extractContent?: (context: WebPageContext) => Promise<unknown>;
  };
}

export function registerRoutes(params: ApiRouteParams) {
  registerWebPageResourcesListRoutes(params);
  registerWebPageContentGetRoutes(params);
}
