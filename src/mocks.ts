import { mock } from 'node:test';

import type { Browser } from 'playwright';

export function createBrowserMock(pageMock?: ReturnType<typeof createPageMock>) {
  return {
    newPage: mock.fn(() => pageMock ?? createPageMock()),
  } as unknown as Browser;
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
    evaluateHandle: mock.fn(),
    evaluate: mock.fn((fn: (w: WindowMock) => Promise<unknown>) => fn(window)),
  };
}

export type WindowMock = ReturnType<typeof createWindowMock>;
export function createWindowMock() {
  return {
    document: {
      querySelectorAll: mock.fn(() => []),
    },
  };
}

export interface ResponseMockOptions {
  url: string;
  body?: unknown;
}

export type ResponseMock = ReturnType<typeof createResponseMock>;
export function createResponseMock({ url, body }: ResponseMockOptions) {
  return {
    url: () => url,
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
