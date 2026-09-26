#!/usr/bin/env python3
"""Real pi PTY smoke test; local HTTP fixture, no model requests or saved sessions."""
import fcntl
import http.server
import os
import pty
import re
import select
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import threading
import time
import urllib.error
import urllib.request
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class Page(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        paragraph = ("<h1>Reading with evidence</h1><p>Bayesian inference combines prior knowledge "
                "with observations. The posterior represents updated uncertainty. "
                "Careful interpretation of evidence helps us distinguish explanations "
                "from the observations that support them.</p>")
        body = ("<html><head><title>Reader smoke fixture</title></head><body><article>"
                + paragraph * 3 + "</article></body></html>").encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


def main():
    browser_mode = "--browser" in sys.argv
    mode = "fullscreen" if "--fullscreen" in sys.argv else "regular"
    executable = shutil.which("pi")
    if not executable:
        raise RuntimeError("Install pi before running the terminal smoke test")
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Page)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 32, 120, 0, 0))
    proc = None
    transcript = bytearray()

    def drain(duration=0.5):
        deadline = time.monotonic() + duration
        while time.monotonic() < deadline:
            if select.select([master], [], [], 0.05)[0]:
                try:
                    transcript.extend(os.read(master, 65536))
                except OSError:
                    break

    def wait_for(needle, start=0, timeout=20):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if needle.encode() in transcript[start:]:
                return
            if select.select([master], [], [], 0.1)[0]:
                try:
                    data = os.read(master, 65536)
                except OSError:
                    break
                transcript.extend(data)
                # Answer terminal queries so initialization doesn't depend on a real terminal.
                if b"\x1b[6n" in data:
                    os.write(master, b"\x1b[1;1R")
                if b"\x1b[c" in data:
                    os.write(master, b"\x1b[?1;2c")
        raise AssertionError(f"Did not render {needle!r}. Output tail: {transcript[-5000:]!r}")

    try:
        with tempfile.TemporaryDirectory(prefix="pi-reader-smoke-") as config:
            env = dict(os.environ, TERM="xterm-256color", PI_CODING_AGENT_DIR=config,
                    PI_TELEMETRY="0", PI_READER_BROWSER_OPEN="0")
            proc = subprocess.Popen([
                executable, "--offline", "--no-session", "--no-extensions", "--no-skills",
                "--no-prompt-templates", "--no-context-files", "--no-themes", "--no-approve",
                "--provider", "openai", "--model", "gpt-4o", "--tui-mode", mode,
                "-e", str(ROOT / "src/index.ts"),
            ], cwd=ROOT, env=env, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
            os.close(slave)
            wait_for("gpt-4o")
            # Let the editor attach after startup status has printed.
            drain()
            if browser_mode:
                start = len(transcript)
                os.write(master, f"/reader --browser http://127.0.0.1:{server.server_port}/article\r".encode())
                wait_for("Browser reader opened at", start)
                match = re.search(rb"http://127\.0\.0\.1:\d+/[A-Za-z0-9_-]{43}/", transcript[start:])
                assert match, f"No browser capability URL in output: {transcript[start:]!r}"
                browser_url = match.group().decode()
                with urllib.request.urlopen(browser_url + "api/state", timeout=5) as response:
                    state = json.load(response)
                with (ROOT / "reader.config.json").open() as config_file:
                    reader_config = json.load(config_file)
                expected_model = reader_config.get("defaultModel") or "openai/gpt-4o"
                expected_thinking = reader_config.get("defaultThinkingLevel") or "off"
                assert state["model"] == f"{expected_model} · thinking:{expected_thinking}", state["model"]
                assert state["current"]["article"]["title"] == "Reader smoke fixture"
                content = state["current"]["article"]["content"]
                assert content["format"] == "html"
                assert "Bayesian inference" in content["text"]
                start = len(transcript)
                os.write(master, b"/reader --browser-stop\r")
                wait_for("Browser reader stopped", start)
                try:
                    urllib.request.urlopen(browser_url + "api/state", timeout=2)
                    raise AssertionError("Browser reader remained reachable after --browser-stop")
                except urllib.error.URLError:
                    pass
                os.write(master, b"\x04")
            else:
                start = len(transcript)
                os.write(master, f"/reader http://127.0.0.1:{server.server_port}/article\r".encode())
            if not browser_mode:
                wait_for("Reader smoke fixture", start)
                wait_for("QUESTIONS", start)
                wait_for("openai/gpt-4o", start)
                drain()
                start = len(transcript)
                os.write(master, b"vw")  # Keyboard cursor at the title, select its first word.
                wait_for("Selected: Reader", start)
                drain()
                os.write(master, b"\x1b[19~")  # F8 clears without closing.
                drain()
            if not browser_mode and mode == "fullscreen":
                start = len(transcript)
                # Drag across 'Reader' on the first article row (SGR mouse, 1-based coordinates).
                os.write(master, b"\x1b[<0;1;5M\x1b[<32;6;5M\x1b[<0;6;5m")
                wait_for("Selected: Reader", start)
                drain()
                start = len(transcript)
                os.write(master, b"\x1b[<0;9;5M\x1b[<0;9;5m")  # Click inside 'smoke'.
                wait_for("Selected: smoke", start)
                drain()
                os.write(master, b"\x1b[19~")
                drain()
            if not browser_mode:
                os.write(master, b"\x1b")
                drain()
                start = len(transcript)
                os.write(master, b"/reader\r")
                wait_for("Reader smoke fixture", start)
                fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 20, 72, 0, 0))
                start = len(transcript)
                os.kill(proc.pid, signal.SIGWINCH)
                wait_for("Tab switches panes", start)
                os.write(master, b"\x03")  # Close reader, not pi.
                drain()
                os.write(master, b"\x04")
            deadline = time.monotonic() + 10
            while proc.poll() is None and time.monotonic() < deadline:
                if select.select([master], [], [], 0.1)[0]:
                    try:
                        transcript.extend(os.read(master, 65536))
                    except OSError:
                        break
            assert proc.poll() == 0, f"pi did not exit cleanly: {transcript[-2000:]!r}"
            assert not list(Path(config).rglob("*.jsonl")), "Unexpected saved session"
            label = "browser" if browser_mode else mode
            print(f"PASS ({label}): model header, article, selection/API, lifecycle, clean exit; no saved session")
    finally:
        if proc is not None and proc.poll() is None:
            proc.kill()
            proc.wait(timeout=10)
        os.close(master)
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
