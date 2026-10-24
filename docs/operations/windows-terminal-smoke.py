"""No-service ConPTY/terminal-parser readiness smoke, run inside windows-job.py."""
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import threading
import time

import pyte
from winpty import Backend, PtyProcess

destination = Path(sys.argv[1]).resolve()
root = Path(__file__).resolve().parents[2]
if not destination.is_relative_to(root):
    raise SystemExit("Evidence must remain in the worktree")
screen = pyte.Screen(80, 24)
stream = pyte.Stream(screen)
terminal = PtyProcess.spawn(
    [sys.executable, '-s', str(Path(__file__).with_name('windows-pty-gate.py')),
     '--parent-pid', str(os.getpid()), '--', sys.executable, "-u", "-c",
     "import time; print('\\x1b[2J\\x1b[HCONPTY-READY', flush=True); time.sleep(60)"],
    cwd=str(destination.parent), dimensions=(24, 80), backend=Backend.ConPTY,
)
ready = threading.Event()


def read():
    while terminal.isalive():
        stream.feed(terminal.read(4096))
        if any("CONPTY-READY" in row for row in screen.display):
            ready.set()
            return


threading.Thread(target=read, daemon=True).start()
if not ready.wait(10):
    raise SystemExit("ConPTY rendered-marker deadline exceeded")
terminal.setwinsize(30, 100)
destination.write_text(json.dumps({
    "python": sys.version.split()[0],
    "versions": {name: importlib.metadata.version(name) for name in ("pywinpty", "pyte", "wcwidth")},
    "backend": "ConPTY", "terminal_pid": terminal.pid,
    "rendered_marker": True, "resize_returned": True,
}, indent=2), encoding="utf-8")
# Leave a live owned terminal child for the outer job's whole-tree teardown proof.
time.sleep(2)
