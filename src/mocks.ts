import { mock } from 'node:test';

import type { SecutilsWindow } from './api/web_page/index.js';

export function createBrowserMock(browserContextMock?: BrowserContextMock) {
  return {
    isConnected: mock.fn(() => false),
    newContext: mock.fn(() => Promise.resolve(browserContextMock ?? createBrowserContextMock())),
  };
}

export type BrowserContextMock = ReturnType<typeof createBrowserContextMock>;
export function createBrowserContextMock(
  pageMock?: ReturnType<typeof createPageMock>,
  cdpSessionMock?: ReturnType<typeof createCDPSessionMock>,
) {
  return {
    newCDPSession: mock.fn(() => Promise.resolve(cdpSessionMock ?? createCDPSessionMock())),
    newPage: mock.fn(() => Promise.resolve(pageMock ?? createPageMock())),
  };
}

export function createCDPSessionMock() {
  return {
    send: mock.fn(() => Promise.resolve()),
  };
}

interface PageMockOptions {
  window?: WindowMock;
  responses?: Array<ResponseMock>;
  content?: string;
}
export function createPageMock({ window = createWindowMock(), responses = [], content = '' }: PageMockOptions = {}) {
  return {
    on: mock.fn((eventName: string, handler: (response: ResponseMock) => void) => {
      if (eventName === 'response') {
        for (const response of responses) {
          handler(response);
        }
      }
    }),
    close: mock.fn(),
    goto: mock.fn(() => Promise.resolve(createResponseMock({ url: 'https://secutils.dev', type: 'document' }))),
    content: mock.fn(() => Promise.resolve(content)),
    addInitScript: mock.fn(),
    waitForSelector: mock.fn(),
    route: mock.fn(),
    evaluateHandle: mock.fn(() => window),
    evaluate: mock.fn((fn: (args: unknown) => Promise<unknown>, args: unknown) => fn(args)),
  };
}

export type WindowMock = ReturnType<typeof createWindowMock>;
export function createWindowMock(
  { __secutils }: Pick<SecutilsWindow, '__secutils'> = {},
  documentProperties: Record<string, unknown> = {},
) {
  return {
    document: {
      querySelectorAll: mock.fn(() => []),
      ...documentProperties,
    },
    __secutils,
  };
}

export interface ResponseMockOptions {
  url: string;
  type: 'script' | 'stylesheet' | 'document';
  body?: unknown;
}

export type ResponseMock = ReturnType<typeof createResponseMock>;
export function createResponseMock({ url, body, type }: ResponseMockOptions) {
  return {
    url: () => url,
    request: () => ({
      resourceType: () => type,
      isNavigationRequest: () => false,
      method: () => 'GET',
    }),
    body: () => {
      return Promise.resolve(
        Buffer.isBuffer(body)
          ? body
          : body
            ? Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
            : body,
      );
    },
    allHeaders: mock.fn(() => Promise.resolve({})),
  };
}
