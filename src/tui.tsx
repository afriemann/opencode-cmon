import { Plugin } from "@opencode/plugin/tui";
import type { BoxRenderable } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  type Accessor,
} from "solid-js";
import { formatUsd } from "./money.js";
import { CostRpc } from "./rpc.js";
import { localMonthRange } from "./time.js";
import type { Summary, SummaryReply, TokenSummary } from "./types.js";

export type FeedState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly summary: SummaryReply };

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

/** Which unit both slots present. Session-only: a new TUI starts in dollars. */
export type Unit = "dollars" | "tokens";

/** Bounded reconciliation: catches cost written by other server processes and the month rollover. */
const SAFETY_NET_INTERVAL_MS = 60_000;
/** While in the error state, e.g. the server restarted and the RPC is not registered yet. */
const ERROR_RETRY_INTERVAL_MS = 5_000;
const FOOTER_AGENT_LIMIT = 2;
const LOADING = "…";
const FAILED = "Error";
const TOKENS_UNAVAILABLE = "Tokens unavailable";
const TOKEN_PARTIAL = "Partial: some token counts unavailable";
/** Header label text, kept as one piece so it stays a single non-selectable run. */
const MONTH_LABEL = "This month: ";
const CONTROL_INDENT = 2;
/** Two spaces between choices. */
const CHOICE_GAP = 2;
/** A breakdown name narrower than this would be unreadable, so the amount moves to its own line. */
const MIN_NAME_CELLS = 4;

export interface CostFeed {
  readonly state: Accessor<FeedState>;
}

/**
 * Fetches the current local month's summary, refreshing on `changed` and on a safety-net interval,
 * and retrying every few seconds while in the `error` state.
 * Never throws an RPC failure into the host; it becomes the `error` state.
 */
export function createCostFeed(
  client: CostRpcClient,
  now: () => Date = () => new Date(),
): CostFeed {
  const [state, setState] = createSignal<FeedState>({ kind: "loading" });

  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const cancelRetry = (): void => {
    clearTimeout(retryTimer);
    retryTimer = undefined;
  };

  const refresh = async (): Promise<void> => {
    const [from, to] = localMonthRange(now());
    try {
      const summary = (await client.summary({ from, to })) as SummaryReply;
      cancelRetry();
      setState({ kind: "ready", summary });
    } catch {
      setState({ kind: "error" });
      if (!disposed)
        retryTimer ??= setTimeout(() => {
          retryTimer = undefined;
          void refresh();
        }, ERROR_RETRY_INTERVAL_MS);
    }
  };

  createEffect(() => {
    void refresh();
    onCleanup(client.events.on("changed", () => void refresh()));
    const timer = setInterval(() => void refresh(), SAFETY_NET_INTERVAL_MS);
    onCleanup(() => clearInterval(timer));
    onCleanup(() => {
      disposed = true;
      cancelRetry();
    });
  });

  return { state };
}

export function glyph(open: boolean): string {
  return open ? "▼" : "▶";
}

interface TokenScale {
  readonly suffix: string;
  readonly divisor: number;
}

const BILLION: TokenScale = { suffix: "B", divisor: 1_000_000_000 };
const MILLION: TokenScale = { suffix: "M", divisor: 1_000_000 };
const THOUSAND: TokenScale = { suffix: "k", divisor: 1_000 };

/** Largest scale that keeps the value at or above one whole unit; `B` caps larger amounts. */
function tokenScale(count: number): TokenScale {
  if (count >= BILLION.divisor) return BILLION;
  if (count >= MILLION.divisor) return MILLION;
  return THOUSAND;
}

/** The next larger scale, used when rounding reaches `1000` of the current unit. */
function promotedScale(scale: TokenScale): TokenScale {
  return scale === THOUSAND ? MILLION : BILLION;
}

/** Scaled value in hundredths: at most two decimals, nearest with halfway rounded up. */
function scaledHundredths(count: number, scale: TokenScale): number {
  return Math.round(count / (scale.divisor / 100));
}

