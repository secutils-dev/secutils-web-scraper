import { registerStatusGetRoutes } from './get.js';
import type { APIRouteParams } from '../api_route_params.js';

export function registerRoutes(params: APIRouteParams) {
  registerStatusGetRoutes(params);
}
