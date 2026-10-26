# READ_ONLY_ACCOUNT 저장형 자격증명 (I-038 ~ I-044)

결정 (2026-10-26, JD): 고객이 제공한 심사용 계정(ID/비밀번호)을 암호화 저장하고 Jury가 로그인해 읽기 관찰만 수행한다.
계정 권한 수준은 제한하지 않는다(읽기 전용 계정은 권장 사항). Jury 측 읽기 전용 강제(GET 계열만 허용, 도메인 허용 목록,
폼 제출 차단)는 그대로 유지한다. 권한이 높은 계정일수록 유출·의도치 않은 변경 시 영향이 커지므로 보관 기간 단축과
심사 직후 파기를 기본값으로 둔다.

## 단계
| ID | 단계 | 범위 |
|---|---|---|
| I-038 | 설계 확정 (1단계, 문서) | 본 문서. 법무 검토·KMS 선택은 열린 항목 |
| I-039 | 모델·암호화 (1단계) | Prisma 모델/마이그레이션 파일(미실행), 키 공급자 교체형 봉투 암호화 모듈(테스트 키 공급자) |
| I-040 | 동의·입력 게이트 (1단계) | 동의 문구 v1, 동의 기록·자격증명 저장 계획/영속 함수, 서버 액션(기능 플래그 off), 동의 전 입력 잠금 UI |
| I-041 | 실행기 PoC | Sandbox + headless 브라우저, 요청 가로채기 정책, 내부 테스트 사이트 한정 |
| I-042 | 증거·심사 연동 | `readonly-account` 공급자 등록, JuryEvidence 매핑 |
| I-043 | 보관·파기 | 만료 배치, 수동 삭제, 감사 이벤트 |
| I-044 | 제한 공개 | 기능 플래그로 내부 tenant부터 |

## 별도 승인 필요
- 실제 KMS(키 공급자) 선택과 환경 구성 — 1단계는 테스트 키 공급자만 포함하며 운영 키 공급자는 없다.
- 마이그레이션 `20261026110000_jury_readonly_account_credentials` 운영 적용 — 1단계에서는 파일만 작성, 실행 금지.
- 법무: 동의 문구·고객 서비스 약관(자동 접근) 검토.

설계 원문: Grok Bot Page「READ_ONLY_ACCOUNT 실연결 설계안」.

## 진행 현황 (2026-10-26)
| ID | 상태 | 구현 |
|---|---|---|
| I-039 | 완료 (마이그레이션 미적용) | `credential-crypto.ts`, 마이그레이션 `20261026110000_*` |
| I-040 | 완료 (I-044에서 on) | `consent.ts`, `store.ts`, 서버 액션, 입력 폼. 서비스 상세 화면 연결은 `READONLY_ACCOUNT_UI_ENABLED` 뒤 |
| I-041 | 완료 (I-044에서 on) | `executor.ts` 가드 + `browser-driver.ts`(Playwright 호환 구조 타입, `context.route('**/*')`로 하위 요청 포함 검사, WebSocket·EventSource·ping·sendBeacon·서비스워커 차단, 로그인 후 폼 제출 차단, 클릭 1회 제한) |
| I-042 | 완료 (I-044에서 연결) | `key-provider.ts`(env 이름 `JURY_ACCOUNT_CREDENTIAL_KEK`/`_KEK_ID`만 참조, 없으면 NOT_CONFIGURED), `observation-evidence.ts`(복호화→관찰→건수·노출 여부 요약→EvidencePack docsHints 첨부, 본문·쿼리·계정 미포함) |
| I-043 | 완료 (스위치 on, vercel.json cron 매일 18:00 UTC = 03:00 KST) | `retention.ts`, `retention-route.ts`, `/api/cron/readonly-account-purge`(CRON_SECRET), 만료·수동 파기 감사 이벤트 |
| I-044 | 완료 (2026-10-26, 전체 tenant 플래그 on) | 4개 플래그 on, `METHOD_METADATA.READ_ONLY_ACCOUNT.implemented=true`, 자격증명 저장 액션이 env KEK 제공자(`resolveEnvKeyProvider`)로 암호화, KEK 미설정 시 `KEY_NOT_CONFIGURED`. `observation-run.ts`(권한·동의 범위·KEK·자격증명 확인 후 1회 관찰, 건수만 감사) + `browser-runtime.ts`(playwright-core + @sparticuz/chromium 지연 import, serviceWorkers block, 다운로드 off). 서비스 상세 화면에 관찰 실행 폼, 페이지 `maxDuration=60`, chromium bin은 `outputFileTracingIncludes`로 해당 라우트에만 포함 |

### 브라우저 런타임 선택
저장소에는 원래 브라우저 자동화 의존성이 없었다.
`playwright-core@1.59.1`(Chromium 147 기준) + `@sparticuz/chromium@147.0.0`을 정확한 버전으로 고정해 추가했다(CI Node 20.19.2와 호환되는 마지막 계열, 148 이상은 Node 22 필요). 두 패키지는 `next.config.ts` `serverExternalPackages`로 번들에서 제외한다. 실제 import·실행은 플래그 활성화 단계에서 연결한다.
런처는 `serviceWorkers: 'block'`, `acceptDownloads: false`로 컨텍스트를 생성해야 한다.
