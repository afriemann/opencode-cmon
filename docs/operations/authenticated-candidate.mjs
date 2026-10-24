// Disposable environment adapter; never configure this in a normal location.
import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import { URL, fileURLToPath, pathToFileURL } from "node:url";

const { Request } = globalThis;

const root = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "environment.json"), "utf8"));
const candidate = (await import(pathToFileURL(path.join(root, "candidate/dist/index.js")).href)).default;
const statePath = path.join(root, "requests.json");
const armPath = path.join(root, "armed-session.json");
const record = (event, extra = {}) => fs.appendFileSync(path.join(root, "lifecycle.jsonl"),
  JSON.stringify({ event, at: Date.now(), ...extra }) + "\n");

export default {
  id: "cmon-isolated-candidate",
  async setup(ctx) {
    // A fresh run's allowance is not a renewal of the cumulative authorization.
    const configuredLimit = ctx.options?.maxRequests;
    const maxRequests = configuredLimit === undefined
      ? (manifest.maxRequests === undefined ? 3 : manifest.maxRequests) : configuredLimit;
    if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 3 ||
        (manifest.maxRequests !== undefined && manifest.maxRequests !== maxRequests))
      throw Error("Invalid or inconsistent physical request limit (expected integer 1..3)");
    if (path.resolve(ctx.location.directory) !== path.join(root, "project"))
      throw Error("Isolated adapter loaded at wrong location");
    const session = () => {
      if (!fs.existsSync(armPath)) throw Error("Inference is not armed");
      const arm = JSON.parse(fs.readFileSync(armPath, "utf8"));
      if (typeof arm.sessionID !== "string" || !arm.sessionID.startsWith("ses_") ||
          !Number.isFinite(arm.expires) || Date.now() > arm.expires ||
          arm.expires > Date.now() + 600_000) throw Error("Invalid or expired run admission");
      return arm.sessionID;
    };
    const admit = event => {
      if (event.sessionID !== session()) throw Error("Not the admitted test session");
    };
    const model = event => {
      admit(event);
      if (event.model.providerID !== "deepseek" || event.model.id !== "deepseek-flash")
        throw Error("Only deepseek/deepseek-flash is allowed");
    };
    const registrations = [];
    const hook = async (name, fn) => registrations.push(await ctx.session.hook(name, fn));
    await hook("context", event => {
      model(event);
      event.tools = {};
      event.system = [];
      event.options.maxTokens = 256;
    });
    // Supply titles locally: no auxiliary provider routing or billable title call.
    await hook("title", event => { admit(event); event.result = "Cost display verification"; });
    for (const name of ["compaction", "generate"])
      await hook(name, () => { throw Error("Auxiliary generation is disabled for this run"); });
    await hook("retry", event => { event.decision = { retry: false }; });
    await hook("experimental.ws.handshake", () => { throw Error("WebSocket requests are disabled"); });
    await hook("model.request", event => {
      model(event);
      if (event.kind !== "primary") throw Error("Only primary generation is allowed");
    });
    await hook("http.request", event => {
      model(event);
      if (event.kind !== "primary") throw Error("Auxiliary HTTP generation is disabled");
      const url = new URL(event.request.url);
      const queryPresent = url.href.split("#", 1)[0].includes("?");
      if (event.request.method !== "POST" || url.origin !== "https://api.deepseek.com" ||
          url.pathname !== "/chat/completions" || queryPresent ||
          url.username || url.password || url.hash) {
        record("http-rejected", { method: event.request.method, origin: url.origin,
          path: url.pathname, queryPresent });
        throw Error("Unexpected provider endpoint");
      }
      // Replace the outgoing body, not stored history. No tools, files, inherited
      // instructions, images or previous conversation can reach the provider.
      const body = JSON.stringify({ model: "deepseek-flash", stream: true,
        stream_options: { include_usage: true }, max_tokens: 256,
        thinking: { type: "disabled" }, messages: [{ role: "user", content: "Reply OK." }] });
      event.request = new Request(event.request, { body, redirect: "error" });
      event.request.headers.delete("content-length");
      const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
      if (!Number.isSafeInteger(state.attempts) || state.attempts < 0 ||
          state.attempts >= maxRequests || state.reservedUSD !== state.attempts * 0.01 ||
          (state.maxRequests !== undefined && state.maxRequests !== maxRequests))
        throw Error("Invalid reservation state or configured request ceiling reached");
      // Synchronous reservation precedes native dispatch, survives reload, and
      // conservatively counts an attempted send even if transport later fails.
      state.attempts += 1;
      state.reservedUSD = state.attempts * 0.01;
      state.maxRequests = maxRequests;
      fs.writeFileSync(statePath, JSON.stringify(state));
      record("http-attempt", { number: state.attempts, maxRequests, kind: event.kind,
        providerID: event.model.providerID, modelID: event.model.id, bodyBytes: Buffer.byteLength(body) });
    });
    const events = {
      async *subscribe(options) {
        for await (const event of ctx.event.subscribe(options)) {
          if (event.type === "model.updated") { yield event; continue; }
          // Do not admit unrelated orchestration or other locations' usage.
          if (!fs.existsSync(armPath)) continue;
          let id;
          try { id = session(); } catch { continue; }
          if (event.data?.sessionID === id) yield event;
        }
      },
    };
    const cleanup = await candidate.setup({ ...ctx, event: events,
      options: { dbPath: path.join(root, "ledger.sqlite"),
        sourceDbPath: path.join(root, "absent-source.sqlite") } });
    if (!cleanup) throw Error("Candidate failed to activate");
    record("ready", { revision: manifest.revision, host: ctx.app.version, candidateID: candidate.id });
    return async () => {
      try { await cleanup(); }
      finally { for (const registration of registrations.reverse()) await registration.dispose(); record("disposed"); }
    };
  },
};
