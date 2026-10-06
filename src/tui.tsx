import { Plugin } from "@opencode/plugin/tui";
import type { JSX } from "@opentui/solid";
import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  Show,
  type Accessor,
} from "solid-js";
import { formatUsd } from "./money.js";
import { CostRpc } from "./rpc.js";
import { localMonthRange } from "./time.js";
import type { Summary } from "./types.js";

export type FeedState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly summary: Summary };

/** The slice of `context.client.rpc(CostRpc)` this module depends on; tests supply a fake. */
export interface CostRpcClient {
  summary(input: { from: number; to: number }): Promise<unknown>;
  events: {
    on(
      name: "changed",
      handler: (event: { data: unknown }) => void,
    ): () => void;
  };
}

/** Bounded reconciliation: catches cost written by other server processes and the month rollover. */
const SAFETY_NET_INTERVAL_MS = 60_000;
const FOOTER_AGENT_LIMIT = 2;
const LOADING = "…";
const FAILED = "—";

export interface CostFeed {
  readonly state: Accessor<FeedState>;
}

/**
 * Fetches the current local month's summary, refreshing on `changed` and on a safety-net interval.
 * Never throws an RPC failure into the host; it becomes the `error` state.
 */
export function createCostFeed(
  client: CostRpcClient,
  now: () => Date = () => new Date(),
): CostFeed {
  const [state, setState] = createSignal<FeedState>({ kind: "loading" });

  const refresh = async (): Promise<void> => {
    const [from, to] = localMonthRange(now());
    try {
      setState({
        kind: "ready",
        summary: (await client.summary({ from, to })) as Summary,
      });
    } catch {
      setState({ kind: "error" });
    }
  };

  createEffect(() => {
    void refresh();
    onCleanup(client.events.on("changed", () => void refresh()));
    const timer = setInterval(() => void refresh(), SAFETY_NET_INTERVAL_MS);
    onCleanup(() => clearInterval(timer));
  });

  return { state };
}

function glyph(open: boolean): string {
  return open ? "▾" : "▸";
}

function amount(state: FeedState): string {
  switch (state.kind) {
    case "loading":
      return LOADING;
    case "error":
      return FAILED;
    case "ready":
      return formatUsd(state.summary.totalMicros);
  }
}

export function sidebarHeader(state: FeedState, open: boolean): string {
  return `${glyph(open)} This month: ${amount(state)}`;
}

/** Single-line footer: never grows the footer, even when opened. */
export function footerLine(state: FeedState, open: boolean): string {
  if (!open) return `${glyph(open)} ${amount(state)} this month`;
  const parts = [`${glyph(open)} ${amount(state)}`];
  if (state.kind === "ready") {
    const { agents } = state.summary;
    for (const entry of agents.slice(0, FOOTER_AGENT_LIMIT)) {
      parts.push(`${entry.agent} ${formatUsd(entry.micros)}`);
    }
    if (agents.length > FOOTER_AGENT_LIMIT)
      parts.push(`+${agents.length - FOOTER_AGENT_LIMIT}`);
  }
  return parts.join(" · ");
}

export interface OpenStateStorage {
  store(
    key: string,
    options: { readonly initial: { open: boolean } },
  ): readonly [
    { open: boolean },
    (mutation: (draft: { open: boolean }) => void) => Promise<void>,
  ];
}

/** Same storage key in every slot: one persisted open/closed state shared everywhere. */
export function createOpenState(storage: OpenStateStorage) {
  const [view, updateView] = storage.store("view", {
    initial: { open: false },
  });
  const toggle = (): void => {
    void updateView((draft) => {
      draft.open = !draft.open;
    }).catch((error: unknown) =>
      console.error("Failed to persist cost block state", error),
    );
  };
  return { view, toggle };
}

export function agentLines(
  state: FeedState,
): ReadonlyArray<{ agent: string; amount: string }> {
  if (state.kind !== "ready") return [];
  return state.summary.agents.map((entry) => ({
    agent: entry.agent,
    amount: formatUsd(entry.micros),
  }));
}

function useCostBlock(context: Plugin.Context) {
  const feed = createCostFeed(context.client.rpc(CostRpc));
  return { feed, ...createOpenState(context.storage) };
}

export function CostSidebar(props: {
  readonly context: Plugin.Context;
}): JSX.Element {
  const { feed, view, toggle } = useCostBlock(props.context);
  const theme = props.context.theme;
  return (
    <box>
      <box onMouseDown={toggle}>
        <text fg={theme.text.base}>
          {sidebarHeader(feed.state(), view.open)}
        </text>
      </box>
      <Show when={view.open}>
        <For each={agentLines(feed.state())}>
          {(line) => (
            <box flexDirection="row" gap={1} paddingLeft={2}>
              <text fg={theme.text.muted} flexGrow={1} truncate>
                {line.agent}
              </text>
              <text fg={theme.text.muted}>{line.amount}</text>
            </box>
          )}
        </For>
      </Show>
    </box>
  );
}

export function CostFooter(props: {
  readonly context: Plugin.Context;
}): JSX.Element {
  const { feed, view, toggle } = useCostBlock(props.context);
  return (
    <box onMouseDown={toggle}>
      <text fg={props.context.theme.text.muted} truncate>
        {footerLine(feed.state(), view.open)}
      </text>
    </box>
  );
}

export default Plugin.define({
  id: "opencode-cmon-tui",
  setup(context) {
    const sidebar = context.ui.slot({
      append: "sidebar.content",
      render: () => <CostSidebar context={context} />,
    });
    const footer = context.ui.slot({
      append: "home.footer.status",
      render: () => <CostFooter context={context} />,
    });
    return async () => {
      await sidebar();
      await footer();
    };
  },
});
