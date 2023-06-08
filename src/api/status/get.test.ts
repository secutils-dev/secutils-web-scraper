import * as assert from 'node:assert';
import { test } from 'node:test';

import { registerStatusGetRoutes } from './get.js';
import { createMock } from '../api_route_params.mocks.js';

await test('[/api/status] can successfully create route', () => {
  assert.doesNotThrow(() => registerStatusGetRoutes(createMock()));
});

await test('[/api/status] returns version from the config', async () => {
  const configMock = { version: '1.0.0-rc.100', browserTTLSec: 1, cacheTTLSec: 2, port: 3 };
  const response = await registerStatusGetRoutes(createMock({ config: configMock })).inject({
    method: 'GET',
    url: '/api/status',
  });

  assert.strictEqual(response.body, JSON.stringify({ version: configMock.version }));
  assert.strictEqual(response.statusCode, 200);
});
