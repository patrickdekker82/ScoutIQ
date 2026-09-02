"""Entry point: fetch configured targets and drop payloads into the inbox."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone

from .config import load_config
from .normalise import build_payload


def _scrape(url: str, timeout_ms: int, user_agent: str) -> list[dict[str, object]]:
    """Fetch one target with Playwright.

    Expects the page to expose a `window.__SCOUTIQ__` array; adapt per source.
    Playwright is imported lazily so `--dry-run` works without a browser.
    """
    from playwright.sync_api import sync_playwright  # noqa: PLC0415

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(args=["--no-sandbox"])
        try:
            page = browser.new_page(user_agent=user_agent)
            page.goto(url, timeout=timeout_ms, wait_until="networkidle")
            rows = page.evaluate("() => window.__SCOUTIQ__ || []")
            return list(rows or [])
        finally:
            browser.close()


def run_once(dry_run: bool = False) -> int:
    config = load_config()
    if not config.targets:
        print("[ingest] no INGEST_TARGETS configured; nothing to do", file=sys.stderr)
        return 0

    os.makedirs(config.inbox, exist_ok=True)
    written = 0

    for index, target in enumerate(config.targets):
        rows: list[dict[str, object]] = []
        if not dry_run:
            try:
                rows = _scrape(target, config.timeout_ms, config.user_agent)
            except Exception as error:  # noqa: BLE001 - one bad target must not stop the rest
                print(f"[ingest] target failed: {target}: {error}", file=sys.stderr)
                continue

        payload = build_payload(rows)
        stamp = datetime.now(tz=timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        path = os.path.join(config.inbox, f"ingest-{stamp}-{index}.json")
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
        written += 1
        print(f"[ingest] wrote {len(payload['players'])} players -> {path}", file=sys.stderr)

    return written


def main() -> int:
    parser = argparse.ArgumentParser(prog="scoutiq-ingest")
    parser.add_argument("--loop", action="store_true", help="run continuously")
    parser.add_argument("--dry-run", action="store_true", help="skip the browser, write empty payloads")
    args = parser.parse_args()

    if not args.loop:
        run_once(dry_run=args.dry_run)
        return 0

    interval = load_config().interval_seconds
    while True:
        run_once(dry_run=args.dry_run)
        time.sleep(interval)


if __name__ == "__main__":
    raise SystemExit(main())
