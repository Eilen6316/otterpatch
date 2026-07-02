# アーキテクチャ

OtterPatch は、LLM エージェントと Office ドキュメントの間に位置する**安全コミット層（safe-commit layer）**です。`.xlsx` / `.docx` / `.drawio` ファイルに対してプルリクエストを開くようなもの、と考えてください。

## パイプライン

```
 user intent + selection
        │
        ▼
┌─────────────────┐   dialect (per-format tool schema)
│  Agent (LLM)    │◄─ skills (capability cards + playbooks)
│  multi-step loop│◄─ read tools (sheet: read_range/aggregate · doc: read_blocks/find_text/…)
└───────┬─────────┘
        │ propose_changeset (the ONLY mutation exit)
        ▼
┌─────────────────┐
│ ChangeSet       │  format-agnostic: anchors (quote / A1 / cell-id) + edit ops
└───────┬─────────┘
        │ shadow verification (per-format verifier registry)
        │   fail → structured report fed back → model repairs (propose→observe→repair, ≤2 rounds)
        │   pass + large changeset → one final semantic self-check round
        ▼
┌─────────────────┐
│ Reviewable diff │  workspace: inline tracked changes / grid replay / board highlight
│                 │  rail: git-style unified diff, per-item accept/reject
└───────┬─────────┘
        │ accepted subset
        ▼
┌─────────────────┐
│ Surgical commit │  OOXML / XML patch — untouched parts byte-identical
│                 │  + fidelity report (touched parts, score)
└─────────────────┘
```

## パッケージ構成

| パッケージ | 役割 |
|---|---|
| `packages/core` | フォーマット非依存の型定義：`Anchor`、`ChangeSet`、`EditOp`、`AbstractStyle`、アダプタレジストリ、ライトバック契約 |
| `packages/agent` | インテント → 制約付き `ChangeSet`。プロバイダ非依存の `ModelClient`（Claude ネイティブ + OpenAI 互換 ×8）。マルチステップループ、読み取りツール、検証器（verifier）はここに存在する |
| `packages/skills` | スキルハブ：SKILL.md のパース、マッチング、プログレッシブ・ディスクロージャ、組み込みのケイパビリティカード + ドメインプレイブック |
| `packages/runtime` | ヘッドレスオーケストレータ：`propose → diff → commit` + JSON イベントストリーム。検証器レジストリ + 最終セルフチェックのラッパー。MCP サーバー、CLI、デスクトップで共有される |
| `packages/adapter-*` | フォーマットごとのコンパイル／ライトバック：`univer`（Excel）、`word`（変更履歴 `w:ins`/`w:del` + `rPrChange`/`pPrChange`）、`drawio`、`pdf`（AcroForm）、`pptx` |
| `packages/writeback-surgical` | OOXML 外科的（surgical）ライトバックエンジン（検証済み：実物の 531 KB docx で 30/31 パーツがバイト単位で同一） |
| `apps/desktop` | コックピット UI（Vite + React + Electron）：ワークスペース（Univer シート、リッチテキスト Word、drawio ボード）、レビューレール、BYOK モデルパネル |
| `apps/mcp-server` | MCP サーバー（stdio）+ ヘッドレス CLI + コックピット用のローカル HTTP ブリッジ `otterpatch-serve` |

## データフローの詳細

- **コンテキストはプロジェクションであり、ファイルそのものではない。** 各ワークスペースはモデル向けに読み取り専用のコンテキストを組み立てる：Excel はシート概要 + 全グリッドのスナップショット（読み取りツール用であり、プロンプト用ではない）を送る；Word は段落ごとのスタイル要約 + スタイルシステムのダイジェストに加えて、読み取りツール用に文書全体のブロックスナップショット（`ProposeRequest.doc`）を送る。未確定の変更履歴（tracked changes）は*クリーンプロジェクション*によって除外される（モデルは常に「承認済みとした場合」のテキストを見る — コンテキスト汚染なし）。
- **アンカーは論理的であり、位置ベースではない。** Word の編集は `quote`（実在かつ一意であることを検証済み）に、Excel は A1 参照に、drawio はセル id にアンカーする。doc 検証器／grid 検証器／トポロジー検証器は着地できないアンカーを拒否し、モデルはそのターン内で修復する。
- **デスクトップは提案を楽観的に適用する**：レビュー可能なマーク（変更履歴／変更前の状態をキャプチャしたグリッド値）として適用するため、レビューはその場（in-place）で行われる。却下はキャプチャした変更前の状態を再生し、承認は物理的に確定させる。
- **サーバー側のコミットは独立している**：ChangeSet のうち承認されたサブセットが、外科的ライトバックによってアップロードされた元ファイルに適用される — アプリ内プレビューがあなたのファイルに触れることは決してない。
