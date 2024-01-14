import * as assert from 'node:assert';
import { Blob } from 'node:buffer';
import { mock, test } from 'node:test';

import type { Browser } from 'playwright/index.js';

import type { WebPageResourceWithRawData } from './list.js';
import { registerWebPageResourcesListRoutes } from './list.js';
import { configure } from '../../../config.js';
import {
  createBrowserContextMock,
  createBrowserMock,
  createCDPSessionMock,
  createPageMock,
  createWindowMock,
} from '../../../mocks.js';
import { createMock } from '../../api_route_params.mocks.js';

await test('[/api/web_page/resources] can successfully create route', () => {
  assert.doesNotThrow(() => registerWebPageResourcesListRoutes(createMock()));
});

await test('[/api/web_page/resources] can parse resources', async (t) => {
  t.mock.method(Date, 'now', () => 123000);

  const windowMock = createWindowMock();
  windowMock.document.querySelectorAll.mock.mockImplementation((selector: string) => {
    if (selector === 'script') {
      const blobScript = new Blob(['console.log(1);alert(2);alert(3);alert(4);alert(5);console.log(6);']);
      return [
        { src: 'https://secutils.dev/script.js', innerHTML: '' },
        { src: 'https://secutils.dev/script.js', innerHTML: '' },
        { src: '', innerHTML: 'alert(1);alert(2);alert(3);alert(4);alert(5);console.log(6);' },
        { src: '', innerHTML: 'alert(1)' },
        { src: '', innerHTML: 'alert(1)'.repeat(33) },
        {
          src: 'data:text/javascript;base64,YWxlcnQoMSk7YWxlcnQoMik7YWxlcnQoMyk7YWxlcnQoNCk7YWxlcnQoNSk7Y29uc29sZS5sb2coNik7',
          onload: { toString: () => 'alert(2)' },
          innerHTML: '',
        },
        { src: 'https://secutils.dev/weird-script.js', innerHTML: 'alert(1)' },
        // @ts-expect-error: Conflicting types with DOM.
        { src: URL.createObjectURL(blobScript), innerHTML: '' },
      ];
    }

    if (selector === 'link[rel=stylesheet]') {
      const blobStyle = new Blob(['body { background-color: blue } div { color: red }']);
      return [
        { href: 'https://secutils.dev/style.css' },
        { href: 'https://secutils.dev/fonts.css' },
        { href: 'data:text/css, body { background-color: red } div { color: green }' },
        // @ts-expect-error: Conflicting types with DOM.
        { href: URL.createObjectURL(blobStyle) },
      ];
    }

    if (selector === 'style') {
      return [
        { innerHTML: '* { color: black; background-color: white; font-size: 100; }' },
        { innerHTML: `* { ${'a'.repeat(50)} }` },
        { innerHTML: `* {}` },
      ];
    }

    return [];
  });

  const pageMock = createPageMock({
    window: windowMock,
    responses: [],
  });
  const cdpSessionMock = createCDPSessionMock([
    {
      url: 'https://secutils.dev/script.js',
      body: 'window.document.body.innerHTML = "Hello Secutils.dev and world!";',
      resourceType: 'Script',
    },
    {
      url: 'https://secutils.dev/weird-script.js',
      body: `window.document.body.innerHTML = "Hello Secutils.dev and world!";`,
      resourceType: 'Script',
    },
    {
      url: 'https://secutils.dev/fonts.css',
      body: '* { color: blue-ish-not-valid; font-size: 100500; }',
      resourceType: 'Stylesheet',
    },
  ]);
  const browserContextMock = createBrowserContextMock(pageMock, cdpSessionMock);

  const response = await registerWebPageResourcesListRoutes(
    createMock({ browser: createBrowserMock(browserContextMock) as unknown as Browser }),
  ).inject({
    method: 'POST',
    url: '/api/web_page/resources',
    payload: { url: 'https://secutils.dev', delay: 0 },
  });

  assert.strictEqual(response.statusCode, 200);

  assert.strictEqual(
    response.body,
    JSON.stringify({
      timestamp: 123,
      scripts: [
        {
          url: 'https://secutils.dev/script.js',
          content: {
            data: { tlsh: 'T156A002B39256197413252E602EA57AC67D66540474113459D79DB004B1608C7C8EEEDD' },
            size: 65,
          },
        },
        {
          url: 'https://secutils.dev/script.js',
          content: {
            data: { tlsh: 'T156A002B39256197413252E602EA57AC67D66540474113459D79DB004B1608C7C8EEEDD' },
            size: 65,
          },
        },
        {
          content: {
            data: { tlsh: 'T172A0021519C40C242F86775C090C100124801A5170435C46500D52FE00557F2807D114' },
            size: 60,
          },
        },
        {
          content: {
            data: { raw: 'alert(1)' },
            size: 8,
          },
        },
        {
          content: {
            data: { sha1: 'eeb57986d46355a4ccfab37c3071f40e2b14ab07' },
            size: 264,
          },
        },
        {
          url: 'data:text/javascript;base64,[T1B7B0920E581F5C01C2C0128830FCB23897382835A00C4A57783C7BD4344CA70280F388]',
          content: {
            data: { tlsh: 'T1B7B0920E581F5C01C2C0128830FCB23897382835A00C4A57783C7BD4344CA70280F388' },
            size: 116,
          },
        },
        {
          url: 'https://secutils.dev/weird-script.js',
          content: {
            data: { tlsh: 'T196A022F3A2020E3003222F202EA83AC23C2200083020300AC38CF000B0308C3C8EEECC' },
            size: 73,
          },
        },
        {
          url: 'blob:[T1D8A002151DC80C343F85775C0D0C500234801F55B0836C45600D17FF0095FF284BD128]',
          content: {
            data: { tlsh: 'T1D8A002151DC80C343F85775C0D0C500234801F55B0836C45600D17FF0095FF284BD128' },
            size: 66,
          },
        },
      ],
      styles: [
        { url: 'https://secutils.dev/style.css' },
        {
          url: 'https://secutils.dev/fonts.css',
          content: {
            data: { tlsh: 'T19590220E23308028C000888020033280308C008300000328208008C0808CCE02200B00' },
            size: 51,
          },
        },
        {
          url: 'data:text/css,[T110A02222C3020C0330CB800FA0B2800B8A32088880382FE83C38C02C020E00020238FA]',
          content: {
            data: { tlsh: 'T110A02222C3020C0330CB800FA0B2800B8A32088880382FE83C38C02C020E00020238FA' },
            size: 66,
          },
        },
        {
          url: 'blob:[T19F900206CA51495B759B81595461850B423A11C954786B18786A55980615454A1224F1]',
          content: {
            data: { tlsh: 'T19F900206CA51495B759B81595461850B423A11C954786B18786A55980615454A1224F1' },
            size: 50,
          },
        },
        {
          content: {
            data: { tlsh: 'T13DA0021ADB65454A32DF5A68356397A0526D548889104B7C3D5EB894D74C0617112791' },
            size: 60,
          },
        },
        {
          content: {
            data: { raw: '* { aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa }' },
            size: 56,
          },
        },
        {
          content: {
            data: { raw: '* {}' },
            size: 4,
          },
        },
      ],
    }),
  );

  // Make sure we cleared the cache.
  assert.strictEqual(cdpSessionMock.send.mock.callCount(), 10);
  assert.deepEqual(cdpSessionMock.send.mock.calls[0].arguments, ['Network.clearBrowserCache']);
  assert.deepEqual(cdpSessionMock.send.mock.calls[1].arguments, ['Network.setCacheDisabled', { cacheDisabled: true }]);
  assert.deepEqual(cdpSessionMock.send.mock.calls[2].arguments, [
    'Fetch.enable',
    {
      patterns: [
        { resourceType: 'Script', requestStage: 'Response' },
        { resourceType: 'Stylesheet', requestStage: 'Response' },
      ],
    },
  ]);
  assert.deepEqual(cdpSessionMock.send.mock.calls[3].arguments, ['Fetch.getResponseBody', { requestId: '0' }]);
  assert.deepEqual(cdpSessionMock.send.mock.calls[4].arguments, ['Fetch.disable']);
  assert.deepEqual(cdpSessionMock.send.mock.calls[5].arguments, ['Fetch.continueRequest', { requestId: '0' }]);
  assert.deepEqual(cdpSessionMock.send.mock.calls[6].arguments, ['Fetch.getResponseBody', { requestId: '1' }]);
  assert.deepEqual(cdpSessionMock.send.mock.calls[7].arguments, ['Fetch.continueRequest', { requestId: '1' }]);
  assert.deepEqual(cdpSessionMock.send.mock.calls[8].arguments, ['Fetch.getResponseBody', { requestId: '2' }]);
  assert.deepEqual(cdpSessionMock.send.mock.calls[9].arguments, ['Fetch.continueRequest', { requestId: '2' }]);

  // Make sure we loaded correct page.
  assert.strictEqual(pageMock.goto.mock.callCount(), 1);
  assert.deepEqual(pageMock.goto.mock.calls[0].arguments, ['https://secutils.dev', { timeout: 10000 }]);

  // Make sure we didn't wait for a selector since it wasn't specified.
  assert.strictEqual(pageMock.waitForSelector.mock.callCount(), 0);
});

