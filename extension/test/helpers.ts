export interface MockStorage {
  data: Record<string, unknown>;
  get(keys?: unknown): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface ChromeMock {
  storage: { local: MockStorage; onChanged: { addListener(fn: unknown): void } };
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
    onMessage: { addListener(fn: unknown): void };
    onInstalled: { addListener(fn: unknown): void };
    openOptionsPage(): void;
  };
  identity: {
    getRedirectURL(): string;
    launchWebAuthFlow(details: { url: string; interactive: boolean }): Promise<string | undefined>;
  };
  permissions: {
    contains(perm: { origins: string[] }): Promise<boolean>;
    request(perm: { origins: string[] }): Promise<boolean>;
  };
  __messages: unknown[];
  __messageHandler: ((message: unknown, sender: unknown, sendResponse: (r: unknown) => void) => unknown) | null;
  __authFlow: { url: string; interactive: boolean } | null;
  __authResponseUrl: string;
}

export function installChromeMock(sendMessageImpl?: (message: unknown) => Promise<unknown>): ChromeMock {
  const data: Record<string, unknown> = {};
  const mock: ChromeMock = {
    storage: {
      local: {
        data,
        async get(keys?: unknown) {
          if (keys === undefined || keys === null) return { ...data };
          const list = Array.isArray(keys) ? keys : [keys as string];
          const out: Record<string, unknown> = {};
          for (const k of list) {
            if (k in data) out[k] = data[k];
          }
          return out;
        },
        async set(items: Record<string, unknown>) {
          Object.assign(data, items);
        },
        async remove(keys: string | string[]) {
          for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
        }
      },
      onChanged: { addListener() {} }
    },
    runtime: {
      async sendMessage(message: unknown) {
        mock.__messages.push(message);
        if (sendMessageImpl) return sendMessageImpl(message);
        return undefined;
      },
      onMessage: {
        addListener(fn: unknown) {
          mock.__messageHandler = fn as ChromeMock["__messageHandler"];
          (globalThis as { __evoMessageHandler?: unknown }).__evoMessageHandler = fn;
        }
      },
      onInstalled: { addListener() {} },
      openOptionsPage() {}
    },
    identity: {
      getRedirectURL: () => "https://ligchebgiheiildjcnndjoalkpiamgko.chromiumapp.org/",
      async launchWebAuthFlow(details: { url: string; interactive: boolean }) {
        mock.__authFlow = details;
        return mock.__authResponseUrl;
      }
    },
    permissions: {
      async contains() {
        return true;
      },
      async request() {
        return true;
      }
    },
    __messages: [],
    __messageHandler: null,
    __authFlow: null,
    __authResponseUrl: ""
  };
  (globalThis as { chrome?: unknown }).chrome = mock;
  return mock;
}

export function dispatchMessage(mock: ChromeMock, message: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const handler = (mock.__messageHandler ??
      (globalThis as { __evoMessageHandler?: unknown }).__evoMessageHandler) as
      | ((message: unknown, sender: unknown, sendResponse: (r: unknown) => void) => unknown)
      | null;
    if (!handler) {
      reject(new Error("no runtime message handler registered"));
      return;
    }
    const keepAlive = handler(message, {}, resolve);
    if (keepAlive !== true) resolve(undefined);
  });
}

export async function flushMicrotasks(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
