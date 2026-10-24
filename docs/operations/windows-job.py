"""Finite Windows process-tree launcher; never attach an existing service."""
import argparse
import ctypes as c
from ctypes import wintypes as w
import json
import os
from pathlib import Path
import subprocess
import time
import uuid


class Startup(c.Structure):
    _fields_ = [("cb", w.DWORD), ("reserved", w.LPWSTR), ("desktop", w.LPWSTR),
                ("title", w.LPWSTR), *[(n, w.DWORD) for n in
                ("x", "y", "xs", "ys", "xc", "yc", "fill", "flags")],
                ("show", w.WORD), ("reserved_size", w.WORD), ("reserved2", c.c_void_p),
                ("stdin", w.HANDLE), ("stdout", w.HANDLE), ("stderr", w.HANDLE)]


class Process(c.Structure):
    _fields_ = [("process", w.HANDLE), ("thread", w.HANDLE),
                ("pid", w.DWORD), ("tid", w.DWORD)]


class Limits(c.Structure):
    _fields_ = [("process_time", c.c_int64), ("job_time", c.c_int64),
                ("flags", w.DWORD), ("minimum", c.c_size_t), ("maximum", c.c_size_t),
                ("active", w.DWORD), ("affinity", c.c_size_t),
                ("priority", w.DWORD), ("scheduling", w.DWORD)]


class Extended(c.Structure):
    _fields_ = [("basic", Limits), ("io", c.c_uint64 * 6),
                ("process_memory", c.c_size_t), ("job_memory", c.c_size_t),
                ("peak_process", c.c_size_t), ("peak_job", c.c_size_t)]


