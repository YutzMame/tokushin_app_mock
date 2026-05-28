from __future__ import annotations

import json
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent


def _csv_payload() -> dict[str, str]:
    return {
        f"data/{path.name}": path.read_text(encoding="utf-8")
        for path in sorted((BASE_DIR / "data").glob("*_v2.csv"))
    }


def _inline_html(filename: str) -> str:
    html = (BASE_DIR / filename).read_text(encoding="utf-8")
    css = (BASE_DIR / "assets" / "screens_v2.css").read_text(encoding="utf-8")
    js = (BASE_DIR / "assets" / "app_v2.js").read_text(encoding="utf-8")
    payload = json.dumps(_csv_payload(), ensure_ascii=False)
    html = html.replace(
        '<link rel="stylesheet" href="assets/screens_v2.css">',
        f"<style>{css}</style>",
    )
    html = html.replace(
        '<script src="assets/app_v2.js"></script>',
        f"<script>window.__MOCK_V2_CSVS__ = {payload};</script><script>{js}</script>",
    )
    return html


def _display(filename: str) -> None:
    from IPython.display import HTML, display

    display(HTML(_inline_html(filename)))


def show_index_v2() -> None:
    _display("index.html")


def show_student_app_v2() -> None:
    _display("student_app_v2.html")


def show_staff_app_v2() -> None:
    _display("staff_app_v2.html")


def show_teacher_app_v2() -> None:
    _display("teacher_app_v2.html")


def show_tablet_qr_app_v2() -> None:
    _display("tablet_qr_app_v2.html")


_SERVER = None


def serve_v2(port: int = 8000):
    """mock_app_v2 をローカル配信し、別ウィンドウで開くリンクを出す（Colab推奨）。

    インラインのHTML表示と違い、実データ（data/*.csv）を fetch で読み込み、
    画面間リンクも動くため、大きな別ウィンドウで機能を確認できる。
    """
    global _SERVER
    import functools
    import http.server
    import socketserver
    import threading

    if _SERVER is not None:
        try:
            _SERVER.shutdown()
            _SERVER.server_close()
        except Exception:
            pass
        _SERVER = None

    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(BASE_DIR))
    socketserver.TCPServer.allow_reuse_address = True
    _SERVER = socketserver.TCPServer(("", port), handler)
    threading.Thread(target=_SERVER.serve_forever, daemon=True).start()

    try:
        from google.colab.output import serve_kernel_port_as_window

        print("↓ このリンクが別ウィンドウで開く入口です（実データCSVを読み込み、機能を確認できます）")
        serve_kernel_port_as_window(port, path="/index.html")
    except Exception:
        print(f"ローカルで確認: http://localhost:{port}/index.html")
    return _SERVER
