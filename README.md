# tokushin-app-mock

東大特進ライブ授業の出席管理・授業後アンケートDX検討用モックです。

## ローカルで見る

```bash
uv run python main.py
```

起動後、ブラウザで `http://localhost:8000` を開きます。ポートを変える場合:

```bash
uv run python main.py --port 8010
```

## Colabで見る

リポジトリをColab上にクローンした後、依存関係なしでHTMLを表示できます。

```python
from IPython.display import HTML, display

display(HTML(open("mock_app/index.html", encoding="utf-8").read()))
```

共有用の生徒画面・校舎スタッフ画面は完全に分けて表示します。ColabではCSS/JS/CSVを埋め込んで表示します。

```python
import importlib.util

spec = importlib.util.spec_from_file_location("colab_preview", "mock_app/colab_preview.py")
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)

preview.show_student_app()
preview.show_student_staff_scan_app()
preview.show_staff_app()
```

## 成果物

- `mock_app/index.html`: 説明付きの静的CSVプロトタイプ概要
- `mock_app/student_app.html`: 共有用の生徒スマホ画面
- `mock_app/student_staff_scan_app.html`: 生徒がQRを提示し、校舎側が読み取る方式の生徒スマホ画面
- `mock_app/staff_app.html`: 共有用の校舎スタッフPC画面
- 生徒画面は「講座」「出席登録」「アンケート」「カレンダー」「お知らせ」「学習ログ」に分離しています
- 校舎スタッフ画面は校舎選択・講座選択を持ち、講座別に出席/アンケート/変更/代理対応/受講コマを確認できます
- `courses.csv` は学年・教室を持ち、同時刻に複数学年の講座があるケースも講座選択で区別できます
- `mock_app/data/*.csv`: プロトタイプが参照する静的CSV
- `mock_app/assets/prototype.js`: CSV読み込み、状態更新、CSV出力の共通JS
- `mock_app/colab_preview.py`: Colab表示用のCSS/JS/CSV埋め込みヘルパー
- `courses.csv` を予定マスタとして扱い、生徒・校舎の両方でカレンダー表示します
- `mock_app/student.html`: 生徒用の授業アンケート画面
- `mock_app/staff.html`: 校舎スタッフ用の回答管理画面
- `mock_app/assets/screens.css`: 生徒用・校舎スタッフ用画面の共通スタイル
- `mock_app/slide_outline.md`: スライド化用の箇条書き
- `mock_app/assets/survey_swimlane_flow.svg`: 横軸時間・縦軸部門のフロー図
