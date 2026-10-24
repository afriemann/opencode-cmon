"""Finite, scratch-only Windows acceptance driver. Default: no prompt, no admission.

Uses only the private terminal client's public API; never reads auth files.
windows-job.py owns the new worker, terminal and private-host descendants.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import queue
import re
import sqlite3
import subprocess
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[2]
REVISION = "9a55b54b0db1ea9546811aed55da1a54c95baf89"
HASHES = {"dist/index.js": "1fcb37595b2a81ca1d45bc1f9a5e99776ff9b88d3cdb19281525b4cc8caa5f6c",
          "dist/tui.js": "643163b107ea1226cf1bb5236b067b724f887d791a1de6d59bd30e6fea40cbbe",
          "bun.lock": "489dcc606351dfc3cf56620b81f1ab15d090fd340ed5acd11e5f001d499c6184"}


def write(path, value):
    path.write_text(json.dumps(value, indent=2), encoding="utf-8")


def load(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def execute(command, cwd=ROOT, timeout=15, env=None):
    result = subprocess.run(command, cwd=cwd, timeout=timeout, env=env,
                            capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode:
        # Do not publish raw shared-service responses or connection details.
        raise AssertionError(f"{command[0]} {command[1]} exited {result.returncode}")
    return result.stdout


def ledger(run):
    # Read-only, scratch ledger only; no host history or normal ledger access.
    with sqlite3.connect((run / "ledger.sqlite").as_uri() + "?mode=ro", uri=True, timeout=2) as db:
        db.row_factory = sqlite3.Row
        return {"rows": [dict(row) for row in db.execute("SELECT * FROM cost_entry ORDER BY id")],
                "meta": [dict(row) for row in db.execute("SELECT * FROM meta ORDER BY key")]}


OBSERVER = r'''
import {Plugin} from "@opencode/plugin/tui";
import {CostRpc} from "../candidate/dist/rpc.js";
import fs from "node:fs";
const root = __ROOT__;
const interval = __INTERVAL__;
export default Plugin.define({id:"cmon-first-use-observer",async setup(ctx){
 try {
  const location=await ctx.client.location.get();
  const plugins=await ctx.client.plugin.list();
  fs.writeFileSync(root+"/plugins.json",JSON.stringify(plugins));
  if(location.directory.replaceAll("\\","/").toLowerCase()!==(root+"/project").toLowerCase())
    throw Error("Private RPC default location mismatch");
  if(!plugins.data.some(p=>p.id==="cmon-isolated-candidate"&&p.state.status==="active") ||
     plugins.data.some(p=>p.id==="opencode-cmon"&&p.state.status==="active"))
    throw Error("Private plugin inventory mismatch");
  const session=await ctx.client.session.create({title:"Cost display verification",agent:"general",
    model:{providerID:"deepseek",id:"deepseek-flash"},location:{directory:root+"/project"},
    permissions:[{action:"*",resource:"*",effect:"deny"}]});
  if(session.agent!=="general"||session.model?.providerID!=="deepseek"||session.model?.id!=="deepseek-flash")
    throw Error("General/Flash selection mismatch");
  fs.writeFileSync(root+"/session.json",JSON.stringify(session));
  fs.writeFileSync(root+"/observer-ready.json",JSON.stringify({location,pid:process.pid,ppid:process.ppid,at:Date.now()}));
   ctx.ui.router.navigate({type:"session",sessionID:session.id});
    let alive=true, busy=false, submitted=false;
   let originalSidebar;
   const sidebar=()=>{
     const commands=ctx.keymap.commands().filter(c=>c.id==="session.sidebar.toggle");
     if(commands.length!==1 || !["Hide sidebar","Show sidebar"].includes(commands[0].title))
       throw Error("Unique public sidebar command/title required");
     return commands[0].title==="Hide sidebar";
   };
   const ensureSidebar=desired=>{
     const before=sidebar();
     if(originalSidebar===undefined)originalSidebar=before;
     if(before!==desired)ctx.keymap.dispatch("session.sidebar.toggle");
     fs.appendFileSync(root+"/sidebar-actions.jsonl",JSON.stringify({before,desired,
       dispatched:before!==desired,original:originalSidebar,at:Date.now()})+"\n");
   };
   for(const c of ctx.keymap.commands()){
     if([c.bind,...(c.id?ctx.keymap.shortcuts(c.id):[])].some(b=>typeof b==="string" && /\bf[89]\b/i.test(b)))
       throw Error("Owned sidebar test keys already bound");
   }
   ctx.keymap.layer(()=>({commands:[
      {id:"acceptance.home",bind:"f7",run:()=>ctx.ui.router.navigate({type:"home"})},
      {id:"acceptance.session",bind:"f6",run:()=>ctx.ui.router.navigate({type:"session",sessionID:session.id})},
      {id:"acceptance.sidebar.show",bind:"f8",run:()=>ensureSidebar(true)},
      {id:"acceptance.sidebar.restore",bind:"f9",run:()=>{
        if(originalSidebar===undefined)throw Error("No original sidebar state");
        ensureSidebar(originalSidebar);
      }}
   ]}));
    const sample=async()=>{if(busy)return;busy=true;try{
      if(!submitted && fs.existsSync(root+"/submit-once.json")){
        submitted=true;
        const request=JSON.parse(fs.readFileSync(root+"/submit-once.json","utf8"));
        if(request.sessionID!==session.id || !fs.existsSync(root+"/armed-session.json"))
          throw Error("Submission admission mismatch");
        const current=await ctx.client.session.get({sessionID:session.id});
        if(current.agent!=="general" || current.model?.providerID!=="deepseek" || current.model?.id!=="deepseek-flash")
          throw Error("Pre-submit General/Flash mismatch");
        fs.writeFileSync(root+"/submission-selection.json",JSON.stringify({agent:current.agent,model:current.model}));
        await ctx.client.session.prompt({sessionID:session.id,text:"Reply OK."});
        fs.writeFileSync(root+"/submitted.json",JSON.stringify({sessionID:session.id,at:Date.now()}));
      }
      if(submitted){
        const messages=await ctx.client.message.list({sessionID:session.id,type:"assistant",limit:10});
        const completed=messages.data.filter(m=>m.type==="assistant" && m.finish==="stop");
        if(completed.length)fs.writeFileSync(root+"/assistant-completed.json",JSON.stringify(completed));
      }
      const reply=await ctx.client.rpc(CostRpc).summary(interval);
     const route=ctx.ui.router.current();
     const sidebarVisible=route.type==="session"?sidebar():null;
     if(originalSidebar===undefined && sidebarVisible!==null)originalSidebar=sidebarVisible;
     if(alive)fs.writeFileSync(root+"/observer.json",JSON.stringify({reply,route,sidebarVisible,originalSidebar,at:Date.now()}));
  }catch(e){if(alive)fs.writeFileSync(root+"/observer-error.txt",String(e));}finally{busy=false;}};
  const timer=setInterval(sample,500);sample();
  return ()=>{alive=false;clearInterval(timer);};
 }catch(e){fs.writeFileSync(root+"/observer-error.txt",String(e?.stack??e));throw e;}
}});
'''


class Terminal:
    def __init__(self, run):
        import pyte
        from winpty import Backend, PtyProcess
        self.run = run
        self.screen = pyte.Screen(140, 45)
        self.stream = pyte.Stream(self.screen)
        self.chunks = queue.Queue(maxsize=512)
        self.raw = ""
        self.pending = ""
        env = os.environ.copy()
        config = load(run / "cli-inline.json")
        config["plugins"].append({"package": (run / "observer").as_uri() + "/"})
        config.update({"animations": False, "highlights": False})
        env["OPENCODE_CLI_CONFIG_CONTENT"] = json.dumps(config)
        self.process = PtyProcess.spawn(
            [sys.executable, "-s", str(ROOT / "docs/operations/windows-pty-gate.py"),
             "--parent-pid", str(os.getpid()), "--", "opencode", "--standalone"],
            cwd=str(run / "project"), env=env, dimensions=(45, 140), backend=Backend.ConPTY)
        write(run / "terminal.json", {"pid": self.process.pid, "backend": "ConPTY"})
        def read():
            try:
                while self.process.isalive():
                    self.chunks.put(self.process.read(65536), timeout=2)
            except Exception as error:
                self.chunks.put_nowait(error)
        threading.Thread(target=read, daemon=True).start()

    def send(self, text):
        self.process.write(text)

    def pump(self, seconds=0.2):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            try:
                chunk = self.chunks.get(timeout=min(0.05, max(.001, deadline-time.monotonic())))
            except queue.Empty:
                continue
            if isinstance(chunk, Exception):
                raise AssertionError("ConPTY reader stopped") from chunk
            self.raw = (self.raw + chunk)[-1048576:]
            data = self.pending + chunk
            # Same terminal-query contract as host-terminal.py, with ConPTY I/O.
            for match in re.finditer(r'\x1b\[(?:\?|>)?[0-9;?]*[cnptuy]|\x1b\](?:10|11);\?\x1b\\', data):
                query = match.group()
                reply = {"\x1b[c":"\x1b[?1;2c", "\x1b[0c":"\x1b[?1;2c",
                         "\x1b[>c":"\x1b[>0;1;0c", "\x1b[>0c":"\x1b[>0;1;0c",
                         "\x1b[6n":"\x1b[1;1R", "\x1b[5n":"\x1b[0n", "\x1b[?u":"\x1b[?0u",
                         "\x1b[18t":"\x1b[8;45;140t", "\x1b[14t":"\x1b[4;720;1120t",
                         "\x1b]10;?\x1b\\":"\x1b]10;rgb:dddd/dddd/dddd\x1b\\",
                         "\x1b]11;?\x1b\\":"\x1b]11;rgb:1111/1111/1111\x1b\\"}.get(query)
                if reply:
                    self.send(reply)
            tail = data[data.rfind("\x1b"):] if "\x1b" in data else ""
            self.pending = tail if tail and not re.search(r'[A-Za-z~\\]$', tail) and len(tail)<128 else ""
            self.stream.feed(chunk)

    def text(self):
        return "\n".join(self.screen.display)

    def wait(self, text, timeout=30):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.pump()
            if (self.run / "observer-error.txt").exists():
                raise AssertionError("Observer activation/RPC error; see observer-error.txt")
            if text in self.text():
                return
            if not self.process.isalive():
                raise AssertionError("TUI exited before rendered assertion")
        raise AssertionError(f"Rendered text deadline: {text!r}")

    def wait_file(self, name, timeout=60):
        deadline = time.monotonic()+timeout
        while time.monotonic()<deadline:
            self.pump()
            if (self.run / "observer-error.txt").exists():
                raise AssertionError("Observer activation/RPC error; see observer-error.txt")
            if (self.run / name).exists():
                return load(self.run / name)
            if not self.process.isalive():
                raise AssertionError("Private terminal exited before observer readiness")
        raise AssertionError(f"Observer deadline: {name}")

    def wait_assistant(self, timeout=60):
        deadline=time.monotonic()+timeout
        while time.monotonic()<deadline:
            self.pump()
            if (self.run / "observer-error.txt").exists():
                raise AssertionError("Observer submission/RPC error")
            if (self.run / "assistant-completed.json").exists():
                return
            assert self.process.isalive(), "TUI exited before assistant confirmation"
        raise AssertionError("Rendered assistant confirmation deadline; no retry")

    def click(self, text):
        self.wait(text)
        cells = [(row.index(text), y) for y,row in enumerate(self.screen.display)
                 if text in row and (text != "$" or "Unit" in row)]
        assert len(cells) == 1, f"Unique rendered click target: {text}"
        x,y = cells[0]
        self.send(f"\x1b[<0;{x+1};{y+1}M\x1b[<0;{x+1};{y+1}m")
        self.pump(.6)

    def frame(self, name):
        (self.run / (name + ".txt")).write_text(self.text(), encoding="utf-8")
        (self.run / (name + ".raw")).write_text(self.raw, encoding="utf-8")

    def ensure_sidebar(self, desired, restore=False, timeout=15):
        """Use the public command title, never an occluded header, as state."""
        before = self.wait_sidebar(timeout=timeout)
        self.frame("sidebar-restore-before" if restore else "sidebar-initial")
        actions = self.run / "sidebar-actions.jsonl"
        count = len(actions.read_text(encoding="utf-8").splitlines()) if actions.exists() else 0
        self.send("\x1b[20~" if restore else "\x1b[19~")
        deadline = time.monotonic()+timeout
        while not actions.exists() or len(actions.read_text(encoding="utf-8").splitlines()) <= count:
            assert time.monotonic()<deadline, "Owned sidebar key acknowledgement deadline"
            self.pump()
        self.wait_sidebar(desired, timeout)
        return before

    def wait_sidebar(self, desired=None, timeout=15):
        deadline = time.monotonic()+timeout
        while time.monotonic()<deadline:
            self.pump()
            if (self.run / "observer-error.txt").exists():
                raise AssertionError("Observer sidebar error")
            path = self.run / "observer.json"
            if path.exists():
                value = load(path)
                state = value.get("sidebarVisible")
                if (time.time()*1000-value["at"]<1500 and isinstance(state,bool)
                        and (desired is None or state == desired)):
                    return state
        raise AssertionError("Public sidebar command state deadline")

    def open_state(self, timeout=15):
        """Observe a unique, quiescent public header; never assume durable state."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.wait("This month", timeout=max(.1, deadline-time.monotonic()))
            before = self.text()
            self.pump(.6)
            if self.text() != before:
                continue
            rows = [row for row in self.screen.display if "This month" in row]
            if len(rows) == 1:
                match = re.search(r"([▼▶])\s+This month", rows[0])
                if match and not any(label in before for label in ("Select model", "Command palette", "Permission required")):
                    return match[1] == "▼"
        raise AssertionError("Unique quiescent candidate header/glyph deadline")

    def set_open(self, desired, name):
        actual = self.open_state()
        self.frame(name + "-preaction")
        write(self.run / (name + "-action.json"), {"glyph":"▼" if actual else "▶",
              "desiredOpen":desired,"expectedToggle":actual != desired})
        if actual != desired:
            self.click("This month")
        assert self.open_state() == desired, "Desired header state after at most one click"
        if desired:
            self.wait("Unit")
        else:
            assert "Unit" not in self.text(), "Closed header hides unit controls"
        return actual


