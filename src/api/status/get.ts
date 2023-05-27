import type { APIRouteParams } from '../api_route_params.js';

export function registerStatusGetRoutes({ server, config }: APIRouteParams) {
  return server.get(
    '/api/status',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              version: { type: 'string' },
            },
          },
        },
      },
    },
    () => {
      return { version: config.version };
    },
  );
}
