from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CSS_PATH = ROOT / "assets" / "screens.css"
JS_PATH = ROOT / "assets" / "prototype.js"
DATA_DIR = ROOT / "data"


def _csv_payload() -> dict[str, str]:
    return {
        f"data/{path.name}": path.read_text(encoding="utf-8")
        for path in sorted(DATA_DIR.glob("*.csv"))
    }


def _display_tools():
    from IPython.display import HTML, display

    return HTML, display


def _render(path: str):
    HTML, _ = _display_tools()
    html = (ROOT / path).read_text(encoding="utf-8")
    css = CSS_PATH.read_text(encoding="utf-8")
    js = JS_PATH.read_text(encoding="utf-8")
    payload = json.dumps(_csv_payload(), ensure_ascii=False)
    html = html.replace('<link rel="stylesheet" href="assets/screens.css">', f"<style>{css}</style>")
    html = html.replace(
        '<script src="assets/prototype.js"></script>',
        f"<script>window.__MOCK_CSVS__ = {payload};</script><script>{js}</script>",
    )
    return HTML(html)


def show_student_app() -> None:
    _, display = _display_tools()
    display(_render("student_app.html"))


def show_student_staff_scan_app() -> None:
    _, display = _display_tools()
    display(_render("student_staff_scan_app.html"))


def show_staff_app() -> None:
    _, display = _display_tools()
    display(_render("staff_app.html"))
