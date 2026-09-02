from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
HOST = "127.0.0.1"
PORT = 1420


def wait_for_server(process: subprocess.Popen[str], timeout: float = 30) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            output = process.stdout.read() if process.stdout else ""
            raise RuntimeError(f"Vite exited before becoming ready:\n{output}")
        try:
            with socket.create_connection((HOST, PORT), timeout=0.25):
                return
        except OSError:
            time.sleep(0.1)
    raise TimeoutError("Vite did not become ready within 30 seconds")


def start_vite() -> subprocess.Popen[str]:
    vite = ROOT / "node_modules" / ".bin" / ("vite.cmd" if os.name == "nt" else "vite")
    if not vite.exists():
        raise FileNotFoundError("Run pnpm install before the browser smoke test")
    command = [str(vite), "--host", HOST, "--port", str(PORT)]
    if os.name == "nt":
        command = ["cmd.exe", "/d", "/s", "/c", *command]
    creation_flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    return subprocess.Popen(
        command,
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        creationflags=creation_flags,
    )


def launch_browser(playwright):
    try:
        return playwright.chromium.launch(headless=True)
    except PlaywrightError:
        if os.name == "nt":
            for candidate in (
                Path(os.environ.get("PROGRAMFILES(X86)", "")) / "Microsoft/Edge/Application/msedge.exe",
                Path(os.environ.get("PROGRAMFILES", "")) / "Microsoft/Edge/Application/msedge.exe",
            ):
                if candidate.is_file():
                    return playwright.chromium.launch(headless=True, executable_path=str(candidate))
        raise


def run_browser_contracts() -> None:
    with sync_playwright() as playwright:
        browser = launch_browser(playwright)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        console_errors: list[str] = []
        page.on(
            "console",
            lambda message: console_errors.append(message.text) if message.type == "error" else None,
        )
        page.add_init_script(
            "if (window === top) localStorage.setItem('orcarouter_api_key', 'legacy-secret')"
        )
        page.goto(f"http://{HOST}:{PORT}")
        page.wait_for_load_state("networkidle")

        assert page.locator("strong", has_text="Nova").first.is_visible()
        assert page.evaluate("localStorage.getItem('orcarouter_api_key')") is None
        assert page.locator("text=在此设备记住密钥").count() == 0

        page.locator("#provider").select_option("orcarouter")
        page.locator("#orcarouter-key").fill("memory-only-test-key")
        page.locator("#execution-mode").select_option("agent")
        assert page.get_by_role("button", name="选择工作目录").is_visible()
        assert page.locator("#forge-prompt").is_disabled()

        preview_ok = page.evaluate(
            """async () => {
              const { auditHtmlInPreview } = await import('/src/tools/preview.ts');
              return auditHtmlInPreview('<!doctype html><html><head><title>OK</title></head><body><main>Hello</main></body></html>');
            }"""
        )
        assert preview_ok["passed"] is True
        preview_bad = page.evaluate(
            """async () => {
              const { auditHtmlInPreview } = await import('/src/tools/preview.ts');
              return auditHtmlInPreview('<!doctype html><html><head><title>Bad</title></head><body><script>throw new Error("boom")</script></body></html>');
            }"""
        )
        assert preview_bad["passed"] is False
        assert any("boom" in issue["message"] for issue in preview_bad["issues"])

        unexpected = [
            error
            for error in console_errors
            if error != "Failed to load resource: net::ERR_CONNECTION_REFUSED"
        ]
        assert not unexpected, f"browser console errors: {unexpected}"
        browser.close()


def main() -> int:
    server = start_vite()
    try:
        wait_for_server(server)
        run_browser_contracts()
        print("nova browser smoke: ok")
        return 0
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()


if __name__ == "__main__":
    sys.exit(main())