await test('[/api/web_page/resources] can inject resource filters', async (t) => {
  t.mock.method(Date, 'now', () => 123000);

  const resourceFilterMapMock = mock.fn((resource: WebPageResourceWithRawData) =>
    !resource.data.includes('alert') ? resource : null,
  );

  const windowMock = createWindowMock({ __secutils: { resourceFilterMap: resourceFilterMapMock } });
  windowMock.document.querySelectorAll.mock.mockImplementation((selector: string) => {
    if (selector === 'script') {
      return [
        { src: 'https://secutils.dev/script.js', innerHTML: '' },
        { src: '', innerHTML: 'alert(1)'.repeat(10) },
      ];
    }

    if (selector === 'link[rel=stylesheet]') {
      return [{ href: 'https://secutils.dev/fonts.css' }];
    }

    if (selector === 'style') {
      return [{ innerHTML: '* { color: black; background-color: white; font-size: 100; }' }];
    }

    return [];
  });

  const pageMock = createPageMock({ window: windowMock });
  const cdpSessionMock = createCDPSessionMock([
    {
      url: 'https://secutils.dev/script.js',
      body: 'window.document.body.innerHTML = "Hello Secutils.dev and world!";',
      resourceType: 'Script',
    },
    {
      url: 'https://secutils.dev/fonts.css',
      body: '* { color: blue-ish-not-valid; font-size: 100500; }',
      resourceType: 'Stylesheet',
    },
  ]);
  const browserContextMock = createBrowserContextMock(pageMock, cdpSessionMock);

  const browserMock = createBrowserMock(browserContextMock);
  const response = await registerWebPageResourcesListRoutes(
    createMock({
      browser: browserMock as unknown as Browser,
      config: { ...configure(), userAgent: 'secutils/1.0.0' },
    }),
  ).inject({
    method: 'POST',
    url: '/api/web_page/resources',
    payload: { url: 'https://secutils.dev', delay: 0, headers: { Cookie: 'my-cookie' } },
  });

  assert.strictEqual(response.statusCode, 200);

  assert.strictEqual(
    response.body,
    JSON.stringify({
      timestamp: 123,
      scripts: [
        {
          url: 'https://secutils.dev/script.js',
          content: {
            data: { tlsh: 'T156A002B39256197413252E602EA57AC67D66540474113459D79DB004B1608C7C8EEEDD' },
            size: 65,
          },
        },
      ],
      styles: [
        {
          url: 'https://secutils.dev/fonts.css',
          content: {
            data: { tlsh: 'T19590220E23308028C000888020033280308C008300000328208008C0808CCE02200B00' },
            size: 51,
          },
        },
        {
          content: {
            data: { tlsh: 'T13DA0021ADB65454A32DF5A68356397A0526D548889104B7C3D5EB894D74C0617112791' },
            size: 60,
          },
        },
      ],
    }),
  );

  // Make sure we loaded correct page.
  assert.strictEqual(pageMock.goto.mock.callCount(), 1);
  assert.deepEqual(pageMock.goto.mock.calls[0].arguments, ['https://secutils.dev', { timeout: 10000 }]);

  assert.strictEqual(browserMock.newContext.mock.callCount(), 1);
  assert.deepEqual(browserMock.newContext.mock.calls[0].arguments, [
    { extraHTTPHeaders: { Cookie: 'my-cookie' }, bypassCSP: false, userAgent: 'secutils/1.0.0' },
  ]);

  // Make sure we didn't wait for a selector since it wasn't specified.
  assert.strictEqual(pageMock.waitForSelector.mock.callCount(), 0);

  // Make sure we called includeResource.
  assert.strictEqual(resourceFilterMapMock.mock.callCount(), 4);
  assert.deepEqual(resourceFilterMapMock.mock.calls[0].arguments, [
    {
      data: 'window.document.body.innerHTML = "Hello Secutils.dev and world!";',
      type: 'script',
      url: 'https://secutils.dev/script.js',
    },
  ]);
  assert.deepEqual(resourceFilterMapMock.mock.calls[1].arguments, [
    {
      data: 'alert(1)alert(1)alert(1)alert(1)alert(1)alert(1)alert(1)alert(1)alert(1)alert(1)',
      type: 'script',
    },
  ]);
  assert.deepEqual(resourceFilterMapMock.mock.calls[2].arguments, [
    {
      data: '* { color: blue-ish-not-valid; font-size: 100500; }',
      type: 'stylesheet',
      url: 'https://secutils.dev/fonts.css',
    },
  ]);
  assert.deepEqual(resourceFilterMapMock.mock.calls[3].arguments, [
    {
      data: '* { color: black; background-color: white; font-size: 100; }',
      type: 'stylesheet',
    },
  ]);
});

