"""Pure no-service checks for the Windows no-call driver."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("driver", Path(__file__).with_name("authenticated-terminal.py"))
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)


class Safety(unittest.TestCase):
    def test_actual_http_guard_endpoint_reservations_and_redacted_rejections(self):
        source = (driver.ROOT / "docs/operations/authenticated-candidate.mjs").read_text(encoding="utf-8")
        hook = source.split('await hook("http.request", event => {', 1)[1].split('\n    });', 1)[0]
        script = r'''
let state={attempts:0,reservedUSD:0,maxRequests:LIMIT}, receipts=[];
const maxRequests=LIMIT;
const statePath="unused", model=e=>{if(e.sessionID!=="ses_test" || e.model.providerID!=="deepseek" || e.model.id!=="deepseek-flash")throw Error("selection");};
const record=(event,extra)=>receipts.push({event,...extra});
const fs={readFileSync:()=>JSON.stringify(state),writeFileSync:(_,s)=>{state=JSON.parse(s)}};
const guard=event=>{HOOK};
const event=(url="https://api.deepseek.com/chat/completions",method="POST")=>({sessionID:"ses_test",model:{providerID:"deepseek",id:"deepseek-flash"},kind:"primary",request:new Request(url,{method})});
const rejected=e=>{const before=JSON.stringify(state);let threw=false;try{guard(e)}catch{threw=true}if(!threw||JSON.stringify(state)!==before)throw Error("rejection/counter");};
for(const [url,method] of [
 ["https://api.deepseek.com/v1/chat/completions","POST"],
 ["https://elsewhere.invalid/chat/completions","POST"],
 ["http://api.deepseek.com/chat/completions","POST"],
 ["https://api.deepseek.com:444/chat/completions","POST"],
 ["https://api.deepseek.com/chat/completions?secret=never-log","POST"],
 ["https://api.deepseek.com/chat/completions?","POST"],
 ["https://api.deepseek.com/chat/completions#secret","POST"],
 ["https://api.deepseek.com/chat/completions/","POST"],
 ["https://api.deepseek.com/chat/completions","GET"]])rejected(event(url,method));
if(receipts.length!==9 || receipts.some(r=>r.event!=="http-rejected" || Object.keys(r).sort().join()!=="event,method,origin,path,queryPresent") || JSON.stringify(receipts).includes("never-log"))throw Error("sanitized receipts");
for(const patch of [{sessionID:"ses_other"},{kind:"auxiliary"},{model:{providerID:"other",id:"deepseek-flash"}}])rejected({...event(),...patch});
for(let i=1;i<=maxRequests;i++){
 const e=event();guard(e);
 if(state.attempts!==i||state.reservedUSD!==i*.01||e.request.redirect!=="error")throw Error("reservation");
 const body=await e.request.json();
 if(body.model!=="deepseek-flash"||body.max_tokens!==256||body.thinking.type!=="disabled"||body.messages.length!==1||body.messages[0].content!=="Reply OK."||body.tools)throw Error("body");
}
rejected(event());
for(const invalid of [{attempts:-1,reservedUSD:0},{attempts:1.5,reservedUSD:.015},{attempts:1,reservedUSD:.0006072},{attempts:0,reservedUSD:0,maxRequests:"1"},{attempts:0,reservedUSD:0,maxRequests:0}]){state=invalid;rejected(event());}
console.log("PASS: exact endpoint; 9 sanitized rejections; 3 reservations; fourth blocked; zero dispatch");
'''.replace("HOOK", hook)
        for limit in (1,3):
            result = driver.subprocess.run(["bun", "-e", script.replace("LIMIT",str(limit))], cwd=driver.ROOT,
                                           capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_malformed_configured_guard_limit_fails_closed(self):
        source=(driver.ROOT / "docs/operations/authenticated-candidate.mjs").read_text(encoding="utf-8")
        block=source.split('    const configuredLimit =',1)[1].split('    if (path.resolve',1)[0]
        script='''const validate=(value,manifestValue)=>{const ctx={options:{maxRequests:value}},manifest={maxRequests:manifestValue}; const configuredLimit =BLOCK;return maxRequests;};
for(const value of [0,4,-1,1.5,"1",null,true,NaN,Infinity]){let threw=false;try{validate(value,value)}catch{threw=true}if(!threw)throw Error("malformed accepted");}
if(validate(1,1)!==1)throw Error("one rejected");
let threw=false;try{validate(1,3)}catch{threw=true}if(!threw)throw Error("mismatch accepted");
'''.replace("BLOCK",block)
        result=driver.subprocess.run(["bun","-e",script],cwd=driver.ROOT,capture_output=True,text=True,timeout=15)
        self.assertEqual(result.returncode,0,result.stderr)

    def test_single_dispatch_preparation_and_refresh_view(self):
        import inspect
        source=Path(driver.__file__).read_text(encoding="utf-8")
        self.assertIn('"-MaxRequests","1"',source)
        first=inspect.getsource(driver.first_use)
        self.assertLess(first.index('terminal.click("Tokens")'),first.index('write(run / "armed-session.json"'))
        self.assertNotIn('terminal.click("Tokens")',first.split('write(run / "armed-session.json"',1)[1])
        self.assertIn('ctx.client.message.list({sessionID:session.id,type:"assistant",limit:10})',driver.OBSERVER)

    def test_no_shared_service_api_path(self):
        source = Path(driver.__file__).read_text(encoding="utf-8")
        self.assertNotIn('["opencode", "api"', source)
        self.assertIn('ctx.client.plugin.list()', driver.OBSERVER)
        self.assertIn('ctx.client.location.get()', driver.OBSERVER)

    def test_explicit_session_agent_model_and_deny_all(self):
        source = Path(driver.__file__).read_text(encoding="utf-8")
        self.assertIn('agent:"general"', source)
        self.assertIn('providerID:"deepseek",id:"deepseek-flash"', source)
        self.assertIn('action:"*",resource:"*",effect:"deny"', source)

    def test_first_use_is_explicit_and_follows_empty_readiness(self):
        source = Path(driver.__file__).read_text(encoding="utf-8")
        self.assertIn('"--first-use",action="store_true"', source)
        self.assertIn('def worker(run, allow_first_use=False)', source)
        self.assertLess(source.index('write(run / "empty-render-verified.json"'), source.index('first_use(run,terminal'))
        self.assertIn('if allow_first_use:', source)
        self.assertIn('submitted=true;', driver.OBSERVER)
        self.assertEqual(driver.OBSERVER.count('ctx.client.session.prompt('), 1)
        self.assertIn('ctx.client.session.get({sessionID:session.id})', driver.OBSERVER)
        self.assertIn('current.agent!=="general"', driver.OBSERVER)
        self.assertIn('(run / "armed-session.json").unlink(missing_ok=True)', source)

    def test_opened_zero_footer_requires_unique_glyph_not_closed_caption(self):
        self.assertTrue(driver.opened_zero_dollars('  ▼ $0.00                              '))
        for text in ('▶ $0.00 this month', '▼ $0.00 this month', '▼ $0.00\n▼ $0.00',
                     '▼ $0.001', '▼ $0.00 Partial: unknown'):
            self.assertFalse(driver.opened_zero_dollars(text))

    def test_independent_compact_oracle(self):
        for total,expected in ((0,'0 tokens'),(1,'1 token'),(999,'999 tokens'),(1000,'1k tokens'),
                               (1234,'1.23k tokens'),(1235,'1.24k tokens'),(999995,'1M tokens'),
                               (1580000000,'1.58B tokens'),(1000000000000,'1000B tokens')):
            self.assertEqual(driver.compact_tokens(total,True),expected)
            self.assertEqual(driver.compact_tokens(total,False),'~'+expected)

    def test_containment_and_price_precede_admission(self):
        import inspect
        source=inspect.getsource(driver.first_use)
        self.assertLess(source.index('contained(['),source.index('write(run / "armed-session.json"'))
        self.assertLess(source.index('price=load('),source.index('write(run / "armed-session.json"'))
        self.assertIn('ledger(run)==snapshot',source)
        self.assertIn('requests["attempts"]*0.01',source)

    def test_user_prompt_is_not_assistant_confirmation(self):
        for text in ('Reply OK.', '┃ Reply OK.', 'Submitted Reply OK. successfully', 'OK request sent'):
            self.assertFalse(driver.assistant_confirmed(text))
        self.assertTrue(driver.assistant_confirmed('  OK  \n'))
        self.assertTrue(driver.assistant_confirmed('Reply OK.\n\n  OK.  \n'))
        self.assertTrue(driver.assistant_confirmed('      OK.                              Providers'))
        self.assertFalse(driver.assistant_confirmed('      OK request sent                   Providers'))

    def test_execution_is_bounded(self):
        with patch.object(driver.subprocess, "run") as run:
            run.return_value.returncode = 0
            run.return_value.stdout = "{}"
            driver.execute(["opencode", "api", "plugin.list"])
            self.assertEqual(run.call_args.kwargs["timeout"], 15)
            self.assertTrue(run.call_args.kwargs["capture_output"])

    def test_gate_private_launch_and_stable_observer_import(self):
        source = Path(driver.__file__).read_text(encoding="utf-8")
        self.assertIn('"docs/operations/windows-pty-gate.py"', source)
        self.assertIn('"--parent-pid", str(os.getpid()), "--", "opencode", "--standalone"', source)
        self.assertNotIn('%40', driver.OBSERVER)
        self.assertIn('observer-ready.json', driver.OBSERVER)
        self.assertIn('e?.stack', driver.OBSERVER)

    def test_observer_uses_host_public_sdk(self):
        self.assertIn('from "@opencode/plugin/tui"', driver.OBSERVER)
        self.assertNotIn('node_modules/', driver.OBSERVER)
        self.assertNotIn('from "effect/', driver.OBSERVER)
        source = Path(driver.__file__).with_name("host-terminal.py").read_text(encoding="utf-8")
        observer = source.split("OBSERVER = r'''", 1)[1].split("'''", 1)[0]
        self.assertIn('from "@opencode/plugin/tui"', observer)
        self.assertNotIn('node_modules/', observer)

    def test_zero_cannot_match_nonzero_or_dollar_rows(self):
        self.assertTrue(driver.exact_zero_tokens('This month\n 0 tokens'))
        for text in ('10 tokens', '1,000 tokens', '0 tokens\ngeneral $0.01',
                     '0 tokens\n$0', '0 tokens\nPartial: unknown'):
            with self.subTest(text=text):
                self.assertFalse(driver.exact_zero_tokens(text))

    def test_desired_open_state_clicks_only_when_needed(self):
        for initial in (True, False):
            for desired in (True, False):
                with self.subTest(initial=initial, desired=desired):
                    terminal = object.__new__(driver.Terminal)
                    terminal.run = Path("unused")
                    with patch.object(terminal, "open_state", side_effect=[initial, desired]), \
                         patch.object(terminal, "frame") as frame, \
                         patch.object(terminal, "click") as click, \
                         patch.object(terminal, "wait"), \
                         patch.object(terminal, "text", return_value="Unit" if desired else ""), \
                         patch.object(driver, "write") as write:
                        self.assertEqual(terminal.set_open(desired, "state"), initial)
                        self.assertEqual(click.call_count, int(initial != desired))
                        frame.assert_called_once_with("state-preaction")
                        self.assertEqual(write.call_args.args[1]["expectedToggle"], initial != desired)

    def test_wrong_state_after_single_click_fails_without_retry(self):
        terminal = object.__new__(driver.Terminal)
        terminal.run = Path("unused")
        with patch.object(terminal, "open_state", return_value=False), \
             patch.object(terminal, "frame"), patch.object(driver, "write"), \
             patch.object(terminal, "click") as click:
            with self.assertRaises(AssertionError):
                terminal.set_open(True, "state")
            click.assert_called_once_with("This month")

    def test_sidebar_uses_command_state_not_occluded_text(self):
        source = Path(driver.__file__).read_text(encoding="utf-8")
        self.assertNotIn('terminal.send("\\x18b")', source)
        self.assertIn('ctx.keymap.commands()', driver.OBSERVER)
        self.assertIn('c.id==="session.sidebar.toggle"', driver.OBSERVER)
        self.assertIn('["Hide sidebar","Show sidebar"]', driver.OBSERVER)
        self.assertIn('if(before!==desired)ctx.keymap.dispatch("session.sidebar.toggle")', driver.OBSERVER)
        self.assertIn('Owned sidebar test keys already bound', driver.OBSERVER)
        self.assertIn('ensureSidebar(originalSidebar)', driver.OBSERVER)
        self.assertLess(source.index('terminal.pump(5.5)'), source.index('terminal.set_open(True'))

    def test_public_command_ensure_is_idempotent_and_restores(self):
        # Execute the observer's actual command adapter against the documented SDK surface.
        import subprocess
        block = driver.OBSERVER.split('   let originalSidebar;', 1)[1].split('   for(const c', 1)[0]
        script = '''let originalSidebar; let visible=INITIAL, calls=0;
const fs={appendFileSync(){}}; const root="unused";
const ctx={keymap:{commands:()=>[{id:"session.sidebar.toggle",title:visible?"Hide sidebar":"Show sidebar"}],
dispatch:id=>{if(id!=="session.sidebar.toggle")throw Error("bad command");calls++;visible=!visible;}}};
''' + block + '''
ensureSidebar(true);ensureSidebar(true);
if(!visible||calls!==EXPECTED)throw Error("not idempotent");
ensureSidebar(originalSidebar);
if(visible!==INITIAL||calls!==EXPECTED*2)throw Error("not restored");
'''
        for initial in (True, False):
            result = subprocess.run(["bun", "-e", script.replace("INITIAL", str(initial).lower()).replace("EXPECTED", str(int(not initial)))],
                                    cwd=driver.ROOT, capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
