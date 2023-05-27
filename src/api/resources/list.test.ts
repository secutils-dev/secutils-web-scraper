import * as assert from 'node:assert';
import { test } from 'node:test';

import { registerResourcesListRoutes } from './list.js';
import { createBrowserMock, createPageMock, createResponseMock, createWindowMock } from '../../mocks.js';
import { createMock } from '../api_route_params.mocks.js';

await test('[/api/resources] can successfully create route', () => {
  assert.doesNotThrow(() => registerResourcesListRoutes(createMock()));
});

await test('[/api/resources] can parse resources', async (t) => {
  t.mock.method(Date, 'now', () => 123);

  const windowMock = createWindowMock();
  windowMock.document.querySelectorAll.mock.mockImplementation((selector: string) => {
    if (selector === 'script') {
      return [{ src: 'https://secutils.dev/script.js' }, { src: '', innerHTML: 'alert(1)' }];
    }

    if (selector === 'link[rel=stylesheet]') {
      return [{ href: 'https://secutils.dev/style.css' }, { href: 'https://secutils.dev/fonts.css' }];
    }

    if (selector === 'style') {
      return [{ innerHTML: '* { color: black; }' }];
    }

    return [];
  });

  const pageMock = createPageMock({
    window: windowMock,
    responses: [
      createResponseMock({ url: 'https://secutils.dev/script.js', body: 'some body' }),
      createResponseMock({ url: 'https://secutils.dev/fonts.css', body: '* { color: blue; }' }),
    ],
  });

  const response = await registerResourcesListRoutes(createMock({ browser: createBrowserMock(pageMock) })).inject({
    method: 'POST',
    url: '/api/resources',
    payload: { url: 'https://secutils.dev', delay: 0 },
  });

  assert.strictEqual(
    response.body,
    JSON.stringify({
      timestamp: 123,
      scripts: {
        external: [
          {
            src: 'https://secutils.dev/script.js',
            digest: '5f483264496cf1440c6ef569cc4fb9785d3bed896efdadfc998e9cb1badcec81',
            size: 9,
          },
        ],
        inline: [{ digest: '6e11c72f7cf6bc383152dd16ddd5903aba6bb1c99d6b6639a4bb0b838185fa92', size: 8 }],
      },
      styles: {
        external: [
          { src: 'https://secutils.dev/style.css' },
          {
            src: 'https://secutils.dev/fonts.css',
            digest: '4bf5d080989904bed2dfeb753a25567e4080d3f77d03fe6a1c67b5dc55e9f19f',
            size: 18,
          },
        ],
        inline: [{ digest: '678e77d012a42a2dd2c117bd49bc203e0bd82fad960a5d861ccc8f491bd262d2', size: 19 }],
      },
    }),
  );
  assert.strictEqual(response.statusCode, 200);

  // Make sure we loaded correct page.
  assert.strictEqual(pageMock.goto.mock.callCount(), 1);
  assert.deepEqual(pageMock.goto.mock.calls[0].arguments, [
    'https://secutils.dev',
    { waitUntil: 'networkidle', timeout: 5000 },
  ]);

  // Make sure we didn't wait for a selector since it wasn't specified.
  assert.strictEqual(pageMock.waitForSelector.mock.callCount(), 0);
});