await test('[/api/web_page/resources] reports errors in resource filters', async (t) => {
  t.mock.method(Date, 'now', () => 123000);

  const resourceFilterMapMock = mock.fn(() => {
    throw new Error('something went wrong');
  });

  const windowMock = createWindowMock({ __secutils: { resourceFilterMap: resourceFilterMapMock } });
  windowMock.document.querySelectorAll.mock.mockImplementation((selector: string) => {
    if (selector === 'script') {
      return [{ src: '', innerHTML: 'alert(1)' }];
    }

    return [];
  });

  const pageMock = createPageMock({
    window: windowMock,
    responses: [],
  });
  const browserContextMock = createBrowserContextMock(pageMock);

  const response = await registerWebPageResourcesListRoutes(
    createMock({ browser: createBrowserMock(browserContextMock) as unknown as Browser }),
  ).inject({
    method: 'POST',
    url: '/api/web_page/resources',
    payload: { url: 'https://secutils.dev', delay: 0 },
  });

  assert.strictEqual(response.statusCode, 400);

  assert.strictEqual(
    response.body,
    JSON.stringify({
      message: 'Resources filter script has thrown an exception: something went wrong.',
    }),
  );

  // Make sure we called includeResource.
  assert.strictEqual(resourceFilterMapMock.mock.callCount(), 1);
  assert.deepEqual(resourceFilterMapMock.mock.calls[0].arguments, [
    {
      data: 'alert(1)',
      type: 'script',
    },
  ]);
});
