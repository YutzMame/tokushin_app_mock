from __future__ import annotations

import argparse
import functools
import http.server
import socketserver
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve the Tokushin mock web app.")
    parser.add_argument("--port", type=int, default=8000, help="Port to serve the mock app on.")
    parser.add_argument(
        "--directory",
        type=Path,
        default=Path("mock_app"),
        help="Directory containing the static mock app.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    app_dir = args.directory.resolve()
    if not app_dir.exists():
        raise FileNotFoundError(f"Mock app directory not found: {app_dir}")

    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(app_dir))
    with socketserver.TCPServer(("", args.port), handler) as httpd:
        print(f"Serving {app_dir} at http://localhost:{args.port}")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
