"""Finite runtime/PTY facility probe, not application acceptance assertions."""
import importlib.metadata
import os
import pty
import select
import signal
import subprocess
import termios
import time
import json
import pathlib
import shutil

os.makedirs('/work/tmp', exist_ok=True)
for name in ('home', 'config', 'data', 'state', 'cache'):
    os.makedirs('/work/' + name, exist_ok=True)
result = subprocess.run(['opencode', '--version'], capture_output=True, text=True, timeout=30)
print('host version:', result.stdout.strip(), flush=True)
if result.returncode or result.stdout.strip() != 'opencode v2.0.24':
    raise SystemExit('unexpected host version: ' + result.stderr[-2000:])
subprocess.run(['opencode', '--help'], check=True, timeout=30)
master, slave = pty.openpty()
try:
    termios.tcgetattr(slave)
    print('PTY:', os.ttyname(slave))
finally:
    os.close(master)
    os.close(slave)
import pyte
screen = pyte.Screen(120, 40)
pyte.Stream(screen).feed('terminal facility ready')
print(screen.display[0].rstrip())
print('Python:', os.sys.version.split()[0])
for package in ('pyte', 'wcwidth'):
    print(package + ':', importlib.metadata.version(package))
subprocess.run(['sha256sum', '-c', '/opt/artifacts.sha256'], cwd='/opt/candidate', check=True, timeout=20)
print(pathlib.Path('/opt/artifacts.sha256').read_text(), flush=True)
subprocess.run(['opencode', 'reload', '--help'], check=True, timeout=15)
# Observe startup only: no input, mouse actions, terminal-query emulation or
# application acceptance assertions. Preserve raw output for a terminal runner.
project = pathlib.Path('/work/project')
project.mkdir(exist_ok=True)
(project / 'opencode.json').write_text(json.dumps({'plugins': ['file:///opt/candidate/dist']}))
master, slave = pty.openpty()
termios.tcsetwinsize(slave, (40, 120))
process = subprocess.Popen(['opencode', '--standalone'], cwd=project, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
os.close(slave)
raw = bytearray()
try:
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline and len(raw) < 1048576:
        if select.select([master], [], [], 0.2)[0]:
            try:
                chunk = os.read(master, min(65536, 1048576 - len(raw)))
            except OSError:
                break
            if not chunk:
                break
            raw.extend(chunk)
        if process.poll() is not None:
            break
    print('startup observation:', len(raw), 'bytes; process exit:', process.poll(), flush=True)
finally:
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=5)
    os.close(master)
pathlib.Path('/evidence/startup.raw').write_bytes(raw)
screen = pyte.Screen(120, 40)
pyte.ByteStream(screen).feed(bytes(raw))
pathlib.Path('/evidence/startup-screen.txt').write_text('\n'.join(screen.display))
for index, log in enumerate(sorted(pathlib.Path('/work').rglob('*.log'))[:8]):
    pathlib.Path(f'/evidence/startup-log-{index}.txt').write_bytes(log.read_bytes()[-65536:])
print('startup capture only; interactive readiness and plugin loading require independent assertions', flush=True)
for name in ('home', 'config', 'data', 'state', 'cache', 'tmp', 'project'):
    shutil.rmtree('/work/' + name, ignore_errors=False)
    pathlib.Path('/work/' + name).mkdir()
