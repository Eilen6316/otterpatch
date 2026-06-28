# OtterPatch

[English](./README.md) · [中文](./README.zh.md) · **日本語** · [Français](./README.fr.md) · [한국어](./README.ko.md)

> 🦦 **O**ffice **T**ransforms · **T**racked · **E**dited & **R**eviewed · surgical **Patch** — エージェント駆動でレビュー可能な、ドキュメントのための**セーフコミット層**。
> 範囲を選択 → やりたいことを伝える → 差分をレビュー → 高忠実度で書き戻し。
> （イメージ:あなたの `.xlsx` / `.docx` / `.drawio` に対して PR を出す感覚です。）

> ⚠️ 初期段階のscaffold — 鋭意開発中。

## なぜ

エージェントがファイルを直接編集すべきではありません。OtterPatch ではエージェントは構造化された
`ChangeSet` を**提案するだけ**です。システムがそれを検証し、シャドウコピーに適用し、
**レビュー可能な差分**(ブロックごとに承認/却下)を表示してから、**外科的に**書き戻します
— 変更された部分だけが変わり、残りはバイト単位で同一のままです。

実際の 531 KB の `.docx` で検証済み:外科的書き戻しは **31 パーツ中 30 をバイト同一**に保ちましたが、
モデルによる全文の往復では 31 中 11 が書き換えられました。`packages/writeback-surgical` を参照。

## 構成

```text
packages/core/                フォーマット非依存の抽象層
                              (Anchor / ChangeSet / Diff / Skill / Adapter / Registry / Transaction / Writeback)
packages/agent/               意図 → 制約付き ChangeSet;BYOK、8 プロバイダー
                              (Claude ネイティブ + OpenAI 互換:DeepSeek/GLM/Kimi/Doubao/MiniMax/Gemini/ChatGPT)
packages/adapter-univer/      Excel アダプター(Univer)— ChangeSet → シート XML コンパイラ
packages/adapter-drawio/      drawio アダプター — mxCell 操作エンジン + 図単位の外科的書き戻し
packages/writeback-surgical/  外科的 OOXML 書き戻し — 検証済み + テスト済み
apps/desktop/                 段階的開示のコックピット UI + BYOK モデル設定(Vite + React;後に Electron)
```

## 開発

```bash
npm install
npm run typecheck                  # packages/* 全体で tsc -b
npm run dev                        # コックピット UI → http://localhost:5173
npm test -w @otterpatch/core             # アダプターレジストリ
npm test -w @otterpatch/agent            # 意図 → ChangeSet(モックモデル + 8 プロバイダーファクトリ)
npm test -w @otterpatch/adapter-univer   # 意図 → ChangeSet → 外科的 .xlsx 書き戻し
npm test -w @otterpatch/adapter-drawio   # mxCell 操作 + 図をまたぐ外科的書き戻し
npm test -w @otterpatch/writeback-surgical
```

## ステータス

- [x] Monorepo の scaffold;core 抽象層 + アダプターレジストリ
- [x] 外科的 OOXML 書き戻し(検証済み + テスト済み)
- [x] エージェントのターン:自然言語の意図 → 制約付き `ChangeSet`(BYOK、8 プロバイダー)
- [x] drawio アダプター:mxCell 追加/削除/プロパティ設定/移動 + 図単位の外科的書き戻し
- [ ] Univer アダプターのライブループ:選択 → ChangeSet → シャドウ → 差分 → 書き戻し
- [ ] コックピット UI を実際のエージェント + 書き戻しバックエンドに接続

## ライセンス

[Apache-2.0](./LICENSE)。
