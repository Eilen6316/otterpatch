# OPAL

[English](./README.md) · [中文](./README.zh.md) · [日本語](./README.ja.md) · [Français](./README.fr.md) · **한국어**

> **O**ffice **P**atch & **A**gent **L**ayer — 에이전트 기반의 검토 가능한 문서용 **세이프 커밋 레이어**.
> 영역 선택 → 원하는 바를 말하기 → 차이 검토 → 고충실도 되쓰기.
> (이미지: 당신의 `.xlsx` / `.docx` / `.drawio`에 PR을 여는 느낌.)

> ⚠️ 초기 스캐폴드 — 활발히 개발 중.

## 왜

에이전트가 파일을 직접 수정해서는 안 됩니다. OPAL에서 에이전트는 구조화된
`ChangeSet`을 **제안**만 합니다. 시스템이 이를 검증하고 섀도 복사본에 적용한 뒤,
**검토 가능한 차이**(블록별 수락/거부)를 보여주고, 그다음 **외과적으로** 되씁니다
— 손댄 부분만 바뀌고 나머지는 바이트 단위로 동일하게 유지됩니다.

실제 531 KB `.docx`에서 검증: 외과적 되쓰기는 **31개 파트 중 30개를 바이트 동일**하게 유지한 반면,
모델 왕복은 31개 중 11개를 다시 썼습니다. `packages/writeback-surgical` 참조.

## 구조

```text
packages/core/                포맷 비종속 추상화 레이어
                              (Anchor / ChangeSet / Diff / Skill / Adapter / Registry / Transaction / Writeback)
packages/agent/               의도 → 제약된 ChangeSet; BYOK, 8개 공급자
                              (Claude 네이티브 + OpenAI 호환: DeepSeek/GLM/Kimi/Doubao/MiniMax/Gemini/ChatGPT)
packages/adapter-univer/      Excel 어댑터(Univer) — ChangeSet → 시트 XML 컴파일러
packages/adapter-drawio/      drawio 어댑터 — mxCell 연산 엔진 + 다이어그램 단위 외과적 되쓰기
packages/writeback-surgical/  외과적 OOXML 되쓰기 — 검증 + 테스트 완료
apps/desktop/                 점진적 공개 코크핏 UI + BYOK 모델 설정(Vite + React; 이후 Electron)
```

## 개발

```bash
npm install
npm run typecheck                  # packages/* 전체에 tsc -b
npm run dev                        # 코크핏 UI → http://localhost:5173
npm test -w @opal/core             # 어댑터 레지스트리
npm test -w @opal/agent            # 의도 → ChangeSet(목 모델 + 8개 공급자 팩토리)
npm test -w @opal/adapter-univer   # 의도 → ChangeSet → 외과적 .xlsx 되쓰기
npm test -w @opal/adapter-drawio   # mxCell 연산 + 다이어그램 간 외과적 되쓰기
npm test -w @opal/writeback-surgical
```

## 상태

- [x] 모노레포 스캐폴드; core 추상화 레이어 + 어댑터 레지스트리
- [x] 외과적 OOXML 되쓰기(검증 + 테스트 완료)
- [x] 에이전트 턴: 자연어 의도 → 제약된 `ChangeSet`(BYOK, 8개 공급자)
- [x] drawio 어댑터: mxCell 추가/삭제/속성설정/이동 + 다이어그램 단위 외과적 되쓰기
- [ ] Univer 어댑터 라이브 루프: 선택 → ChangeSet → 섀도 → 차이 → 되쓰기
- [ ] 코크핏 UI를 실제 에이전트 + 되쓰기 백엔드에 연결

## 라이선스

[Apache-2.0](./LICENSE).
