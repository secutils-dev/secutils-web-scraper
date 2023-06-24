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
          content: { digest: '5f483264496cf1440c6ef569cc4fb9785d3bed896efdadfc998e9cb1badcec81', size: 9 },
        },
        {
          url: 'https://secutils.dev/script.js',
          content: { digest: '5f483264496cf1440c6ef569cc4fb9785d3bed896efdadfc998e9cb1badcec81', size: 9 },
        },
        { content: { digest: '6e11c72f7cf6bc383152dd16ddd5903aba6bb1c99d6b6639a4bb0b838185fa92', size: 8 } },
        {
          url: 'data:text/javascript;base64,[REDACTED]',
          content: { digest: 'cb86bcc6aefcf05fcf5e888fde6bceba2641673b7484e4ecfcb901fbc53bb5af', size: 48 },
        },
        {
          url: 'https://secutils.dev/weird-script.js',
          content: { digest: 'a9cf14e70f4640f8e2e9a9742c70d903ab145e32e1693d1f9c389550aec373c6', size: 23 },
        },
        {
          url: 'blob:[REDACTED]',
          content: { digest: 'e48b3488eae9d0e229cbe34f48e40d8aaf48f90561d7b4f8839d11315511848f', size: 8 },
        },
      ],
      styles: [
        { url: 'https://secutils.dev/style.css' },
        {
          url: 'https://secutils.dev/fonts.css',
          content: { digest: '4bf5d080989904bed2dfeb753a25567e4080d3f77d03fe6a1c67b5dc55e9f19f', size: 18 },
        },
        {
          url: 'data:text/css,[REDACTED]',
          content: { digest: '718f9d008b611fbf592cf44a9155efa3c9ffdc6c220dcd7f4299f2b1e4242096', size: 45 },
        },
        {
          url: 'blob:[REDACTED]',
          content: { digest: '5b5e7029fdc58ffc4970ddd785f6946e57040dc383a9d6a4b4cd46fb6059515a', size: 17 },
        },
        { content: { digest: '678e77d012a42a2dd2c117bd49bc203e0bd82fad960a5d861ccc8f491bd262d2', size: 19 } },
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
