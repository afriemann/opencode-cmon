// TEST ONLY: contract-shaped host double, not proof of the live OpenCode host.
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createStore, produce } from "solid-js/store";
import plugin from "../index";
import { Store } from "../store";
import type { CostRpcClient } from "../tui";
import type { Summary } from "../types";

// Mirrors design.md's additive public reply, without requiring production types early.
export interface TokenProjection {
  totalTokens: number | null;
  complete: boolean;
  agents: ReadonlyArray<{
    agent: string;
    totalTokens: number | null;
    complete: boolean;
  }>;
  models: ReadonlyArray<{
    model: string;
    totalTokens: number | null;
    complete: boolean;
  }>;
  providers: ReadonlyArray<{
    provider: string;
    totalTokens: number | null;
    complete: boolean;
  }>;
}
export type TokenReply = Summary & { tokens?: TokenProjection };

export function storage(open = true) {
  const [view, setView] = createStore({ open });
  const durableWrites: string[] = [];
  const memories = new Map<string, ReturnType<typeof memoryPair>>();
  function memoryPair(initial: object) {
    const [state, update] = createStore(initial);
    return [
      state,
      (mutate: (draft: object) => void) => update(produce(mutate)),
    ] as const;
  }
  return {
    view,
    durableWrites,
    store: (key: string) => {
      if (key !== "view") throw new Error(`Unexpected durable key ${key}`);
      return [
        view,
        async (mutate: (draft: { open: boolean }) => void) => {
          setView(produce(mutate));
          durableWrites.push(key);
        },
      ] as const;
    },
    memory: (key: string, options: { initial: object }) => {
      if (key !== "unit") throw new Error(`Unexpected memory key ${key}`);
      if (!memories.has(key)) memories.set(key, memoryPair(options.initial));
      return memories.get(key)!;
    },
  };
}

export function uiContext(client: CostRpcClient, state = storage()) {
  const color = (base: string) => ({ base });
  return {
    client: { rpc: () => client },
    storage: state,
    theme: {
      text: {
        base: "#ffffff",
        muted: "#888888",
        feedback: { error: color("#ff0000") },
        action: { primary: color("#00aaff") },
      },
    },
  } as never;
}

export async function server() {
  const base = join(process.cwd(), "node_modules", ".cache", "cmon-tests");
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, "tokens-"));
  const dbPath = join(dir, "ledger.db");
  // Mark import complete so no startup historical repair can alter test fixtures.
  const seed = new Store({ dbPath });
  seed.completeBackfill([]);
  seed.close();
  const db = new Database(dbPath);
  let handler: (input: unknown) => Promise<unknown> = async () => {
    throw new Error("RPC not registered");
  };
  let wake = () => {};
  let subscribed = false;
  const pending: unknown[] = [];
  const listeners = new Set<(event: { data: unknown }) => void>();
  let calls = 0;
  const client: CostRpcClient = {
    summary: async (input) => {
      calls++;
      return JSON.parse(JSON.stringify(await handler(input)));
    },
    events: {
      on: (_name, callback) => {
        listeners.add(callback);
        return () => {
          listeners.delete(callback);
        };
      },
    },
  };
  const context = {
    options: {
      dbPath,
      sourceDbPath: join(dir, "absent.db"),
      notifyDebounceMs: 5,
    },
    rpc: {
      register: async (
        _definition: unknown,
        methods: { summary: typeof handler },
      ) => {
        handler = methods.summary;
        return {
          events: {
            emit: async (_name: string, data: unknown) => {
              for (const listener of listeners) listener({ data });
            },
          },
          dispose: async () => {},
        };
      },
    },
    model: { list: async () => ({ data: [] }) },
    session: { get: async () => ({ parentID: "parent" }) },
    tool: { transform: async () => ({ dispose: async () => {} }) },
    event: {
      subscribe: ({ signal }: { signal: AbortSignal }) => ({
        async *[Symbol.asyncIterator]() {
          subscribed = true;
          // One abort listener; wake is replaced each time the queue empties.
          signal.addEventListener("abort", () => wake(), { once: true });
          while (!signal.aborted) {
            const next = pending.shift();
            if (next) yield next;
            else
              await new Promise<void>((resolve) => {
                wake = resolve;
              });
          }
        },
      }),
    },
  };
  let dispose: (() => Promise<void>) | undefined;
  try {
    dispose = await (
      plugin as unknown as {
        setup(c: unknown): Promise<() => Promise<void>>;
      }
    ).setup(context);
  } catch (error) {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  return {
    db,
    client,
    dir,
    calls: () => calls,
    subscribed: () => subscribed,
    listeners: () => listeners.size,
    summary: async (from = 0, to = Date.now() + 86_400_000) =>
      (await client.summary({ from, to })) as TokenReply,
    push: (...events: unknown[]) => {
      pending.push(...events);
      wake();
    },
    close: async () => {
      try {
        await dispose?.();
      } finally {
        db.close();
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
