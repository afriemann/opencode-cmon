import { Plugin } from "@opencode/plugin";
import { runBackfill, runTokenFill } from "./backfill";
import { createPriceLookup } from "./pricing";
import { createRecorder, type CostEvent } from "./recorder";
import { CostRpc } from "./rpc";
import { opencodeDataDir, Store } from "./store";
import { buildSummary } from "./summary";
import { retentionCutoff } from "./time";
import { join } from "node:path";

const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_NOTIFY_DEBOUNCE_MS = 500;

function stringOption(
  options: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = options[key];
  return typeof value === "string" ? value : undefined;
}

function numberOption(
  options: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = options[key];
  return typeof value === "number" ? value : undefined;
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
    const notifyDebounceMs =
      numberOption(options, "notifyDebounceMs") ?? DEFAULT_NOTIFY_DEBOUNCE_MS;

    // Every change notification goes through one trailing debounce, so bursts of writes or
    // catalog updates make the TUI refresh once.
    const registration: {
      current?: Awaited<ReturnType<typeof ctx.rpc.register<typeof CostRpc>>>;
    } = {};
    let notifyTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const scheduleNotify = (): void => {
      if (notifyTimer || disposed) return;
      notifyTimer = setTimeout(() => {
        notifyTimer = undefined;
        registration.current?.events
          .emit("changed", { revision: store.revision() })
          .catch((error: unknown) =>
            log(`failed to emit changed: ${String(error)}`),
          );
      }, notifyDebounceMs);
      notifyTimer.unref();
    };

    const lookup = createPriceLookup(
      () => ctx.model.list(),
      log,
      scheduleNotify,
    );
    lookup.refresh("updated");

    const cutoff = () => retentionCutoff(new Date());
    runBackfill(store, { sourcePath, cutoff: cutoff(), log });
    runTokenFill(store, { sourcePath, cutoff: cutoff(), log });
    store.prune(cutoff());

    registration.current = await ctx.rpc.register(CostRpc, {
      summary: async (input: unknown) => {
        const { from, to } = input as { from: number; to: number };
        const inputs = store.summaryInputs(from, to);
        const built = buildSummary(inputs, inputs.candidates, lookup.table());
        if (built.unpriced.length > 0) lookup.refresh("miss");
        return {
          revision: inputs.revision,
          totalMicros: built.totalMicros,
          agents: built.agents,
          models: built.models,
          providers: built.providers,
          complete: built.complete,
        };
      },
    });

    const pruneTimer = setInterval(() => {
      try {
        if (store.prune(cutoff()) > 0) scheduleNotify();
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
            if (event.type === "model.updated") {
              lookup.refresh("updated");
              continue;
            }
            const row = await recorder.handle(event as CostEvent);
            if (row) {
              store.upsertLive(row);
              scheduleNotify();
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
      // After the loop: a late event or catalog change must not re-arm the timer.
      disposed = true;
      clearTimeout(notifyTimer);
      await registration.current?.dispose();
      store.close();
    };
  },
});