/** Drop trailing fractional zeroes and a bare decimal point. */
function formatHundredths(hundredths: number): string {
  const whole = Math.trunc(hundredths / 100);
  const fraction = hundredths % 100;
  if (fraction === 0) return `${whole}`;
  const decimals =
    fraction % 10 === 0 ? `${fraction / 10}` : `${fraction}`.padStart(2, "0");
  return `${whole}.${decimals}`;
}

/**
 * Compact token count: exact below 1,000, otherwise the largest applicable decimal `k`/`M`/`B`
 * with at most two decimals. Rounding up to `1000` promotes to the next scale, and `B` is the
 * highest scale. Presentation only: stored, aggregated and ranked counts stay exact.
 */
export function formatTokens(count: number): string {
  if (count < THOUSAND.divisor) return `${count}`;
  let scale = tokenScale(count);
  let hundredths = scaledHundredths(count, scale);
  if (hundredths >= 100_000 && scale !== BILLION) {
    scale = promotedScale(scale);
    hundredths = scaledHundredths(count, scale);
  }
  return `${formatHundredths(hundredths)}${scale.suffix}`;
}

/**
 * One token amount. An unknown subtotal is unavailable, not zero; an incomplete one is marked `~`.
 * Exactly one is singular; every other amount, including abbreviated ones, keeps `tokens`.
 */
export function tokenAmount(
  totalTokens: number | null | undefined,
  complete: boolean | undefined,
): string {
  if (totalTokens === null || totalTokens === undefined)
    return TOKENS_UNAVAILABLE;
  const label = totalTokens === 1 ? "token" : "tokens";
  return `${complete === false ? "~" : ""}${formatTokens(totalTokens)} ${label}`;
}

function dollarsAmount(summary: Summary): string {
  // `~` marks a total that may be understated because some pricing is unknown.
  return `${summary.complete === false ? "~" : ""}${formatUsd(summary.totalMicros)}`;
}

export function amount(state: FeedState, unit: Unit = "dollars"): string {
  switch (state.kind) {
    case "loading":
      return LOADING;
    case "error":
      return FAILED;
    case "ready":
      return unit === "tokens"
        ? tokenAmount(
            state.summary.tokens?.totalTokens,
            state.summary.tokens?.complete,
          )
        : dollarsAmount(state.summary);
  }
}

/**
 * Why token mode cannot show a full month, if it cannot. Pricing completeness never contributes:
 * unknown prices leave token amounts complete. Empty and complete months have no warning.
 */
export function tokenWarning(state: FeedState, unit: Unit): string | undefined {
  if (unit !== "tokens" || state.kind !== "ready") return undefined;
  const tokens = state.summary.tokens;
  if (tokens === undefined || tokens.complete === false) return TOKEN_PARTIAL;
  return undefined;
}

function agentParts(
  summary: SummaryReply,
  unit: Unit,
): ReadonlyArray<{ label: string; amount: string }> {
  if (unit === "tokens") {
    const tokens = summary.tokens;
    // An older server supplies no token ranking; keep its dollar names in their order.
    if (tokens === undefined)
      return summary.agents.map((entry) => ({
        label: entry.agent,
        amount: TOKENS_UNAVAILABLE,
      }));
    return tokens.agents.map((entry) => ({
      label: entry.agent,
      amount: tokenAmount(entry.totalTokens, entry.complete),
    }));
  }
  return summary.agents.map((entry) => ({
    label: entry.agent,
    amount: formatUsd(entry.micros),
  }));
}

