import * as assert from 'node:assert';
import { mock, test } from 'node:test';

import { registerWebPageContentGetRoutes } from './get.js';
import { createBrowserMock, createPageMock, createWindowMock } from '../../../mocks.js';
import { createMock } from '../../api_route_params.mocks.js';

await test('[/api/web_page/content] can successfully create route', () => {
  assert.doesNotThrow(() => registerWebPageContentGetRoutes(createMock()));
});

await test('[/api/web_page/content] can extract content', async (t) => {
  t.mock.method(Date, 'now', () => 123000);

  const windowMock = createWindowMock({}, { body: { outerHTML: '<body>Hello Secutils.dev and world!</body>' } });

  const pageMock = createPageMock({ window: windowMock, responses: [] });

  const response = await registerWebPageContentGetRoutes(createMock({ browser: createBrowserMock(pageMock) })).inject({
    method: 'POST',
    url: '/api/web_page/content',
    payload: { url: 'https://secutils.dev', delay: 0 },
  });

  assert.strictEqual(response.statusCode, 200);

  assert.strictEqual(
    response.body,
    JSON.stringify({
      timestamp: 123,
      content: '"<body>Hello Secutils.dev and world!</body>"',
    }),
  );

  // Make sure we loaded correct page.
  assert.strictEqual(pageMock.goto.mock.callCount(), 1);
  assert.deepEqual(pageMock.goto.mock.calls[0].arguments, [
    'https://secutils.dev',
    { waitUntil: 'domcontentloaded', timeout: 5000 },
  ]);

  // Make sure we didn't wait for a selector since it wasn't specified.
  assert.strictEqual(pageMock.waitForSelector.mock.callCount(), 0);
});

await test('[/api/web_page/content] can inject content extractor', async (t) => {
  t.mock.method(Date, 'now', () => 123000);

  const extractContentMock = mock.fn((previousContent: unknown) => {
    return Promise.resolve({ message: (previousContent as { message: string }).message.toUpperCase() });
  });

  const windowMock = createWindowMock({ __secutils: { extractContent: extractContentMock } });

  const pageMock = createPageMock({
    window: windowMock,
    responses: [],
  });

  const response = await registerWebPageContentGetRoutes(createMock({ browser: createBrowserMock(pageMock) })).inject({
    method: 'POST',
    url: '/api/web_page/content',
    payload: { url: 'https://secutils.dev', delay: 0, previousContent: '{ "message": "hello" }' },
  });

  assert.strictEqual(response.statusCode, 200);

  assert.strictEqual(
    response.body,
    JSON.stringify({
      timestamp: 123,
      content: '{"message":"HELLO"}',
    }),
  );

  // Make sure we loaded correct page.
  assert.strictEqual(pageMock.goto.mock.callCount(), 1);
  assert.deepEqual(pageMock.goto.mock.calls[0].arguments, [
    'https://secutils.dev',
    { waitUntil: 'domcontentloaded', timeout: 5000 },
  ]);

  // Make sure we didn't wait for a selector since it wasn't specified.
  assert.strictEqual(pageMock.waitForSelector.mock.callCount(), 0);

  // Make sure we called includeResource.
  assert.strictEqual(extractContentMock.mock.callCount(), 1);
  assert.deepEqual(extractContentMock.mock.calls[0].arguments, [{ message: 'hello' }, []]);
});

await test('[/api/web_page/content] reports errors in content extractor', async (t) => {
  t.mock.method(Date, 'now', () => 123000);

  const extractContentMapMock = mock.fn(() => {
    throw new Error('something went wrong');
  });

  const windowMock = createWindowMock({ __secutils: { extractContent: extractContentMapMock } });
  const pageMock = createPageMock({
    window: windowMock,
    responses: [],
  });

  const response = await registerWebPageContentGetRoutes(createMock({ browser: createBrowserMock(pageMock) })).inject({
    method: 'POST',
    url: '/api/web_page/content',
    payload: { url: 'https://secutils.dev', delay: 0, previousContent: '"previous"' },
  });

  assert.strictEqual(response.statusCode, 400);

  assert.strictEqual(
    response.body,
    JSON.stringify({
      message: 'Content extractor script has thrown an exception: something went wrong.',
    }),
  );

  // Make sure we called includeResource.
  assert.strictEqual(extractContentMapMock.mock.callCount(), 1);
  assert.deepEqual(extractContentMapMock.mock.calls[0].arguments, ['previous', []]);
});
