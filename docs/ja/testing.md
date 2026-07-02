# テスト

3 つのレイヤーで構成される：パッケージ単体テスト（高速、常時実行）、ビルド済みコックピットに対するヘッドレス e2e（モックモデル）、そしてキーでゲートされた能力ベンチ（実モデル、採点あり）。

## パッケージ単体テスト（`npm test -w @otterpatch/<pkg>`）

| パッケージ | カバー範囲 |
|---|---|
| `agent` | dialect の構築、provider ファクトリ、メッセージ正規化、修復ループ、json サルベージ、**doc tools**（read_blocks/find_text/outline/style-usage）、**word verifier**（引用の着地可能性）、**drawio verifier**（宙ぶらりんのエッジ / ゴースト id） |
| `skills` | SKILL.md の解析、マッチングとランキング（playbook タイブレークを含む）、render/L0、`instructionsFor`、playbook コンテンツ |
| `runtime` | イベントストリーム、verifier レジストリの配線、**最終セルフチェック**プロトコル（大規模 changeset のレビューラウンド） |
| `adapter-*`、`writeback-surgical` | コンパイル + surgical な書き戻しの忠実性 |

ランナー：`node --import tsx --test`（各 package.json を参照）。注意：package.json ファイルは必ず **BOM なし**を維持すること — tsx の JSON リーダーは UTF-8 BOM を拒否する。

## ヘッドレス e2e（`node test/<name>.mjs`）

`test/harness.mjs` が `apps/desktop/dist` を静的に配信し、ヘッドレス Chromium（Playwright）を駆動する。`/propose-stream` は固定 SSE でインターセプトされる — モデルもキーも不要。**先にビルドすること**（`npm run build -w @otterpatch/desktop`）。

| スイート | アサート内容 |
|---|---|
| `word-agent-mock`（23） | コンテキストに段落ごとの書式 + 選択範囲が含まれる；ルーズマッチによる着地；インラインマーク；4 状態トグル；accept-all が全マークを物理的に消去する |
| `word-review-e2e`（10） | ホバーカードの accept が 1 つの変更をフラット化する；どのビュー状態でもテキストが消失しない；2 ターン目のコンテキストが削除済みテキストを除外する；レビュー途中のリロード後も承認が機能し続ける |
| `word-docfmt-e2e`（10） | `all=true` に対するドキュメントレベルのチップ + ページレベル（二段組）の変更；真の before/after トグル；チップの accept/reject；バッチ継続ボタン |
| `word-autobatch-e2e`（5） | ⚡自動継続がクリックなしで承認後に「下一批」（次のバッチ）を送信する；プランがバッチ宣言をやめたら停止する |
| `excel-agent-mock`（14） | git スタイルの diff；`__univerGet` フック経由の実グリッド値：reject で 120 が復元される、ビュートグルで却下済み編集が復活しない、accept-all でそれらが再着地する |
| `richdoc-toolbar`（21） | リボンコマンドが実際にドキュメントを変更する；アイコンの重複排除；即時ツールチップ |
| `ui-smoke`（7） | アプリが起動する、グリッドが描画される、選択チップ、drawio のドロップ、コンソールエラーがゼロ |

規約：**存在ではなく効果**をアサートする（開いたカードはクリックしたときに実際に*動作*しなければならない — 存在のみのアサーションが、かつて死んだ accept ボタンを覆い隠したことがある）；可能な限りクラス名ではなく実状態（computed styles、テストフック経由のグリッド値）を読む。

## 能力ベンチ（`test/expert-bench.mjs`、キーゲート付き）

実モデルを 8 タスク（Word の推敲/構造/公文（中国の公的文書）/曖昧タスク、Excel の数式/異常検知/チャート/曖昧タスク）で実行し、2 レイヤーで採点する：

1. **客観的不変条件** — レスポンス種別（changeset か clarify か）、必須ツール呼び出し（`read_blocks`、`aggregate`、`load_skill`…）、必須の op 形状（`=SUM`、`chart`）。
2. **LLM judge** — タスクごとに 1〜5 のルーブリックスコア。

結果はトレンド追跡のため `test/bench-results.jsonl` に追記される。`OTTERPATCH_BENCH_KEY` がない場合は SKIP を出力して exit 0 で終了する（CI セーフ）。

```bash
OTTERPATCH_BENCH_KEY=sk-ant-... node test/expert-bench.mjs
BENCH_ONLY=w-gongwen OTTERPATCH_BENCH_KEY=... node test/expert-bench.mjs   # single task
```

## 受け入れテレメトリ（本番シグナル）

デスクトップはアイテム単位のすべての accept/reject を、フォーマット × 変更タイプ別にカウントする（`localStorage['oa.telemetry']`、コンソール：`__otterTelemetry()`）。あるカテゴリで受け入れ率が低下することは、オフラインテストでは得られないリグレッションシグナルである — それを playbook とプロンプトにフィードバックすること。
