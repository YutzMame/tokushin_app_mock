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

PAGES = [
    ("生徒用", "/student_app_v2.html"),
    ("校舎スタッフ用", "/staff_app_v2.html"),
    ("講師・教室担当用", "/teacher_app_v2.html"),
    ("校舎QR読取タブレット", "/tablet_qr_app_v2.html"),
]


def _start_server(port: int):
    """mock_app_v2 をローカル配信するバックグラウンドサーバを起動（既存は停止）。"""
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
    return _SERVER


def serve_links_v2(port: int = 8000):
    """4画面（生徒用・校舎用・講師用・タブレット）を別ウィンドウで開くリンクを発行。

    実ディレクトリを配信するため data/*.csv を読み込み、機能を実際に操作できる。
    """
    _start_server(port)
    try:
        from google.colab.output import serve_kernel_port_as_window

        for label, path in PAGES:
            print(f"▼ {label}（別ウィンドウで開く）")
            serve_kernel_port_as_window(port, path=path)
    except Exception:
        print("Colab外のためローカルURLを表示します:")
        for label, path in PAGES:
            print(f"  {label}: http://localhost:{port}{path}")
    return _SERVER
