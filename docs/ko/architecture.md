# 아키텍처

OtterPatch는 LLM 에이전트와 Office 문서 사이에 위치하는 **안전 커밋 계층(safe-commit layer)**입니다. `.xlsx` / `.docx` / `.drawio` 파일에 대해 풀 리퀘스트(pull request)를 여는 것이라고 생각하면 됩니다.

## 파이프라인

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

## 패키지 맵

| 패키지 | 역할 |
|---|---|
| `packages/core` | 포맷 비의존 타입: `Anchor`, `ChangeSet`, `EditOp`, `AbstractStyle`, 어댑터 레지스트리, 쓰기 되돌림(writeback) 계약 |
| `packages/agent` | 의도(intent) → 제약된 `ChangeSet`. 프로바이더 비의존 `ModelClient`(Claude 네이티브 + OpenAI 호환 ×8). 멀티 스텝 루프, 읽기 도구, 검증기(verifier)가 여기에 위치 |
| `packages/skills` | 스킬 허브: SKILL.md 파싱, 매칭, 점진적 공개(progressive disclosure), 내장 기능 카드(capability cards) + 도메인 플레이북 |
| `packages/runtime` | 헤드리스 오케스트레이터: `propose → diff → commit` + JSON 이벤트 스트림. 검증기 레지스트리 + 최종 자체 점검(self-check) 래퍼. MCP 서버, CLI, 데스크톱이 공유 |
| `packages/adapter-*` | 포맷별 컴파일/쓰기 되돌림: `univer`(Excel), `word`(변경 추적 redline `w:ins`/`w:del` + `rPrChange`/`pPrChange`), `drawio`, `pdf`(AcroForm), `pptx` |
| `packages/writeback-surgical` | OOXML 외과적(surgical) 쓰기 되돌림 엔진(검증됨: 실제 531 KB docx에서 30/31개 파트가 바이트 단위로 동일) |
| `apps/desktop` | 콕핏 UI(Vite + React + Electron): 워크스페이스(Univer 시트, 리치 텍스트 Word, drawio 보드), 리뷰 레일, BYOK 모델 패널 |
| `apps/mcp-server` | MCP 서버(stdio) + 헤드리스 CLI + 콕핏을 위한 `otterpatch-serve` 로컬 HTTP 브리지 |

## 데이터 흐름 상세

- **컨텍스트는 파일 자체가 아니라 투영(projection)이다.** 각 워크스페이스는 모델을 위한 읽기 전용
  컨텍스트를 조립합니다: Excel은 시트 개요 + 전체 그리드 스냅샷(프롬프트가 아니라 읽기 도구용)을
  보내고, Word는 문단별 스타일 요약 + 스타일 시스템 다이제스트에 더해 읽기 도구를 위한 전체 문서
  블록 스냅샷(`ProposeRequest.doc`)을 보냅니다. 보류 중인 변경 추적(tracked changes)은 *클린
  투영(clean projection)*을 통해 제외됩니다(모델은 항상 "수락된 상태 기준(as-accepted)" 텍스트만
  봅니다 — 컨텍스트 오염 없음).
- **앵커는 위치 기반이 아니라 논리 기반이다.** Word 편집은 `quote`(실재하며 유일함이 검증됨)에,
  Excel은 A1 참조에, drawio는 셀 id에 앵커됩니다. 문서 검증기 / 그리드 검증기 / 토폴로지 검증기는
  안착할 수 없는 앵커를 거부하고, 모델은 해당 턴 안에서 이를 수리(repair)합니다.
- **데스크톱은 제안을 낙관적으로(optimistically) 적용**하여 리뷰 가능한 마크(변경 추적 / 변경 전
  상태가 캡처된 그리드 값)로 표시하므로, 리뷰가 문서 안에서 그대로 이루어집니다. 거부(reject)하면
  캡처된 변경 전 상태를 재생(replay)하고, 수락(accept)하면 물리적으로 확정합니다.
- **서버 측 커밋은 독립적이다**: ChangeSet 중 수락된 부분집합이 외과적 쓰기 되돌림을 통해 업로드된
  원본 파일에 적용됩니다 — 앱 내 미리보기는 당신의 파일을 절대 건드리지 않습니다.
