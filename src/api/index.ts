import type { APIRouteParams } from './api_route_params.js';
import * as resources from './resources/index.js';
import * as status from './status/index.js';

export function registerRoutes(params: APIRouteParams) {
  resources.registerRoutes(params);
  status.registerRoutes(params);
}
