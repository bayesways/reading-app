#!/usr/bin/env python3
"""Standalone pi-reader smoke test; local article and fake auth, no model call."""
import http.server
import json
import os
import re
import signal
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class Page(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        paragraph = "<h1>Standalone reader</h1><p>The posterior represents updated uncertainty from evidence.</p>"
        body = ("<html><head><title>Standalone smoke fixture</title></head><body><article>"
                + paragraph * 3 + "</article></body></html>").encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


def main():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Page)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    process = None
    try:
        with tempfile.TemporaryDirectory(prefix="pi-reader-cli-") as directory:
            root = Path(directory)
            config = root / "reader.json"
            config.write_text(json.dumps({
                "defaultModel": "openai/gpt-5.2",
                "defaultThinkingLevel": "low",
            }))
            env = dict(os.environ, PI_CODING_AGENT_DIR=str(root / "pi"), OPENAI_API_KEY="fake-test-key",
                    PI_OFFLINE="1", PI_TELEMETRY="0")
            article = f"http://127.0.0.1:{server.server_port}/article"
            process = subprocess.Popen([
                str(ROOT / "bin/pi-reader.mjs"), "--no-open", "--config", str(config), article,
            ], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            output = ""
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline and "Press Ctrl+C" not in output:
                line = process.stdout.readline()
                if not line and process.poll() is not None:
                    break
                output += line
            assert process.poll() is None, f"pi-reader exited early: {output}"
            match = re.search(r"http://127\.0\.0\.1:\d+/[A-Za-z0-9_-]{43}/", output)
            assert match, f"No capability URL: {output}"
            url = match.group()
            with urllib.request.urlopen(url + "api/state", timeout=5) as response:
                state = json.load(response)
            assert state["model"] == "openai/gpt-5.2 · thinking:low"
            assert state["current"]["article"]["title"] == "Standalone smoke fixture"
            process.send_signal(signal.SIGINT)
            assert process.wait(timeout=10) == 0, output
            try:
                urllib.request.urlopen(url + "api/state", timeout=2)
                raise AssertionError("Standalone server remained reachable after Ctrl+C")
            except urllib.error.URLError:
                pass
            assert not list(root.rglob("*.jsonl")), "Standalone reader created a pi session"
            print("PASS (standalone): config model/thinking, article API, clean shutdown; no saved session")
    finally:
        if process is not None and process.poll() is None:
            process.kill()
            process.wait(timeout=10)
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
