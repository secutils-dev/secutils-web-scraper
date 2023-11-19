import { mock } from 'node:test';

import type { SecutilsWindow } from './api/web_page/index.js';

export function createBrowserMock(pageMock?: ReturnType<typeof createPageMock>) {
  return {
    isConnected: mock.fn(() => false),
    newPage: mock.fn(() => pageMock ?? createPageMock()),
  };
}

interface PageMockOptions {
  window?: WindowMock;
  responses?: Array<ResponseMock>;
}
export function createPageMock({ window = createWindowMock(), responses = [] }: PageMockOptions = {}) {
  return {
    on: mock.fn((eventName: string, handler: (response: ResponseMock) => void) => {
      if (eventName === 'response') {
        for (const response of responses) {
          handler(response);
        }
      }
    }),
    close: mock.fn(),
    goto: mock.fn(),
    waitForSelector: mock.fn(),
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
  type: 'script' | 'stylesheet';
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
  };
}