class Members(c.Structure):
    _fields_ = [("assigned", w.DWORD), ("count", w.DWORD), ("pids", c.c_size_t * 256)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cwd", required=True)
    parser.add_argument("--evidence", required=True)
    parser.add_argument("--timeout", type=int, default=600)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    cwd, evidence = Path(args.cwd).resolve(), Path(args.evidence).resolve()
    if not cwd.is_relative_to(root) or not evidence.is_relative_to(root):
        parser.error("cwd and evidence must remain in this worktree")
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command or not 1 <= args.timeout <= 600:
        parser.error("command required; timeout must be 1..600 seconds")
    k = c.WinDLL("kernel32", use_last_error=True)
    signatures = {
        "CreateJobObjectW": ([c.c_void_p, w.LPCWSTR], w.HANDLE),
        "SetInformationJobObject": ([w.HANDLE, c.c_int, c.c_void_p, w.DWORD], w.BOOL),
        "QueryInformationJobObject": ([w.HANDLE, c.c_int, c.c_void_p, w.DWORD, c.c_void_p], w.BOOL),
        "CreateProcessW": ([w.LPCWSTR, w.LPWSTR, c.c_void_p, c.c_void_p, w.BOOL,
                            w.DWORD, c.c_void_p, w.LPCWSTR, c.POINTER(Startup), c.POINTER(Process)], w.BOOL),
        "AssignProcessToJobObject": ([w.HANDLE, w.HANDLE], w.BOOL),
        "ResumeThread": ([w.HANDLE], w.DWORD),
        "WaitForSingleObject": ([w.HANDLE, w.DWORD], w.DWORD),
        "GetExitCodeProcess": ([w.HANDLE, c.POINTER(w.DWORD)], w.BOOL),
        "TerminateProcess": ([w.HANDLE, w.UINT], w.BOOL),
        "CloseHandle": ([w.HANDLE], w.BOOL),
    }
    for name, (inputs, output) in signatures.items():
        getattr(k, name).argtypes, getattr(k, name).restype = inputs, output

    def check(ok):
        if not ok:
            raise c.WinError(c.get_last_error())

    def members(job):
        data = Members()
        check(k.QueryInformationJobObject(job, 3, c.byref(data), c.sizeof(data), None))
        return list(data.pids[:data.count])

    job_name = 'Local\\cmon-owned-' + uuid.uuid4().hex
    job = k.CreateJobObjectW(None, job_name)
    check(job)
    process, assigned = Process(), False
    result = {"kill_on_close": True, "breakaway_allowed": False, "observed_pids": []}
    exit_code = 1
    proof = evidence.with_suffix('.pty.json')
    if proof.exists():
        k.CloseHandle(job)
        raise RuntimeError('Use a fresh evidence/proof path')
    previous = {key: os.environ.get(key) for key in ('CMON_JOB_NAME', 'CMON_JOB_PROOF')}
    try:
        limits = Extended()
        limits.basic.flags = 0x2000  # KILL_ON_JOB_CLOSE; no BREAKAWAY flags.
        check(k.SetInformationJobObject(job, 9, c.byref(limits), c.sizeof(limits)))
        effective = Extended()
        check(k.QueryInformationJobObject(job, 9, c.byref(effective), c.sizeof(effective), None))
        if effective.basic.flags != 0x2000:
            raise RuntimeError("Job containment flags do not match")
        result["verified_limit_flags"] = effective.basic.flags
        startup = Startup()
        startup.cb = c.sizeof(startup)
        os.environ['CMON_JOB_NAME'] = job_name
        os.environ['CMON_JOB_PROOF'] = str(proof)
        check(k.CreateProcessW(None, c.create_unicode_buffer(subprocess.list2cmdline(command)),
                              None, None, False, 0x4, None, str(cwd),
                              c.byref(startup), c.byref(process)))  # CREATE_SUSPENDED
        check(k.AssignProcessToJobObject(job, process.process))
        assigned = True
        if k.ResumeThread(process.thread) == 0xFFFFFFFF:
            raise c.WinError(c.get_last_error())
        deadline = time.monotonic() + args.timeout
        observed = set()
        while True:
            observed.update(members(job))
            wait = k.WaitForSingleObject(process.process, 100)
            if wait == 0:
                code = w.DWORD()
                check(k.GetExitCodeProcess(process.process, c.byref(code)))
                exit_code = code.value
                break
            if wait != 258:
                raise RuntimeError("Unexpected process wait status")
            if time.monotonic() >= deadline:
                result["timed_out"] = True
                exit_code = 124
                break
        result["observed_pids"] = sorted(observed)
        result["root_exit"] = exit_code
        if proof.exists():
            result['pty_proof'] = json.loads(proof.read_text(encoding='utf-8'))
            p = result['pty_proof']
            result['containment_proven'] = bool(p.get('conpty_in_job') and p.get('application_in_job')
                                               and p.get('verified_before_resume')
                                               and {p['conpty_pid'], p['application_pid']}.issubset(observed))
        else:
            result['containment_proven'] = False
        if not result['containment_proven'] and exit_code == 0:
            exit_code = 126
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        # Terminate then query while the job is still open. Kill-on-close is also
        # retained as the safety net if any cleanup call raises.
        try:
            if process.process and not assigned:
                check(k.TerminateProcess(process.process, 1))
                check(k.WaitForSingleObject(process.process, 10000) == 0)
            if assigned:
                result["members_before_cleanup"] = members(job)
                k.TerminateJobObject.argtypes = [w.HANDLE, w.UINT]
                k.TerminateJobObject.restype = w.BOOL
                check(k.TerminateJobObject(job, 1))
                deadline = time.monotonic() + 30
                remaining = members(job)
                while remaining and time.monotonic() < deadline:
                    time.sleep(0.1)
                    remaining = members(job)
                result["remaining_pids"] = remaining
                result["cleanup_ok"] = not remaining
        finally:
            k.CloseHandle(job)
            for handle in (process.thread, process.process):
                if handle:
                    k.CloseHandle(handle)
            evidence.write_text(json.dumps(result, indent=2), encoding="utf-8")
    return exit_code if result.get("cleanup_ok") else 125


if __name__ == "__main__":
    raise SystemExit(main())
