# GA4 커스텀 이벤트 (AIsle)

측정 ID는 `NEXT_PUBLIC_GA_MEASUREMENT_ID` (미설정 시 `G-BH4L4PYCJT`)입니다.  
클라이언트 이벤트는 `src/lib/ga4.ts`의 `sendGAEvent()`로 전송하며, gtag가 없으면 no-op입니다.

| 이벤트명 | 발생 시점 | 파라미터 |
|----------|-----------|----------|
| `fortune_banner_click` | AI FORTUNE 프로모 배너 CTA 클릭 | `post_id`, `category` |
| `digest_modal_view` | 스크롤 구독 모달 최초 표시 (세션당 1회) | `post_id` |
| `digest_modal_subscribe` | 모달에서 Google 구독 버튼 클릭 | `post_id` |
| `digest_modal_dismiss` | 모달 닫기 | `post_id` |
| `guest_bookmark_save` | 비로그인 북마크 localStorage 저장 | `post_id` |
| `guest_bookmark_login_click` | 북마크 스낵바 로그인 클릭 | `post_id` |
| `related_post_click` | 상세 하단 관련 글 카드 클릭 | `from_post_id`, `to_post_id` |

## 뉴스레터(다이제스트 메일) UTM

LOUNGE 다이제스트(Resend) 본문 링크는 URL 쿼리로 GA4에 유입을 구분한다. 클라이언트 `sendGAEvent`는 사용하지 않는다.

| 파라미터 | 값 |
|----------|-----|
| `utm_source` | `newsletter` |
| `utm_medium` | `email` |
| `utm_campaign` | `digest_am` (KST 06시 슬롯) · `digest_pm` (18시 슬롯) |
| `utm_content` | (선택) `cta_top`, `cta_lounge`, `banner_home`, `manage_subscription` 등 |

## 구현 위치

- `AiFortunePromoBanner.tsx` — `fortune_banner_click`
- `PostScrollSubscribeModal.tsx` — `digest_modal_*`
- `PostBookmarkContext.tsx` / `GuestBookmarkSnackbar.tsx` — `guest_bookmark_*`
- `PostRelatedPosts.tsx` — `related_post_click`
