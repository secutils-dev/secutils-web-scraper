import { registerWebPageResourcesListRoutes } from './resources/index.js';
import type { WebPageResourceWithRawData } from './resources/list.js';
import type { APIRouteParams } from '../api_route_params.js';

export interface SecutilsWindow extends Window {
  __secutils?: {
    resourceFilterMap?: (resource: WebPageResourceWithRawData) => WebPageResourceWithRawData | null;
  };
}

export function registerRoutes(params: APIRouteParams) {
  registerWebPageResourcesListRoutes(params);
}
