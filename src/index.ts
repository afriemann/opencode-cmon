import { Plugin } from "@opencode/plugin";
import { runBackfill } from "./backfill";
import { createRecorder, type CostEvent } from "./recorder";
import { CostRpc } from "./rpc";
import { opencodeDataDir, Store } from "./store";
import { retentionCutoff } from "./time";
import { join } from "node:path";

const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

function stringOption(
  options: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = options[key];
  return typeof value === "string" ? value : undefined;
}

export default Plugin.define({
  id: "opencode-cmon",
  async setup(ctx) {
    const options = (ctx.options ?? {}) as Record<string, unknown>;
    const log = (message: string) => {
      process.stderr.write(`[opencode-cmon] ${message}\n`);
    };

    let store: Store;
    try {
      const dbPath = stringOption(options, "dbPath");
      store = new Store(dbPath !== undefined ? { dbPath } : {});
    } catch (error) {
      // A broken ledger must not stop the opencode session from starting.
      log(`failed to open store, cost tracking disabled: ${String(error)}`);
      return;
    }

    const sourcePath =
      stringOption(options, "sourceDbPath") ??
      join(opencodeDataDir(), "opencode.db");
    runBackfill(store, {
      sourcePath,
      cutoff: retentionCutoff(new Date()),
      log,
    });
    store.prune(retentionCutoff(new Date()));

    const rpc = await ctx.rpc.register(CostRpc, {
      summary: async (input: unknown) => {
        const { from, to } = input as { from: number; to: number };
        return store.summary(from, to);
      },
    });
    const notify = async (): Promise<void> => {
      try {
        await rpc.events.emit("changed", { revision: store.revision() });
      } catch (error) {
        log(`failed to emit changed: ${String(error)}`);
      }
    };

    const pruneTimer = setInterval(() => {
      try {
        if (store.prune(retentionCutoff(new Date())) > 0) void notify();
      } catch (error) {
        log(`prune failed: ${String(error)}`);
      }
    }, PRUNE_INTERVAL_MS);
    pruneTimer.unref();

    const recorder = createRecorder({
      resolveParent: async (sessionID) => {
        const session = (await ctx.session.get({ sessionID })) as {
          parentID?: string;
        };
        return session.parentID ?? null;
      },
      now: Date.now,
    });

    const abort = new AbortController();
    const loop = (async () => {
      try {
        for await (const event of ctx.event.subscribe({
          signal: abort.signal,
        })) {
          try {
            const row = await recorder.handle(event as CostEvent);
            if (row) {
              store.upsertLive(row);
              await notify();
            }
          } catch (error) {
            log(`failed to record ${event.type}: ${String(error)}`);
          }
        }
      } catch (error) {
        if (!abort.signal.aborted)
          log(`event subscription failed: ${String(error)}`);
      }
    })();

    return async () => {
      abort.abort();
      clearInterval(pruneTimer);
      await loop;
      await rpc.dispose();
      store.close();
    };
  },
});
