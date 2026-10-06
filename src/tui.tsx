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
const FAILED = "Error";

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

export function glyph(open: boolean): string {
  return open ? "▼" : "▶";
}

export function amount(state: FeedState): string {
  switch (state.kind) {
    case "loading":
      return LOADING;
    case "error":
      return FAILED;
    case "ready":
      return formatUsd(state.summary.totalMicros);
  }
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

export type Breakdown = "agent" | "model";

export function breakdownLines(
  state: FeedState,
  breakdown: Breakdown,
): ReadonlyArray<{ label: string; amount: string }> {
  if (state.kind !== "ready") return [];
  const { agents, models } = state.summary;
  if (breakdown === "agent")
    return agents.map((e) => ({ label: e.agent, amount: formatUsd(e.micros) }));
  // A server process still running an older plugin replies without `models`.
  return (models ?? []).map((e) => ({
    label: e.model,
    amount: formatUsd(e.micros),
  }));
}

const BREAKDOWN_LABELS: ReadonlyArray<readonly [Breakdown, string]> = [
  ["agent", "Agents"],
  ["model", "Models"],
];

/** Toggle row pieces; the active one is bracketed and bold so it reads without colour. */
export function toggleSegments(
  active: Breakdown,
): ReadonlyArray<{ text: string; bold: boolean }> {
  return [
    { text: "View", bold: false },
    ...BREAKDOWN_LABELS.map(([mode, label]) =>
      mode === active
        ? { text: `[${label}]`, bold: true }
        : { text: label, bold: false },
    ),
  ];
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
  const [breakdown, setBreakdown] = createSignal<Breakdown>("agent");
  const flip = (): void => {
    setBreakdown((mode) => (mode === "agent" ? "model" : "agent"));
  };
  return (
    <box>
      <box flexDirection="row" gap={1} onMouseDown={toggle}>
        <text fg={theme.text.base}>{glyph(view.open)}</text>
        <text fg={theme.text.base}>
          <b>This month</b>
          {": "}
          <span
            style={{
              fg:
                feed.state().kind === "error"
                  ? theme.text.feedback.error.base
                  : theme.text.base,
            }}
          >
            {amount(feed.state())}
          </span>
        </text>
      </box>
      <Show when={view.open}>
        <Show when={feed.state().kind === "ready"}>
          <box flexDirection="row" gap={2} paddingLeft={2} onMouseDown={flip}>
            <For each={toggleSegments(breakdown())}>
              {(segment) => (
                <text fg={theme.text.action.primary.base}>
                  {segment.bold ? <b>{segment.text}</b> : segment.text}
                </text>
              )}
            </For>
          </box>
        </Show>
        <For each={breakdownLines(feed.state(), breakdown())}>
          {(line) => (
            <box flexDirection="row" gap={1} paddingLeft={2}>
              <text fg={theme.text.muted} flexGrow={1} truncate>
                {line.label}
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
      <text
        fg={
          feed.state().kind === "error"
            ? props.context.theme.text.feedback.error.base
            : props.context.theme.text.muted
        }
        truncate
      >
        {footerLine(feed.state(), view.open)}
      </text>
    </box>
  );
}

export default Plugin.define({
  id: "opencode-cmon-tui",
  setup(context) {
    const sidebar = context.ui.slot({
      prepend: "sidebar.content",
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