def contained(pids):
    """Check the live owned job, including the actual observer host, before admission."""
    import ctypes as c
    from ctypes import wintypes as w
    k = c.WinDLL("kernel32", use_last_error=True)
    k.OpenJobObjectW.argtypes, k.OpenJobObjectW.restype = [w.DWORD,w.BOOL,w.LPCWSTR], w.HANDLE
    k.OpenProcess.argtypes, k.OpenProcess.restype = [w.DWORD,w.BOOL,w.DWORD], w.HANDLE
    k.IsProcessInJob.argtypes, k.IsProcessInJob.restype = [w.HANDLE,w.HANDLE,c.POINTER(w.BOOL)], w.BOOL
    k.CloseHandle.argtypes = [w.HANDLE]
    job = k.OpenJobObjectW(0x0004,False,os.environ["CMON_JOB_NAME"])
    assert job, "Owned job required"
    try:
        for pid in pids:
            handle = k.OpenProcess(0x1000,False,pid)
            assert handle, "Live contained process required"
            try:
                inside=w.BOOL()
                assert k.IsProcessInJob(handle,job,c.byref(inside)) and inside.value, "Process outside owned job"
            finally:
                k.CloseHandle(handle)
    finally:
        k.CloseHandle(job)


def compact_tokens(total, complete):
    # Independent integer/half-up oracle for the public compact display contract.
    unit=0
    while unit<3 and total>=1000**(unit+1):
        unit+=1
    rounded=(total*100+1000**unit//2)//1000**unit
    if rounded>=100000 and unit<3:
        unit+=1
        rounded=(total*100+1000**unit//2)//1000**unit
    number=str(total) if unit==0 else f"{rounded//100}.{rounded%100:02d}".rstrip("0").rstrip(".") + "kMB"[unit-1]
    return ("" if complete else "~")+number+(" token" if total==1 else " tokens")


def first_use(run, terminal, session, observer, check):
    proof=load(Path(os.environ["CMON_JOB_PROOF"]))
    ready=load(run / "observer-ready.json")
    check("pre-arm terminal containment proof", proof["verified_before_resume"] and
          proof["conpty_in_job"] and proof["application_in_job"])
    contained([os.getpid(),proof["conpty_pid"],proof["application_pid"],ready["pid"]])
    check("live observer and terminal in owned job", True)
    price=load(run / "price-verified.json")
    check("confirmed peak price and conservative reservation below authorization", price["inputPerMillion"]==0.3
          and price["outputPerMillion"]==1.2 and price["maxOutput"]==256 and 3*0.01<0.05)
    terminal.send("\x1b[17~")
    terminal.wait("[$]")
    terminal.click("Tokens")
    terminal.wait("[Tokens]")
    terminal.wait("This month: 0 tokens")
    terminal.frame("immediately-before-prompt-tokens")
    check("single physical dispatch limit persisted before admission", request_state(run, 0))
    # Admission only after all empty-state/readiness checks in this SAME process.
    write(run / "armed-session.json", {"sessionID":session,"expires":int(time.time()*1000)+120000})
    write(run / "submit-once.json", {"sessionID":session})
    terminal.wait_file("submitted.json", timeout=20)
    terminal.wait_assistant(timeout=60)
    deadline=time.monotonic()+25
    previous=None
    stable=0
    while time.monotonic()<deadline:
        terminal.pump(.6)
        snapshot=ledger(run)
        reply=observer()["reply"]
        if snapshot["rows"] and reply["revision"]>0 and snapshot==previous:
            stable+=1
            if stable>=5:
                break
        else:
            stable=0
        previous=snapshot
    else:
        raise AssertionError("Normal recording/settled RPC deadline")
    rows=snapshot["rows"]
    completed=load(run / "assistant-completed.json")
    check("public message list confirms completed assistant turn", bool(completed) and all(
          m["type"]=="assistant" and m["finish"]=="stop" for m in completed))
    check("normal live recording only admitted successful General Flash rows", all(
        row["source"]=="live" and row["session_id"]==session and row["agent"]=="general" and
        row["provider_id"]=="deepseek" and row["model_id"]=="deepseek-flash" and row["failed"]==0 for row in rows))
    columns=("tokens_input","tokens_cache_read","tokens_cache_write","tokens_output","tokens_reasoning")
    total=sum(row[col] for row in rows for col in columns if row[col] is not None)
    complete=all(row[col] is not None for row in rows for col in columns)
    check("real RPC token sum and coverage equal retained five disjoint columns", total>0 and
          reply["tokens"]["totalTokens"]==total and reply["tokens"]["complete"]==complete)
    requests=load(run / "requests.json")
    events=[json.loads(line) for line in (run / "lifecycle.jsonl").read_text(encoding="utf-8").splitlines()]
    attempts=[event for event in events if event["event"]=="http-attempt"]
    check("transport request ceiling includes all admitted physical sends", requests["attempts"]==1 and requests["maxRequests"]==1 and
          len(attempts)==requests["attempts"] and requests["reservedUSD"]==requests["attempts"]*0.01 and
          all(e["providerID"]=="deepseek" and e["modelID"]=="deepseek-flash" and e["kind"]=="primary" for e in attempts))
    cost=sum(row["cost_micros"] for row in rows)/1000000
    check("real RPC dollars equal stored monetary total", reply["totalMicros"]==sum(row["cost_micros"] for row in rows))
    check("recorded cost within reservations and approved budget", 0<=cost<=requests["reservedUSD"]<0.05)
    dollar_before={key:reply[key] for key in ("revision","totalMicros","complete","agents","models","providers")}
    expected=compact_tokens(total,complete)
    terminal.wait("This month: "+expected)
    check("sidebar exact compact total and honest coverage", ("Partial:" in terminal.text())== (not complete))
    terminal.frame("activity-sidebar-tokens")
    terminal.send("\x1b[18~")
    terminal.wait("▼ "+expected)
    terminal.frame("activity-footer-tokens")
    terminal.send("\x1b[17~")
    terminal.wait("[Tokens]")
    terminal.click("$")
    terminal.wait("[$]")
    dollars=f"${(reply['totalMicros']+5000)//10000/100:.2f}"
    terminal.wait("This month: "+dollars)
    terminal.frame("restored-sidebar-dollars")
    terminal.send("\x1b[18~")
    terminal.wait("▼ "+dollars)
    terminal.frame("restored-footer-dollars")
    terminal.pump(3)
    after=observer()["reply"]
    check("unit clicks preserve exact ledger rows metadata revision and dollar summary", ledger(run)==snapshot and
          {key:after[key] for key in dollar_before}==dollar_before and load(run / "requests.json")==requests)
    write(run / "first-use.json", {"status":"PASS","candidate":REVISION,"rowCount":len(rows),
          "tokens":total,"complete":complete,"compact":expected,"revision":reply["revision"],
          "recordedUSD":cost,"requests":requests,"attempts":attempts,"dollarSummary":dollar_before,
          "installation":"empty isolated ledger/import with opaque existing authentication; not new authentication"})


def worker(run, allow_first_use=False):
    checks = []
    terminal = None
    original_open = None
    original_sidebar = None
    original_view = None
    def check(name, condition):
        checks.append({"assertion":name,"status":"PASS" if condition else "FAIL"})
        assert condition, name
    def observer():
        value = load(run / "observer.json")
        assert time.time()*1000 - value["at"] < 3000, "Fresh TUI observer required"
        return value
    try:
        check("immutable candidate manifest", load(run / "environment.json")["revision"] == REVISION)
        check("candidate build and dependency provenance", all(digest(run / "candidate" / p)==h for p,h in HASHES.items()))
        check("fresh run unarmed with no import source", not (run / "armed-session.json").exists()
              and not (run / "absent-source.sqlite").exists())
        check("zero request reservations and persisted single dispatch limit", request_state(run, 0))
        config = load(run / "project/opencode.json")
        check("supplied General route selects DeepSeek Flash", config["default_agent"]=="general"
              and config["model"]=="deepseek/deepseek-flash" and config["warming"] is False)
        check("fresh ledger absent before private launch", not (run / "ledger.sqlite").exists())
        now = dt.datetime.now(dt.timezone.utc)
        start = now.replace(day=1,hour=0,minute=0,second=0,microsecond=0)
        end = start.replace(year=start.year+1,month=1) if start.month==12 else start.replace(month=start.month+1)
        interval = {"from":int(start.timestamp()*1000),"to":int(end.timestamp()*1000)}
        write(run / "interval.json",interval)
        directory = run / "observer"
        directory.mkdir()
        write(directory / "package.json",{"name":"cmon-first-use-observer","type":"module","exports":{"./tui":"./tui.js"}})
        source = OBSERVER.replace("__ROOT__",json.dumps(str(run).replace("\\","/"))).replace("__INTERVAL__",json.dumps(interval))
        (directory / "tui.js").write_text(source,encoding="utf-8")
        terminal = Terminal(run)
        ready = terminal.wait_file("observer-ready.json")
        check("observer activated on private project default RPC", Path(ready["location"]["directory"]).resolve()==run / "project")
        session = load(run / "session.json")["id"]
        original_sidebar = terminal.wait_sidebar()
        terminal.ensure_sidebar(True)
        # Startup MCP toast lasts five seconds and handles mouse-up. Never click through it.
        terminal.pump(5.5)
        terminal.wait("This month", timeout=15)
        check("unique candidate month block", terminal.text().count("This month")==1)
        original_open = terminal.open_state()
        terminal.set_open(True, "initial-open")
        views=re.findall(r"\[(Agents|Models|Providers)\]",terminal.text())
        check("unique original breakdown preference", len(views)==1)
        original_view=views[0]
        terminal.click("Tokens")
        terminal.wait("[Tokens]")
        terminal.wait("0 tokens")
        snapshot = observer()
        write(run / "empty-rpc.json", snapshot)
        reply = snapshot["reply"]
        check("TUI observes exact owned session", snapshot["route"].get("sessionID")==session)
        check("real RPC complete zero and empty groups",reply["revision"]==0 and reply["totalMicros"]==0 and
              reply["complete"] is True and reply["tokens"]["totalTokens"]==0 and reply["tokens"]["complete"] is True and
              all(reply[group]==[] and reply["tokens"][group]==[] for group in ("agents","models","providers")))
        check("actual exact zero tokens without dollar rows or partial warning", exact_zero_tokens(terminal.text()))
        for choice in ("Agents", "Models", "Providers"):
            terminal.click(choice)
            terminal.wait(f"[{choice}]")
            check(f"empty {choice} breakdown has no rows or warning", exact_zero_tokens(terminal.text()) and
                  all(reply[group]==[] and reply["tokens"][group]==[] for group in ("agents","models","providers")))
        terminal.frame("empty-sidebar-tokens")
        terminal.send("\x1b[18~")
        terminal.wait("0 tokens")
        check("home footer renders exact zero tokens without partial", exact_zero_tokens(terminal.text()))
        terminal.frame("empty-footer-tokens")
        terminal.send("\x1b[17~")
        terminal.wait("[Tokens]")
        terminal.click("$")
        terminal.wait("[$]")
        terminal.wait("$0.00")
        terminal.frame("empty-sidebar-dollars")
        terminal.send("\x1b[18~")
        terminal.wait("▼ $0.00")
        check("unique opened empty dollar footer", opened_zero_dollars(terminal.text()))
        terminal.frame("empty-footer-dollars")
        check("empty ledger and import metadata and counters preserved by UI",ledger(run)=={"rows":[],"meta":[]} and
              not (run / "absent-source.sqlite").exists() and
               request_state(run, 0) and not (run / "armed-session.json").exists())
        write(run / "empty-render-verified.json",{"candidate":REVISION,"sessionID":session,"checks":checks})
        if allow_first_use:
            first_use(run,terminal,session,observer,check)
    except Exception as error:
        if terminal:
            terminal.frame("failure-before-restoration")
        checks.append({"assertion":"driver completion","status":"FAIL","detail":str(error)})
        write(run / "failure.json", {"error":str(error),
              "observerError":(run / "observer-error.txt").read_text(encoding="utf-8")
              if (run / "observer-error.txt").exists() else None,
              "renderedFrame":"final.txt", "terminalOutput":"final.raw", "traceback":"worker.log"})
        raise
    finally:
        (run / "armed-session.json").unlink(missing_ok=True)
        if terminal:
            if original_view is not None:
                try:
                    terminal.send("\x1b[17~")
                    terminal.set_open(True,"restore-controls")
                    terminal.click("$")
                    terminal.wait("[$]")
                    terminal.click(original_view)
                    terminal.wait(f"[{original_view}]")
                    write(run / "view-restoration.json",{"status":"PASS","originalView":original_view,"unit":"dollars"})
                except Exception as error:
                    write(run / "view-restoration.json",{"status":"FAIL","error":str(error)})
                    checks.append({"assertion":"restore breakdown and dollar controls","status":"FAIL"})
            if original_open is not None:
                try:
                    terminal.send("\x1b[17~")
                    terminal.set_open(original_open, "restore-open")
                    write(run / "ui-restoration.json", {"status":"PASS","originalOpen":original_open})
                except Exception as error:
                    write(run / "ui-restoration.json", {"status":"FAIL","error":str(error)})
                    checks.append({"assertion":"restore original durable open preference through UI","status":"FAIL"})
            if original_sidebar is not None:
                try:
                    terminal.send("\x1b[17~")
                    terminal.wait_sidebar()
                    terminal.ensure_sidebar(original_sidebar, restore=True)
                    write(run / "sidebar-restoration.json", {"status":"PASS","originalVisible":original_sidebar,
                          "restoredVisible":terminal.wait_sidebar(original_sidebar)})
                except Exception as error:
                    write(run / "sidebar-restoration.json", {"status":"FAIL","error":str(error)})
                    checks.append({"assertion":"restore original sidebar visibility through UI command","status":"FAIL"})
            terminal.frame("final")
        write(run / "assertions.json",checks)
        if any(item["status"]=="FAIL" for item in checks):
            raise AssertionError("Driver assertions/restoration failed; see assertions.json")
        # Outer job teardown owns all private processes; never call shared API.


def request_state(run, attempts):
    state=load(run / "requests.json")
    manifest=load(run / "environment.json")
    return (type(state.get("maxRequests")) is int and state["maxRequests"]==1 and
            type(manifest.get("maxRequests")) is int and manifest["maxRequests"]==1 and
            state=={"attempts":attempts,"reservedUSD":attempts*0.01,"maxRequests":1})


def exact_zero_tokens(text):
    return (bool(re.search(r"(?<![\d,.])0 tokens\b", text)) and
             not re.search(r"\$\s*\d", text) and "Partial:" not in text)


def opened_zero_dollars(text):
    return len(re.findall(r"▼ \$0\.00(?=\s|$)",text))==1 and "this month" not in text and "Partial:" not in text


def assistant_confirmed(text):
    # The submitted user text "Reply OK." is not an assistant result.
    # The independent sidebar can occupy the right-hand cells of the same row.
    return any(re.fullmatch(r"[ \t]*OK[.!]?(?:[ \t]{2,}[^\r\n]*)?[ \t]*", row)
               for row in text.splitlines())


def cleanup(run):
    result={"status":"FAIL"}
    try:
        job=load(run / "job.json")
        assert job["cleanup_ok"] and job["remaining_pids"]==[], "Owned job cleanup required"
        assert not (run / "armed-session.json").exists(), "Admission must remain absent"
        def outside():
            # Only emit PIDs matching this fresh run; never publish other command lines.
            script="$p=Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*"+run.name+"*' }; @($p | ForEach-Object { $_.ProcessId }) | ConvertTo-Json -Compress"
            return json.loads(execute(["pwsh","-NoProfile","-NonInteractive","-Command",script]) or "[]")
        assert outside()==[], "Run-scoped process outside cleaned job"
        paths=[run / p for p in ("ledger.sqlite","ledger.sqlite-wal","ledger.sqlite-shm","requests.json","lifecycle.jsonl")]
        def stamp():
            return {p.name: [p.stat().st_size,p.stat().st_mtime_ns,digest(p)] if p.exists() else None for p in paths}
        before=stamp()
        time.sleep(30)
        assert outside()==[] and stamp()==before, "late run process/write"
        requests=load(run / "requests.json")
        assert requests["attempts"] in (0,1) and request_state(run,requests["attempts"]), "Single dispatch reservations"
        result={"status":"PASS","sustainedSeconds":30,"scratchFiles":before,
                 "normalData":"no direct edits/deletions by harness; ordinary host appends preserved, not rolled back"}
    finally:
        write(run / "cleanup.json",result)
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run",type=Path)
    parser.add_argument("--worker",action="store_true",help=argparse.SUPPRESS)
    parser.add_argument("--first-use",action="store_true",help="Explicitly authorize the single bounded General/Flash workflow")
    args=parser.parse_args()
    if args.worker:
        run=args.run.resolve()
        assert run.is_relative_to(ROOT / "node_modules/.cache/cmon-auth")
        worker(run,args.first_use)
        return
    assert not args.run, "Fresh preparation is mandatory"
    run=Path(execute(["pwsh","-NoProfile","-NonInteractive","-File","docs/operations/prepare-authenticated.ps1","-MaxRequests","1"],timeout=30).strip()).resolve()
    assert run.is_relative_to(ROOT / "node_modules/.cache/cmon-auth")
    print("Evidence:",run,flush=True)
    if args.first_use:
        # Confirmed official peak pricing before arming; refuse changed upstream rates.
        import urllib.request
        with urllib.request.urlopen("https://api-docs.deepseek.com/quick_start/pricing",timeout=20) as response:
            pricing=response.read(2000000).decode("utf-8")
        assert all(value in pricing for value in ("deepseek-flash","$0.3","$1.2")), "Pricing changed; do not arm"
        write(run / "price-verified.json", {"source":"https://api-docs.deepseek.com/quick_start/pricing",
              "inputPerMillion":0.3,"outputPerMillion":1.2,"maxOutput":256,"reservedPerAttempt":0.01})
        adapter=run / "index.js"
        source=adapter.read_text(encoding="utf-8")
        assert source.count("state.attempts * 0.01")==2, "Adapter reservation semantics changed"
    success=False
    try:
        execute(["bun","run","build"],cwd=run / "candidate",timeout=120)
        env=os.environ.copy()
        env["PYTHONPATH"]=str(ROOT / "node_modules/.cache/cmon-native-tools/site")
        env["PYTHONDONTWRITEBYTECODE"]="1"
        command=[sys.executable,"-s",str(ROOT / "docs/operations/windows-job.py"),"--cwd",str(run / "project"),
                  "--evidence",str(run / "job.json"),"--timeout","300","--",sys.executable,"-s",str(Path(__file__).resolve()),"--worker","--run",str(run)]
        if args.first_use:
            command.append("--first-use")
        with (run / "worker.log").open("w",encoding="utf-8") as output:
            result=subprocess.run(command,cwd=ROOT,timeout=335,env=env,stdout=output,stderr=subprocess.STDOUT)
        assert result.returncode==0, f"Private worker exited {result.returncode}; see worker.log"
        job=load(run / "job.json")
        terminal=load(run / "terminal.json")
        proof=job["pty_proof"]
        assert job["cleanup_ok"] and job["containment_proven"] and terminal["pid"]==proof["conpty_pid"], "Actual TUI Job Object containment required"
        ready=load(run / "observer-ready.json")
        assert ready["pid"] in job["observed_pids"], "Actual terminal plugin host containment required"
        success=True
    finally:
        cleanup(run)
    if success:
        write(run / "ready.json",{"noCall":not args.first_use,"candidate":REVISION,"driverSHA256":digest(Path(__file__)),
              "adapterSHA256":digest(run / "index.js")})
    print("Assertions PASS; owned-process and sustained candidate cleanup PASS",flush=True)


if __name__=="__main__":
    main()
