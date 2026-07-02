# 테스트

세 계층으로 구성됩니다: 패키지 단위 테스트(빠르며 항상 실행), 빌드된 콕핏(cockpit)에 대한 헤드리스 e2e(모델 모킹), 그리고 키가 있어야 실행되는 능력 벤치(실제 모델, 점수화).

## 패키지 단위 테스트 (`npm test -w @otterpatch/<pkg>`)

| 패키지 | 커버 범위 |
|---|---|
| `agent` | 다이얼렉트(dialect) 구성, 프로바이더 팩토리, 메시지 정규화, 복구(repair) 루프, JSON 샐비지(salvage), **doc tools** (read_blocks/find_text/outline/style-usage), **word verifier** (인용문 착지 가능성 검증), **drawio verifier** (매달린 엣지 / 유령 id) |
| `skills` | SKILL.md 파싱, 매칭 및 랭킹(playbook 동점 처리 포함), render/L0, `instructionsFor`, playbook 콘텐츠 |
| `runtime` | 이벤트 스트림, verifier 레지스트리 연결, **최종 자체 점검(final self-check)** 프로토콜(대형 changeset 리뷰 라운드) |
| `adapter-*`, `writeback-surgical` | 컴파일 + 정밀(surgical) 라이트백 충실도 |

러너: `node --import tsx --test` (각 package.json 참조). 주의: package.json 파일은 반드시 **BOM 없이** 유지해야 합니다 — tsx의 JSON 리더는 UTF-8 BOM을 거부합니다.

## 헤드리스 e2e (`node test/<name>.mjs`)

`test/harness.mjs`는 `apps/desktop/dist`를 정적으로 서빙하고 헤드리스 Chromium(Playwright)을 구동합니다; `/propose-stream`은 고정 SSE로 가로채집니다 — 모델도, 키도 필요 없습니다. **먼저 빌드하세요**
(`npm run build -w @otterpatch/desktop`).

| 스위트 | 검증 항목 |
|---|---|
| `word-agent-mock` (23) | 컨텍스트에 문단별 서식 + 선택 영역 포함; 느슨한 매칭(loose-match) 착지; 인라인 마크; 4상태 토글; 전체 수락(accept-all) 시 모든 마크가 물리적으로 제거됨 |
| `word-review-e2e` (10) | 호버 카드 수락 시 하나의 변경이 평탄화(flatten)됨; 어떤 뷰 상태에서도 텍스트가 사라지지 않음; 두 번째 턴 컨텍스트에서 삭제된 텍스트 제외; 리뷰 도중 새로고침해도 승인 동작 유지 |
| `word-docfmt-e2e` (10) | `all=true`에 대한 문서 수준 칩 + 페이지 수준(2단 조판) 변경; 진짜 before/after 토글; 칩 수락/거절; 배치 계속(batch-continue) 버튼 |
| `word-autobatch-e2e` (5) | ⚡자동 계속(auto-continue)이 수락 후 클릭 없이 "下一批"(다음 배치)를 전송; 계획이 배치 선언을 멈추면 중단 |
| `excel-agent-mock` (14) | git 스타일 diff; `__univerGet` 훅을 통한 실제 그리드 값 검증: 거절 시 120 복원, 뷰 토글이 거절된 편집을 되살리지 않음, 전체 수락 시 다시 반영됨 |
| `richdoc-toolbar` (21) | 리본 명령이 실제로 문서를 변경함; 아이콘 중복 제거; 즉시 표시되는 툴팁 |
| `ui-smoke` (7) | 앱 부팅, 그리드 렌더링, 선택 칩, drawio 드롭, 콘솔 오류 0건 |

관례: **존재가 아니라 효과를 단언**할 것 (열리는 카드는 클릭했을 때 실제로 *동작*해야 함 —
존재 여부만 확인하는 단언이 한때 죽은 수락 버튼을 가렸던 사례가 있음); 가능하면 클래스 이름 대신 실제 상태(계산된 스타일, 테스트 훅을 통한 그리드 값)를 읽을 것.

## 능력 벤치 (`test/expert-bench.mjs`, 키 필요)

실제 모델로 8개 과제(Word 다듬기/구조/공문(公文, 중국 공식 행정문서)/모호한 요청, Excel 수식/이상치/차트/모호한 요청)를 실행하고 두 계층으로 점수를 매깁니다:

1. **객관적 불변식(invariants)** — 응답 종류(changeset 대 clarify), 필수 도구 호출
   (`read_blocks`, `aggregate`, `load_skill`…), 필수 op 형태(`=SUM`, `chart`).
2. **LLM 심판(judge)** — 과제별 1–5점 루브릭 점수.

결과는 추세 추적을 위해 `test/bench-results.jsonl`에 누적 기록됩니다. `OTTERPATCH_BENCH_KEY`가 없으면 SKIP을 출력하고 0으로 종료합니다(CI 안전).

```bash
OTTERPATCH_BENCH_KEY=sk-ant-... node test/expert-bench.mjs
BENCH_ONLY=w-gongwen OTTERPATCH_BENCH_KEY=... node test/expert-bench.mjs   # single task
```

## 수락 텔레메트리 (프로덕션 신호)

데스크톱 앱은 항목별 수락/거절을 포맷 × 변경 유형별로 집계합니다
(`localStorage['oa.telemetry']`, 콘솔: `__otterTelemetry()`). 특정 카테고리의 수락률 하락은 어떤 오프라인 테스트도 줄 수 없는 회귀 신호입니다 — 이를 playbook과 프롬프트에 다시 반영하세요.
