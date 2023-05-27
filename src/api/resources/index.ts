import { registerResourcesListRoutes } from './list.js';
import type { APIRouteParams } from '../api_route_params.js';

export function registerRoutes(params: APIRouteParams) {
  registerResourcesListRoutes(params);
}
