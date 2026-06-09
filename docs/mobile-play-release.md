# AIsle Android — Play Console 내부 테스트 릴리스

`com.aisleshub.app` Capacitor 앱을 Google Play **내부 테스트** 트랙에 올리는 절차입니다. Play Console 경험이 있으면 기존 게임과 동일한 흐름입니다.

## 버전

| 항목 | 위치 | 현재 값 |
|------|------|---------|
| `versionName` | `mobile/android/app/build.gradle` | `1.0.0` |
| `versionCode` | 동일 | `1` (매 업로드마다 +1) |

## 1. 업로드 키 (로컬만, 커밋 금지)

Play **App Signing** 사용을 권장합니다. Google이 앱 서명 키를 보관하고, 개발자는 **업로드 키**로 AAB만 서명합니다.

```powershell
cd mobile\android
keytool -genkey -v -keystore upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

`keystore.properties.example`을 복사해 `keystore.properties`를 만들고 값을 채웁니다.

```properties
storeFile=upload-keystore.jks
storePassword=...
keyAlias=upload
keyPassword=...
```

- `upload-keystore.jks`, `keystore.properties` — **`.gitignore`에 포함됨**
- 키 분실 시 Play Console → 앱 서명에서 업로드 키 재설정 (게임과 동일)

## 2. Release AAB 빌드 (Windows)

`keystore.properties`가 있으면 `build.gradle`이 release 서명을 자동 적용합니다.

```powershell
cd c:\dev\AIsle\mobile\android
.\gradlew.bat bundleRelease
```

산출물:

```
mobile\android\app\build\outputs\bundle\release\app-release.aab
```

서명 설정 없이 빌드만 확인하려면 Android Studio → **Build → Generate Signed Bundle / APK** → **Android App Bundle**도 사용할 수 있습니다.

## 3. Play Console — 내부 테스트

1. [Play Console](https://play.google.com/console) → **앱 만들기** (또는 기존 앱)
2. **앱 ID**: `com.aisleshub.app` (패키지명과 일치)
3. **테스트 → 내부 테스트** → 새 릴리스
4. `app-release.aab` 업로드
5. 릴리스 노트 작성 → 검토 → **내부 테스트 시작**
6. **테스터** 탭에서 이메일 목록 또는 링크로 설치

첫 업로드 시 스토어 등록 정보(앱 이름, 아이콘, 스크린샷, 개인정보 처리방침 URL 등)를 채워야 할 수 있습니다. Capacitor 앱은 WebView이므로 **개인정보 처리방침**에 `https://www.aisleshub.com` 및 OAuth(Google) 사용을 명시하세요.

## 4. 기기에서 확인 체크리스트

- [ ] 앱 아이콘·스플래시가 AIsle 브랜드로 표시되는지
- [ ] `https://www.aisleshub.com` WebView 로드
- [ ] Google 로그인: 시스템 브라우저 → `com.aisleshub.app://auth/callback` 복귀
- [ ] Supabase Redirect URLs에 `com.aisleshub.app://auth/callback` 등록됨

OAuth 상세는 [mobile-capacitor.md](./mobile-capacitor.md) 참고.

## 5. 아이콘·스플래시 교체

소스는 `public/watermark.png`입니다. 고해상도 전용 아이콘(1024×1024)이 있으면 `mobile/assets/icon.png`에 넣고:

```powershell
cd c:\dev\AIsle\mobile
npm run assets:generate
npm run sync
```

## 다음 단계 (이 문서 범위 밖)

- AdMob 연동
- 프로덕션 트랙 승격
- 푸시 알림, 상태바 스타일
