import * as assert from 'node:assert';
import { Blob } from 'node:buffer';
import { test } from 'node:test';

import { registerResourcesListRoutes } from './list.js';
import { createBrowserMock, createPageMock, createResponseMock, createWindowMock } from '../../mocks.js';
import { createMock } from '../api_route_params.mocks.js';

await test('[/api/resources] can successfully create route', () => {
  assert.doesNotThrow(() => registerResourcesListRoutes(createMock()));
});

await test('[/api/resources] can parse resources', async (t) => {
  t.mock.method(Date, 'now', () => 123000);

  const windowMock = createWindowMock();
  windowMock.document.querySelectorAll.mock.mockImplementation((selector: string) => {
    if (selector === 'script') {
      const blobScript = new Blob(['alert(3)']);
      return [
        { src: 'https://secutils.dev/script.js', innerHTML: '' },
        { src: 'https://secutils.dev/script.js', innerHTML: '' },
        { src: '', innerHTML: 'alert(1)' },
        { src: 'data:text/javascript;base64,YWxlcnQoMSk=', onload: { toString: () => 'alert(2)' }, innerHTML: '' },
        { src: 'https://secutils.dev/weird-script.js', innerHTML: 'alert(1)' },
        // @ts-expect-error: Conflicting types with DOM.
        { src: URL.createObjectURL(blobScript), innerHTML: '' },
      ];
    }

    if (selector === 'link[rel=stylesheet]') {
      const blobStyle = new Blob(['* { color: blue }']);
      return [
        { href: 'https://secutils.dev/style.css' },
        { href: 'https://secutils.dev/fonts.css' },
        { href: 'data:text/css, body { background-color: red }' },
        // @ts-expect-error: Conflicting types with DOM.
        { href: URL.createObjectURL(blobStyle) },
      ];
    }

    if (selector === 'style') {
      return [{ innerHTML: '* { color: black; }' }];
    }

    return [];
  });

  const pageMock = createPageMock({
    window: windowMock,
    responses: [
      createResponseMock({ url: 'https://secutils.dev/script.js', body: 'some body', resourceType: 'script' }),
      createResponseMock({
        url: 'https://secutils.dev/weird-script.js',
        body: 'some weird body',
        resourceType: 'script',
      }),
      createResponseMock({
        url: 'https://secutils.dev/fonts.css',
        body: '* { color: blue; }',
        resourceType: 'stylesheet',
      }),
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
      scripts: [
        {
          url: 'https://secutils.dev/script.js',
          content: { digest: '754e8afdb33e180fbb7311eba784c5416766aa1c', size: 9 },
        },
        {
          url: 'https://secutils.dev/script.js',
          content: { digest: '754e8afdb33e180fbb7311eba784c5416766aa1c', size: 9 },
        },
        { content: { digest: '298a37c7d040603383d817c7132c1873c3f821fb', size: 8 } },
        {
          url: 'data:text/javascript;base64,[d75d7677ffcb4b642dcacad3bc13e5e1bbe41e51]',
          content: { digest: 'd75d7677ffcb4b642dcacad3bc13e5e1bbe41e51', size: 48 },
        },
        {
          url: 'https://secutils.dev/weird-script.js',
          content: { digest: 'c04795a6ebe7013a6583eea630ca992314ad79ee', size: 23 },
        },
        {
          url: 'blob:[3e6cc9a3d3b72c8ced3d458fca03fde463c2fa83]',
          content: { digest: '3e6cc9a3d3b72c8ced3d458fca03fde463c2fa83', size: 8 },
        },
      ],
      styles: [
        { url: 'https://secutils.dev/style.css' },
        {
          url: 'https://secutils.dev/fonts.css',
          content: { digest: '11b4153e247dda8ef333a1e1ad46227b011dc46e', size: 18 },
        },
        {
          url: 'data:text/css,[642568ff95ead504d599e474e2daec38f394cb47]',
          content: { digest: '642568ff95ead504d599e474e2daec38f394cb47', size: 45 },
        },
        {
          url: 'blob:[17dba57420ea2116bb5f58896908f16a3968cb97]',
          content: { digest: '17dba57420ea2116bb5f58896908f16a3968cb97', size: 17 },
        },
        { content: { digest: '3e9704995f77e96cc14ad4bc9320d2e108f7efc1', size: 19 } },
      ],
    }),
  );
  assert.strictEqual(response.statusCode, 200);

  // Make sure we loaded correct page.
  assert.strictEqual(pageMock.goto.mock.callCount(), 1);
  assert.deepEqual(pageMock.goto.mock.calls[0].arguments, [
    'https://secutils.dev',
    { waitUntil: 'domcontentloaded', timeout: 5000 },
  ]);

  // Make sure we didn't wait for a selector since it wasn't specified.
  assert.strictEqual(pageMock.waitForSelector.mock.callCount(), 0);
});
