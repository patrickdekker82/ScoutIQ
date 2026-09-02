"""HTTP entry point.

Uses the standard library rather than a web framework: this service has four
endpoints and no state, and a dependency-light image starts faster and has less
to keep patched.
"""

from __future__ import annotations

import argparse
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from .compute import cluster_players, kde_grid, tracking_summary

MAX_BODY_BYTES = 32 * 1024 * 1024


class Handler(BaseHTTPRequestHandler):
    server_version = "ScoutIQAnalytics/0.1"

    def do_GET(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        if self.path.rstrip("/") in ("/health", ""):
            self._send(200, {"status": "ok", "service": "scoutiq-analytics"})
        else:
            self._send(404, {"error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        try:
            payload = self._read_json()
        except ValueError as error:
            self._send(400, {"error": "invalid_request", "message": str(error)})
            return

        route = self.path.rstrip("/")
        try:
            if route == "/kde":
                self._send(
                    200,
                    kde_grid(
                        payload.get("points", []),
                        bandwidth=float(payload.get("bandwidth", 6.0)),
                        cols=int(payload.get("cols", 24)),
                        rows=int(payload.get("rows", 16)),
                    ),
                )
            elif route == "/cluster":
                self._send(
                    200,
                    cluster_players(
                        payload.get("vectors", {}),
                        clusters=int(payload.get("clusters", 4)),
                    ),
                )
            elif route == "/tracking-summary":
                self._send(
                    200,
                    tracking_summary(
                        payload.get("frames", []),
                        frame_rate_hz=float(payload.get("frameRateHz", 10.0)),
                    ),
                )
            else:
                self._send(404, {"error": "not_found"})
        except Exception as error:  # noqa: BLE001 - always answer with JSON
            self._send(500, {"error": "internal_error", "message": str(error)})

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("content-length") or 0)
        if length <= 0:
            return {}
        if length > MAX_BODY_BYTES:
            raise ValueError("request body too large")
        return json.loads(self.rfile.read(length) or b"{}")

    def _send(self, status: int, body: dict[str, Any]) -> None:
        encoded = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        # One structured line per request, to stdout like every other service.
        print(f'[analytics] {self.address_string()} {format % args}', flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(prog="scoutiq-analytics")
    parser.add_argument("--host", default=os.environ.get("ANALYTICS_HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("ANALYTICS_PORT", "8000")))
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[analytics] listening on {args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
