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