/** Single-line footer: never grows the footer, even when opened. */
export function footerLine(
  state: FeedState,
  open: boolean,
  unit: Unit = "dollars",
): string {
  if (!open) return `${glyph(open)} ${amount(state, unit)} this month`;
  const parts = [`${glyph(open)} ${amount(state, unit)}`];
  if (state.kind === "ready") {
    const entries = agentParts(state.summary, unit);
    for (const entry of entries.slice(0, FOOTER_AGENT_LIMIT))
      parts.push(`${entry.label} ${entry.amount}`);
    if (entries.length > FOOTER_AGENT_LIMIT)
      parts.push(`+${entries.length - FOOTER_AGENT_LIMIT}`);
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

export interface UnitState {
  unit: Unit;
}

export interface UnitStateStorage {
  memory(
    key: "unit",
    options: { readonly initial: UnitState },
  ): readonly [UnitState, (mutation: (draft: UnitState) => void) => void];
}

/**
 * One live session memory shared by both slots. It survives remounts and plugin reloads within a
 * running TUI and is discarded when the TUI exits, so a restart starts in dollars while the durable
 * open/closed preference is untouched.
 */
export function createUnitState(storage: UnitStateStorage) {
  const [state, update] = storage.memory("unit", {
    initial: { unit: "dollars" },
  });
  const select = (unit: Unit): void => {
    if (state.unit === unit) return;
    update((draft) => {
      draft.unit = unit;
    });
  };
  return { unitState: state, select };
}

export type Breakdown = "agent" | "model" | "provider";

export function breakdownLines(
  state: FeedState,
  breakdown: Breakdown,
  unit: Unit = "dollars",
): ReadonlyArray<{ label: string; amount: string }> {
  if (state.kind !== "ready") return [];
  const { summary } = state;
  const tokens: TokenSummary | undefined = summary.tokens;
  if (unit === "tokens") {
    if (tokens === undefined) {
      // A server without token support: keep its names in their supplied order, unavailable amounts.
      const names =
        breakdown === "agent"
          ? summary.agents.map((e) => e.agent)
          : breakdown === "model"
            ? (summary.models ?? []).map((e) => e.model)
            : (summary.providers ?? []).map((e) => e.provider);
      return names.map((label) => ({ label, amount: TOKENS_UNAVAILABLE }));
    }
    const entries =
      breakdown === "agent"
        ? tokens.agents.map((e) => ({
            label: e.agent,
            amount: tokenAmount(e.totalTokens, e.complete),
          }))
        : breakdown === "model"
          ? tokens.models.map((e) => ({
              label: e.model,
              amount: tokenAmount(e.totalTokens, e.complete),
            }))
          : tokens.providers.map((e) => ({
              label: e.provider,
              amount: tokenAmount(e.totalTokens, e.complete),
            }));
    return entries;
  }
  // A server process still running an older plugin replies without `models`/`providers`.
  switch (breakdown) {
    case "agent":
      return summary.agents.map((e) => ({
        label: e.agent,
        amount: formatUsd(e.micros),
      }));
    case "model":
      return (summary.models ?? []).map((e) => ({
        label: e.model,
        amount: formatUsd(e.micros),
      }));
    case "provider":
      return (summary.providers ?? []).map((e) => ({
        label: e.provider,
        amount: formatUsd(e.micros),
      }));
  }
}

/** One clickable control: the active choice is bracketed and bold so it reads without colour. */
export interface Choice<Mode> {
  readonly text: string;
  readonly bold: boolean;
  readonly mode?: Mode;
  /** Reserved cells for the widest selection; text keeps its own width so spare cells stay inert. */
  readonly width: number;
}

const BREAKDOWN_LABELS: ReadonlyArray<readonly [Breakdown, string]> = [
  ["agent", "Agents"],
  ["model", "Models"],
  ["provider", "Providers"],
];

/** Toggle row pieces; the active tab is bracketed and bold so it reads without colour. */
export function toggleSegments(
  active: Breakdown,
): ReadonlyArray<Choice<Breakdown>> {
  return [
    { text: "View", bold: false, width: "View".length },
    ...BREAKDOWN_LABELS.map(([mode, label]) => {
      const bold = mode === active;
      return {
        text: bold ? `[${label}]` : label,
        bold,
        mode,
        width: `[${label}]`.length,
      };
    }),
  ];
}

/** Unit choices; only the rendered text of a choice is a click target. */
export function unitSegments(active: Unit): ReadonlyArray<Choice<Unit>> {
  return [
    { text: "Unit", bold: false, width: "Unit".length },
    {
      text: active === "dollars" ? "[$]" : "$",
      bold: active === "dollars",
      mode: "dollars",
      width: "[$]".length,
    },
    {
      text: active === "tokens" ? "[Tokens]" : "Tokens",
      bold: active === "tokens",
      mode: "tokens",
      width: "[Tokens]".length,
    },
  ];
}

export type ControlKind = "breakdown" | "unit";

/** One selector row: either the View group or the Unit group, never both. */
export interface ControlRow {
  readonly kind: ControlKind;
  readonly segments: ReadonlyArray<Choice<Breakdown | Unit>>;
}

/** Greedy packing of whole segments at reserved widths, so a control never splits across rows. */
function packRow(
  kind: ControlKind,
  segments: ReadonlyArray<Choice<Breakdown | Unit>>,
  available: number,
): ControlRow[] {
  const rows: ControlRow[] = [];
  let current: Array<Choice<Breakdown | Unit>> = [];
  let used = 0;
  for (const segment of segments) {
    const needed = (current.length > 0 ? CHOICE_GAP : 0) + segment.width;
    if (current.length > 0 && used + needed > available) {
      rows.push({ kind, segments: current });
      current = [];
      used = 0;
    }
    used += current.length > 0 ? CHOICE_GAP + segment.width : segment.width;
    current.push(segment);
  }
  if (current.length > 0) rows.push({ kind, segments: current });
  return rows;
}

/**
 * Selector rows from the panel's actual content width, not the terminal width. View and Unit never
 * share a row, so each group wraps only between whole choices and keeps its reserved widths.
 */
export function controlRows(
  width: number,
  breakdown: Breakdown,
  unit: Unit,
): ReadonlyArray<ControlRow> {
  const available = Math.max(1, width - CONTROL_INDENT);
  return [
    ...packRow("breakdown", toggleSegments(breakdown), available),
    ...packRow("unit", unitSegments(unit), available),
  ];
}

/** The amount stays on the header line when the glyph, label and whole amount fit. */
function headerFits(width: number, amountText: string): boolean {
  return 1 + 1 + MONTH_LABEL.length + amountText.length <= width;
}

/** Cells left for a breakdown name after the indent, one separator and the intact amount. */
function nameCells(width: number, amountText: string): number {
  return width - CONTROL_INDENT - 1 - amountText.length;
}

/** Truncate only the name, ending with an ellipsis; amounts are never truncated or wrapped. */
function fitName(name: string, cells: number): string {
  if (name.length <= cells) return name;
  if (cells <= 0) return "";
  return `${name.slice(0, cells - 1)}…`;
}

/**
 * The panel's own content width, measured from the renderable the host actually lays out. The
 * terminal width is not a substitute: a sidebar can be narrow inside a wide terminal. The callback
 * runs inside the layout pass, so the reactive write waits for the next microtask.
 */
function usePanelWidth(): readonly [
  Accessor<number>,
  (this: BoxRenderable) => void,
] {
  const [width, setWidth] = createSignal(0);
  const onSizeChange = function (this: BoxRenderable): void {
    const measured = this.width;
    queueMicrotask(() => setWidth(measured));
  };
  return [width, onSizeChange] as const;
}

function useCostBlock(context: Plugin.Context) {
  const feed = createCostFeed(context.client.rpc(CostRpc));
  return {
    feed,
    ...createOpenState(context.storage),
    ...createUnitState(context.storage),
  };
}

export function CostSidebar(props: {
  readonly context: Plugin.Context;
}): JSX.Element {
  const { feed, view, toggle, unitState, select } = useCostBlock(props.context);
  const theme = props.context.theme;
  const [breakdown, setBreakdown] = createSignal<Breakdown>("agent");
  const [panelWidth, onSizeChange] = usePanelWidth();
  const unit = (): Unit => unitState.unit;
  const amountText = (): string => amount(feed.state(), unit());
  const amountColor = (): string =>
    feed.state().kind === "error"
      ? theme.text.feedback.error.base
      : theme.text.base;
  const rows = createMemo(() => controlRows(panelWidth(), breakdown(), unit()));
  const warning = createMemo(() => tokenWarning(feed.state(), unit()));
  /** Only a rendered choice changes state: labels and gaps have no mode. */
  const choose = (
    kind: ControlKind,
    mode: Breakdown | Unit | undefined,
  ): void => {
    if (mode === "agent" || mode === "model" || mode === "provider") {
      if (kind === "breakdown") setBreakdown(mode);
      return;
    }
    if (mode === "dollars" || mode === "tokens") select(mode);
  };

  return (
    <box
      onSizeChange={onSizeChange}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <Show
        when={headerFits(panelWidth(), amountText())}
        fallback={
          <box flexDirection="column" onMouseDown={toggle}>
            <box flexDirection="row" gap={1}>
              <text fg={theme.text.base} selectable={false}>
                {glyph(view.open)}
              </text>
              <text fg={theme.text.base} selectable={false}>
                <b>This month</b>
                {": "}
              </text>
            </box>
            <box paddingLeft={CONTROL_INDENT}>
              <text fg={amountColor()} wrapMode="none">
                {amountText()}
              </text>
            </box>
          </box>
        }
      >
        <box flexDirection="row" gap={1} onMouseDown={toggle}>
          <text fg={theme.text.base} selectable={false}>
            {glyph(view.open)}
          </text>
          <box flexDirection="row">
            <text fg={theme.text.base} selectable={false}>
              <b>This month</b>
              {": "}
            </text>
            <text fg={amountColor()} wrapMode="none">
              {amountText()}
            </text>
          </box>
        </box>
      </Show>
      <Show when={view.open}>
        <Show when={feed.state().kind === "ready"}>
          <For each={rows()}>
            {(row) => (
              <box
                flexDirection="row"
                gap={CHOICE_GAP}
                paddingLeft={CONTROL_INDENT}
              >
                <For each={row.segments}>
                  {(segment) => (
                    <Show
                      when={segment.mode !== undefined}
                      fallback={
                        <text
                          fg={theme.text.action.primary.base}
                          selectable={false}
                        >
                          {segment.text}
                        </text>
                      }
                    >
                      <box
                        width={segment.width}
                        flexShrink={0}
                        flexDirection="row"
                      >
                        <text
                          fg={theme.text.action.primary.base}
                          selectable={false}
                          onMouseDown={() => choose(row.kind, segment.mode)}
                        >
                          {segment.bold ? <b>{segment.text}</b> : segment.text}
                        </text>
                      </box>
                    </Show>
                  )}
                </For>
              </box>
            )}
          </For>
          <Show when={warning()}>
            <box paddingLeft={CONTROL_INDENT}>
              <text fg={theme.text.muted} wrapMode="word">
                {warning()}
              </text>
            </box>
          </Show>
        </Show>
        <For each={breakdownLines(feed.state(), breakdown(), unit())}>
          {(line) => (
            <Show
              when={nameCells(panelWidth(), line.amount) >= MIN_NAME_CELLS}
              fallback={
                <box flexDirection="column">
                  <box paddingLeft={CONTROL_INDENT}>
                    <text fg={theme.text.muted} wrapMode="none">
                      {fitName(line.label, panelWidth() - CONTROL_INDENT)}
                    </text>
                  </box>
                  <box paddingLeft={CONTROL_INDENT}>
                    <text fg={theme.text.muted} wrapMode="none">
                      {line.amount}
                    </text>
                  </box>
                </box>
              }
            >
              <box flexDirection="row" gap={1} paddingLeft={CONTROL_INDENT}>
                <text
                  fg={theme.text.muted}
                  wrapMode="none"
                  width={nameCells(panelWidth(), line.amount)}
                >
                  {fitName(line.label, nameCells(panelWidth(), line.amount))}
                </text>
                <text fg={theme.text.muted} wrapMode="none">
                  {line.amount}
                </text>
              </box>
            </Show>
          )}
        </For>
      </Show>
    </box>
  );
}

export function CostFooter(props: {
  readonly context: Plugin.Context;
}): JSX.Element {
  const { feed, view, toggle, unitState } = useCostBlock(props.context);
  const text = (): string =>
    footerLine(feed.state(), view.open, unitState.unit);
  // The host row allocates this contribution its share of the row; the text is never measured, so
  // its own clipped width cannot become the next layout pass's available space. `wrapMode="none"`
  // keeps one line and the row clips only the trailing end when space is genuinely short.
  return (
    <box flexShrink={1} overflow="hidden" onMouseDown={toggle}>
      <text
        fg={
          feed.state().kind === "error"
            ? props.context.theme.text.feedback.error.base
            : props.context.theme.text.muted
        }
        wrapMode="none"
      >
        {text()}
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
