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
| `fortune_subscribe_cta_click` | AI FORTUNE 상세 구독 CTA 버튼 클릭 | `post_id` |
| `fortune_digest_cta_view` | AI FORTUNE 상세 구독 CTA 노출 (1회) | `post_id` |
| `retention_welcome_shown` | 로그인 후 환영 토스트 표시 | `reason` (`bookmarks` \| `subscribe`) |
| `home_fortune_card_click` | 메인·LOUNGE 「이번 주 AI FORTUNE」 카드 클릭 | `post_id`, `week_key` |
| `launch_banner_impression` | 메인 LAUNCH 배너 슬라이더 최초 노출 | `slot_count` |
| `launch_banner_click` | LAUNCH 배너 슬라이드 클릭 | `post_id`, `slide_index` |
| `build_hub_cta_upload` | BUILD 허브 「레시피 등록하기」 CTA | — |
| `build_popular_click` | BUILD 허브 인기 레시피 행 클릭 | `post_id`, `rank` |
| `feed_post_click` | 피드·목록에서 게시글 링크 클릭 | `post_id`, `category`, `surface` |
| `site_search` | `/search` 결과 페이지 로드 (검색 실행 후) | `search_term`, `results_count` |
| `corridor_tab_select` | 홈 복도 탭·헤더 네비 클릭 | `category` (`ALL`, `LOUNGE`, `LAB`, …) |
| `share_click` | 상세·게임 공유 버튼 클릭 | `post_id`, `method` (`web_share` \| `clipboard`), `game_slug` (게임) |
| `hero_analysis_cta_click` | 메인 Hero 역분석 CTA | `destination` (`gallery` \| `upload_login`) |
| `gallery_reverse_login_click` | 갤러리 역분석 로그인 게이트 | `post_id` |
| `gallery_reverse_view` | 갤러리 역분석 UI 노출 (1회) | `post_id`, `from_cache` |
| `tags_hub_gallery_click` | `/tags` 갤러리 배너 클릭 | — |

### `feed_post_click` surface 값

| surface | 위치 |
|---------|------|
| `home_all_feed` | 홈 전체 피드 (카드 그리드, `category` 없음) |
| `home_lounge_feed` 등 | 홈 복도별 피드 (`home_{category소문자}_feed`) |
| `quasar_main` | 퀘이사 메인 LAB·GALLERY 카드 |
| `quasar_sidebar` | 퀘이사 LOUNGE·GOSSIP 사이드 리스트 |
| `todays_best` | 오늘의 베스트 위젯 |
| `search_result` | 검색 결과 목록 |
| `lounge_gallery_bridge` | LOUNGE 상세 → GALLERY 역분석 브릿지 |
| `composite_section` | 홈 composite AI Work·커뮤니티 섹션 |

### 상세 페이지 `content_group`

`/post/[id]` 진입 시 `gtag('config', …)`로 `content_group`·`post_category`를 게시글 `category`로 설정한다. 별도 커스텀 이벤트는 없다.

## 뉴스레터(다이제스트 메일) UTM

LOUNGE 다이제스트(Resend) 본문 링크는 URL 쿼리로 GA4에 유입을 구분한다. 클라이언트 `sendGAEvent`는 사용하지 않는다.

| 파라미터 | 값 |
|----------|-----|
| `utm_source` | `newsletter` |
| `utm_medium` | `email` |
| `utm_campaign` | `digest_am` (KST 06시 슬롯) · `digest_pm` (18시 슬롯) |
| `utm_content` | (선택) `cta_top`, `cta_lounge`, `banner_home`, `manage_subscription`, **`fortune_week`** (AI FORTUNE 섹션) 등 |

### `digest_email_fortune_click`

메일 클라이언트에서 `utm_content=fortune_week` 링크 클릭 시 GA4 보고서에서 유입·캠페인으로 집계된다. 별도 서버 이벤트는 없다(선택 사항 N/A).

## 구현 위치

- `AiFortunePromoBanner.tsx` — `fortune_banner_click`
- `PostScrollSubscribeModal.tsx` — `digest_modal_*`
- `FortuneDigestSubscribeCta.tsx` — `fortune_subscribe_cta_click`, `fortune_digest_cta_view`
- `RetentionWelcomeToast.tsx` — `retention_welcome_shown`
- `HomeFortuneCard.tsx` — `home_fortune_card_click`
- `LaunchFeedSlider.tsx` — `launch_banner_impression`, `launch_banner_click`
- `BuildHubSection.tsx` — `build_hub_cta_upload`, `build_popular_click`
- `PostBookmarkContext.tsx` / `GuestBookmarkSnackbar.tsx` — `guest_bookmark_*`
- `PostRelatedPosts.tsx` — `related_post_click`
- `FeedPostLink.tsx` — `feed_post_click` (공용 링크 래퍼)
- `HomeAllFeed.tsx`, `TodaysBest.tsx`, `HomeQuasarBoard.tsx`, `HomeQuasarAsideLists.tsx`, `HomeCompositeSection.tsx` — `feed_post_click`
- `SearchPageClient.tsx` / `search/page.tsx` — `site_search`, 검색 결과 `feed_post_click`
- `HomeContentTabs.tsx`, `MainNav.tsx` — `corridor_tab_select`
- `PostEngagement.tsx` — `share_click`
- `HomeMainHero.tsx` — `hero_analysis_cta_click`
- `MemberAiExtrasLoginGate.tsx` — `gallery_reverse_login_click`
- `GalleryReverseViewTracker.tsx` — `gallery_reverse_view`
- `TagsHubGalleryBanner.tsx` — `tags_hub_gallery_click`
- `PostContentGroupAnalytics.tsx` — 상세 `content_group` / `post_category`
- `src/app/api/cron/news-digest/route.ts` — 메일 UTM (`fortune_week` 포함)
