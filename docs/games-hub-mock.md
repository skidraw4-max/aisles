# Games hub — hosted play

상단 메인 네비·모바일 드로어에 **게임** (`/games`)으로 노출합니다.

| URL | 화면 |
| --- | --- |
| `/games` | 허브 (카드 2개 + 랭킹 스텁) |
| `/games/brickbreaking` | BrickBreaking 상세 |
| `/games/minibrick` | minibrick 상세 |
| `/games/brickbreaking/play` | 실제 게임 iframe |
| `/games/minibrick/play` | 실제 게임 iframe |
| `/games/brickbreaking/index.html` | 정적 BrickBreaking (Phaser) |
| `/games/minibrick/index.html` | 정적 minibrick |

소스: `c:\dev\Game\BrickBreaking\www`, `c:\dev\Game\minibrick\dist`.

조작: PC 마우스·키보드 / 모바일 터치. Sitemap·robots에서 `/games` 제외.

### Play 페이지 광고 (웹 only)

`/games/[slug]/play` 셸(iframe 밖)에 Kakao AdFit을 둡니다. Capacitor 네이티브는 숨김.

| 시점 | 크기 | 단위 ID | 위치 |
| --- | --- | --- | --- |
| 플레이 중 연속 | 320×50 | `DAN-cH8wBucZnkY8FAwq` (`NEXT_PUBLIC_KAKAO_ADFIT_GAME_STRIP_UNIT`) | iframe 아래 띠 (패들 비침범) |
| 일시정지 / soft overlay | 320×100 | `DAN-M1mJWELRJTphSTeL` (`NEXT_PUBLIC_KAKAO_ADFIT_GAME_BANNER_UNIT`) | 셸「일시정지 · 광고 보기」 |

슬롯 `border-radius: 0`. 스크립트는 루트 `KakaoAdFitLoader` 재사용.
