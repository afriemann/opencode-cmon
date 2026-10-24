"""ConPTY bootstrap: prove containment before starting any application code."""
import argparse
import ctypes as c
from ctypes import wintypes as w
import json
import os
from pathlib import Path
import runpy
import subprocess
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--parent-pid', required=True, type=int)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command:
        parser.error('application command required')
    root = Path(__file__).resolve().parents[2]
    proof = Path(os.environ['CMON_JOB_PROOF']).resolve()
    if not proof.is_relative_to(root) or proof.exists():
        raise RuntimeError('Proof must be a fresh worktree path')
    types = runpy.run_path(str(Path(__file__).with_name('windows-job.py')))
    Startup, Process = types['Startup'], types['Process']
    k = c.WinDLL('kernel32', use_last_error=True)
    signatures = {
        'OpenJobObjectW': ([w.DWORD, w.BOOL, w.LPCWSTR], w.HANDLE),
        'OpenProcess': ([w.DWORD, w.BOOL, w.DWORD], w.HANDLE),
        'GetCurrentProcess': ([], w.HANDLE),
        'IsProcessInJob': ([w.HANDLE, w.HANDLE, c.POINTER(w.BOOL)], w.BOOL),
        'AssignProcessToJobObject': ([w.HANDLE, w.HANDLE], w.BOOL),
        'GetProcessTimes': ([w.HANDLE] + [c.c_void_p]*4, w.BOOL),
        'CreateProcessW': ([w.LPCWSTR, w.LPWSTR, c.c_void_p, c.c_void_p, w.BOOL,
                           w.DWORD, c.c_void_p, w.LPCWSTR, c.POINTER(Startup), c.POINTER(Process)], w.BOOL),
        'ResumeThread': ([w.HANDLE], w.DWORD),
        'WaitForSingleObject': ([w.HANDLE, w.DWORD], w.DWORD),
        'GetExitCodeProcess': ([w.HANDLE, c.POINTER(w.DWORD)], w.BOOL),
        'TerminateProcess': ([w.HANDLE, w.UINT], w.BOOL),
        'CloseHandle': ([w.HANDLE], w.BOOL),
    }
    for name, (inputs, output) in signatures.items():
        getattr(k, name).argtypes, getattr(k, name).restype = inputs, output

    def check(ok):
        if not ok:
            raise c.WinError(c.get_last_error())

    def identity(handle):
        # PROCESS_BASIC_INFORMATION: final pointer-sized field is parent PID.
        info = (c.c_void_p * 6)()
        n = c.WinDLL('ntdll').NtQueryInformationProcess
        n.argtypes = [w.HANDLE, w.ULONG, c.c_void_p, w.ULONG, c.c_void_p]
        n.restype = c.c_long
        if n(handle, 0, c.byref(info), c.sizeof(info), None) != 0:
            raise RuntimeError('Cannot establish process parent')
        times = [c.c_uint64() for _ in range(4)]
        check(k.GetProcessTimes(handle, *(c.byref(t) for t in times)))
        return {'parent_pid': info[5], 'creation_filetime': times[0].value}

    job = k.OpenJobObjectW(0x0001 | 0x0004, False, os.environ['CMON_JOB_NAME'])
    check(job)
    parent = None
    app = Process()
    resumed = False
    try:
        parent = k.OpenProcess(0x1000, False, args.parent_pid)
        check(parent)
        inside = w.BOOL()
        check(k.IsProcessInJob(parent, job, c.byref(inside)))
        if not inside.value:
            raise RuntimeError('Claimed worker is not in the owned job')
        own = identity(k.GetCurrentProcess())
        worker = identity(parent)
        if own['parent_pid'] != args.parent_pid or own['creation_filetime'] < worker['creation_filetime']:
            raise RuntimeError('ConPTY parent/creation identity mismatch')
        check(k.IsProcessInJob(k.GetCurrentProcess(), job, c.byref(inside)))
        inherited = bool(inside.value)
        if not inherited:
            check(k.AssignProcessToJobObject(job, k.GetCurrentProcess()))
        check(k.IsProcessInJob(k.GetCurrentProcess(), job, c.byref(inside)))
        if not inside.value:
            raise RuntimeError('Actual ConPTY child membership not proven')
        startup = Startup()
        startup.cb = c.sizeof(startup)
        check(k.CreateProcessW(None, c.create_unicode_buffer(subprocess.list2cmdline(command)),
                              None, None, False, 0x4, None, os.getcwd(),
                              c.byref(startup), c.byref(app)))
        check(k.IsProcessInJob(app.process, job, c.byref(inside)))
        if not inside.value:
            check(k.AssignProcessToJobObject(job, app.process))
        check(k.IsProcessInJob(app.process, job, c.byref(inside)))
        child = identity(app.process)
        if not inside.value or child['parent_pid'] != os.getpid() or child['creation_filetime'] < own['creation_filetime']:
            raise RuntimeError('Suspended application containment/identity not proven')
        record = {'conpty_pid': os.getpid(), 'conpty': own, 'worker_pid': args.parent_pid,
                  'worker': worker, 'conpty_inherited': inherited, 'conpty_in_job': True,
                  'application_pid': app.pid, 'application': child, 'application_in_job': True,
                  'verified_before_resume': True}
        temporary = proof.with_suffix('.tmp')
        temporary.write_text(json.dumps(record, indent=2), encoding='utf-8')
        temporary.replace(proof)
        if k.ResumeThread(app.thread) == 0xFFFFFFFF:
            raise c.WinError(c.get_last_error())
        resumed = True
    finally:
        # Never retain a job handle while the application runs: outer
        # kill-on-close must work even if the supervisor crashes.
        k.CloseHandle(job)
        if parent:
            k.CloseHandle(parent)
        if app.process and not resumed:
            k.TerminateProcess(app.process, 1)
        if app.thread:
            k.CloseHandle(app.thread)
    try:
        # The supervisor supplies the finite deadline and whole-job teardown.
        wait = k.WaitForSingleObject(app.process, 100)
        while wait == 258:
            time.sleep(.01)
            wait = k.WaitForSingleObject(app.process, 100)
        if wait != 0:
            raise RuntimeError('Unexpected application wait status')
        status = w.DWORD()
        check(k.GetExitCodeProcess(app.process, c.byref(status)))
        return status.value
    finally:
        if app.process:
            k.CloseHandle(app.process)


if __name__ == '__main__':
    raise SystemExit(main())
