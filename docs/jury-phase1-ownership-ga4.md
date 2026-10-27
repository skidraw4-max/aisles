# Jury Phase 1 — 사이트 소유 확인(I-072~074) · GA4 보기 권한 초대(I-075~078)

모든 기능은 환경변수가 없으면 꺼져 있어요(기본 off). 이 PR은 Vercel/GCP 설정을 바꾸지 않아요.

## 소유 확인
- 방법: DNS TXT(`_jury-verify.<host>` = `jury-verify=<token>`), 첫 페이지 `<meta name="jury-site-verification" content="<token>">`, `https://<host>/.well-known/jury-verification.txt`.
- 토큰 원문은 발급 화면에서 한 번만 보여 주고, DB에는 HMAC-SHA256(pepper) 해시와 끝 4자리만 저장해요.
- 발급 후 14일 안에 확인하지 않으면 FAILED. 확인 후 7일마다 재확인, 연속 3회 실패 시 EXPIRED(실패 시 1일 후 재시도).
- 재확인은 기존 `/api/cron/readonly-account-purge` 실행에 함께 붙어요(소유 확인 플래그가 켜졌을 때만).
- 외부 요청: https/443만, 공개 IP만(IP 고정 조회), 리다이렉트 3회(같은 호스트·www만), 5초, 256KB.
- 동의: `ownership-verification-v1` (`src/lib/jury-product/services/ownership/consent-text.ts`), 동의 버전·시각은 검증 행에 저장.

## 게이트
- `JURY_OWNERSHIP_ENFORCE_FROM` 이후 **새로 만든** 연결만 소유 확인이 필요해요.
- 그 전에 만든 기존 연결(예: ATOMY)은 기한 없이 영구 면제예요. `GA4_VIEWER` 연결은 게이트 대상이 아니에요.
- 적용 위치: 읽기 전용 계정 관찰 실행, 화면 심사 실행.

## GA4 보기 권한 초대
- 고객이 Jury 서비스 계정을 GA4 속성에 "뷰어"로 초대하고 속성 ID를 입력하면, Data API(runReport, analytics.readonly)로 권한을 확인한 뒤 연결해요.
- 인증: WIF 변수가 모두 있으면 Vercel OIDC → STS → 서비스 계정 가장(키 없음). 없으면 JSON 키(base64). 둘 다 없으면 꺼져요.
- 동의: `ga4-viewer-consent-v1` (`JuryConnectionConsent`에 저장).

## 환경변수 (Production · Preview)
| 이름 | 비밀 | 비고 |
| --- | --- | --- |
| JURY_OWNERSHIP_UI_ENABLED | 아님 | `true`/`1` |
| JURY_OWNERSHIP_TOKEN_PEPPER | 비밀 | 32자 이상 랜덤 |
| JURY_OWNERSHIP_ENFORCE_FROM | 아님 | ISO 시각, 비우면 게이트 없음 |
| JURY_GA4_VIEWER_ENABLED | 아님 | `true`/`1` |
| JURY_GA4_SA_EMAIL | 아님 | 서비스 계정 이메일 |
| JURY_GA4_WIF_PROJECT_NUMBER / _POOL_ID / _PROVIDER_ID | 아님 | WIF 사용 시 |
| JURY_GA4_SA_KEY_JSON_BASE64 | 비밀 | WIF 대신 쓸 때만 |
