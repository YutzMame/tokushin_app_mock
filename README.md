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

v2アプリを起動する場合:

```bash
uv run python main.py --directory mock_app_v2 --port 8010
```

起動後、`http://localhost:8010` から生徒用・校舎スタッフ用・講師/教室担当用の各画面を開けます。

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

v2は次のヘルパーで表示できます。

```python
import importlib.util

spec = importlib.util.spec_from_file_location("colab_preview_v2", "mock_app_v2/colab_preview_v2.py")
preview_v2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview_v2)

preview_v2.show_index_v2()
preview_v2.show_student_app_v2()
preview_v2.show_staff_app_v2()
preview_v2.show_teacher_app_v2()
preview_v2.show_tablet_qr_app_v2()
```

議論用にNotebookとして共有する場合は、Colabで `mock_app_v2/colab_discussion_v2.ipynb` を開き、上から順に実行します。画面別にセルを分けてあるため、MTG中は必要な画面だけ再実行できます。

## 成果物

### v2

- `mock_app_v2/index.html`: v2入口、4導線（生徒/校舎スタッフ/講師/校舎QR読取タブレット）、データ状態確認
- `mock_app_v2/student_app_v2.html`: 生徒用。初期設定風ログイン、講座（講師名表示）、出席登録（教室QR読取/QR提示）、アンケート、学習ログ。起動時に未読の重要変更をモーダル表示
- `mock_app_v2/staff_app_v2.html`: 校舎スタッフ用。ホームで講座を選び、講座変更、代理入室、紙回答、配布物リマインド、異常・声かけ、CSV出力を操作
- `mock_app_v2/teacher_app_v2.html`: 講師・教室担当用。担当講座、授業中メモ、配布物一覧と欠席者受け渡し、アンケート傾向、次回メモ
- `mock_app_v2/tablet_qr_app_v2.html`: 校舎QR読取タブレット用。生徒提示QRの読取入室登録と、入室生徒の氏名・高校・学年・受講コマ数・過去出席歴・各種フラグのリアルタイム表示（顔・氏名照合用）
- `mock_app_v2/assets/app_v2.js`: CSV読込、`localStorage` 保存、操作反映、配布物・通知・タブレットロスター、CSV出力
- `mock_app_v2/data/*_v2.csv`: v2用の架空サンプルCSV（`courses_v2.csv` は配布物 `materials` 列を含む）
- `mock_app_v2/colab_preview_v2.py`: Colab表示用のCSS/JS/CSV埋め込みヘルパー
- `mock_app_v2/colab_discussion_v2.ipynb`: Colab共有・議論用Notebook

### 旧モック

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
