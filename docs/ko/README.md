# OtterPatch 문서

기여자와 통합자를 위한 문서입니다. 아키텍처부터 시작한 후, 작업하려는 레이어로 깊이 들어가세요.

| 문서 | 다루는 내용 |
|---|---|
| [architecture.md](./architecture.md) | propose → diff → review → commit 파이프라인, 패키지 맵, 핵심 불변식 |
| [agent.md](./agent.md) | 에이전트 루프: 라우팅, 읽기 도구, 섀도 검증 및 복구, 자체 점검, 프롬프트 캐싱, 배칭 |
| [skills.md](./skills.md) | 스킬 시스템: 능력 카드(capability cards) 대 플레이북, 점진적 공개(`load_skill`), 외부 SKILL.md 설치 |
| [review-ux.md](./review-ux.md) | 리뷰 경험: Word 인라인 변경 내용 추적(수락 시 병합, flatten-on-accept), 문서 수준 칩(chips), Excel 이전 상태 리플레이 |
| [testing.md](./testing.md) | 테스트 피라미드: 패키지 단위 테스트, 헤드리스 e2e 하니스, 능력 벤치마크, 수락 텔레메트리 |

## 한 문단 소개

에이전트는 파일을 직접 편집해서는 안 됩니다. OtterPatch에서 에이전트는 구조화된
`ChangeSet`을 **제안**하기만 합니다. 시스템은 이를 섀도 사본에 대해 검증하고(모델이 자신의
실수를 스스로 복구하도록 만들며), **검토 가능한 diff**를 보여줍니다 — 워크스페이스에서는
인라인 변경 내용 추적으로, 레일(rail)에서는 git 스타일 diff로 — 그리고 항목별 사람 승인
이후에만 **외과적으로(surgically)** 파일에 기록합니다: 파일에서 손댄 부분만 변경되고,
나머지는 모두 바이트 단위로 동일하게 유지됩니다.

## 핵심 불변식 (절대 깨뜨리지 마세요)

1. **단일 변경 출구(Single mutation exit)** — 모든 문서 변경은 `propose_changeset`을 통과합니다. 다른 어떤 도구도 문서를 변경하지 않습니다.
2. **커밋 전 리뷰(Review before commit)** — 항목별 사람의 수락/거부 없이는 아무것도 파일에 반영되지 않습니다.
3. **외과적 쓰기 반영(Surgical write-back)** — 손대지 않은 부분은 바이트 단위로 동일하게 유지되며, 충실도(fidelity)는 측정되어 보고됩니다.
4. **직렬 쓰기(Serial writes)** — 제안은 현재 문서 상태에 앵커링되며, 배치는 직렬로 계속 진행됩니다(병렬 기록자는 절대 없음). 따라서 진행 도중 앵커가 무효화될 수 없습니다.
