# AIsle Android — Play Console 내부 테스트 릴리스

`com.aisleshub.app` Capacitor 앱을 Google Play **내부 테스트** 트랙에 올리는 절차입니다. Play Console 경험이 있으면 기존 게임과 동일한 흐름입니다.

## 버전

| 항목 | 위치 | 현재 값 |
|------|------|---------|
| `versionName` | `mobile/android/app/build.gradle` | `1.0.0` |
| `versionCode` | 동일 | `1` (매 스토어 업로드마다 **반드시 +1**) |

첫 내부 테스트는 `1` / `1.0.0`으로 충분합니다. AAB를 다시 올릴 때마다 `versionCode`만 증가시키면 됩니다.

## 1. 업로드 키 (로컬만, 커밋 금지)

Play **App Signing** 사용을 권장합니다. Google이 앱 서명 키를 보관하고, 개발자는 **업로드 키**로 AAB만 서명합니다.

### 1-1. keytool로 업로드 키 생성 (대화형 — 비밀번호는 본인만 입력)

PowerShell에서 **한 번만** 실행합니다. 이름·조직 등 질문과 **keystore 비밀번호**, **key 비밀번호**는 터미널에 직접 입력합니다 (에이전트/CI가 대신 생성할 수 없음).

```powershell
cd c:\dev\AIsle\mobile\android
keytool -genkey -v -keystore upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

생성 파일: `mobile/android/upload-keystore.jks` (`.gitignore` 처리됨)

### 1-2. keystore.properties

```powershell
cd c:\dev\AIsle\mobile\android
copy keystore.properties.example keystore.properties
```

`keystore.properties` 예시 (실제 비밀번호로 교체):

```properties
storeFile=upload-keystore.jks
storePassword=YOUR_STORE_PASSWORD
keyAlias=upload
keyPassword=YOUR_KEY_PASSWORD
```

- `upload-keystore.jks`, `keystore.properties` → **Git에 커밋하지 마세요** (이미 `.gitignore`에 포함).
- 키 분실 시: Play Console → 앱 서명에서 업로드 키 재설정 (게임과 동일).

## 2. Release AAB 빌드 (Windows)

`keystore.properties`가 있으면 `app/build.gradle`이 release 서명을 자동 적용합니다 (`storeFile`은 `mobile/android` 기준).

### 권장: 스크립트

```powershell
cd c:\dev\AIsle
powershell -File mobile\scripts\build-release-aab.ps1
```

스크립트는 Android Studio **JBR**을 `JAVA_HOME`으로 설정한 뒤 `bundleRelease`를 실행합니다.

### 수동

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
cd c:\dev\AIsle\mobile\android
.\gradlew.bat bundleRelease
```

### 산출물

```
c:\dev\AIsle\mobile\android\app\build\outputs\bundle\release\app-release.aab
```

서명 설정 없이 빌드만 확인하려면 Android Studio → **Build → Generate Signed Bundle / APK** → **Android App Bundle**을 사용할 수 있습니다.

## 3. Play Console — 앱 생성 (최초 1회)

1. [Google Play Console](https://play.google.com/console) 로그인
2. **앱 만들기** (또는 기존 앱 선택)
3. **앱 세부정보**
   - 앱 이름: AIsle (또는 스토어 표시명)
   - 기본 언어, 앱/게임 유형, 유료/무료 등 설문 완료
4. **앱 ID(패키지명)** 는 첫 AAB 업로드 시 확정됩니다. 로컬 `applicationId`와 일치해야 합니다: **`com.aisleshub.app`**
5. **Play App Signing**: 첫 릴리스 업로드 시 Google 관리 서명 키 사용(권장)에 동의

## 4. 스토어 등록 필수 항목 (내부 테스트 전에도 대부분 필요)

내부 테스트만 올려도 Console이 아래를 요구하는 경우가 많습니다. 게임 출시 때와 동일하게 채웁니다.

| 항목 | 안내 |
|------|------|
| **개인정보 처리방침 URL** | Capacitor WebView + OAuth(Google) 사용. 예: `https://www.aisleshub.com` 의 정책 페이지 URL을 스토어에 등록 |
| **앱 액세스** | 로그인 필요 시 테스트 계정 또는 접근 방법 기재 |
| **광고** | AdMob(`play-services-ads`) 사용 → **예, 광고 포함** |
| **콘텐츠 등급** | 설문 완료 (IARC) |
| **대상층 및 콘텐츠** | 대상 연령 등 |
| **데이터 수집 및 보안 (Data safety)** | WebView·OAuth·**AdMob**에 맞게 선언. 광고 ID, 분석, 계정 정보 등 실제 수집·공유 여부를 정직하게 기재 |
| **스토어 등록정보** | 짧은/전체 설명, 그래픽(아이콘 512, 기능 그래픽, 스크린샷 등) |

AdMob 연동·정책 URL 상세는 추후 AdMob 문서와 함께 정리할 수 있습니다. 내부 테스트 전에는 Console 경고를 하나씩 해소하면 됩니다.

## 5. 내부 테스트 트랙 — AAB 업로드

1. Play Console → 해당 앱 → **테스트 및 출시** → **내부 테스트**
2. **새 릴리스 만들기** (또는 **출시 만들기**)
3. **App Bundle 업로드** → `app-release.aab` 선택
4. **출시 이름 / 출시 노트** 입력 (예: `1.0.0 (1) — 첫 내부 테스트`)
5. Console이 `versionCode` / 서명 / 정책 오류를 표시하면 수정 후 재업로드
6. **검토 후 출시** → **내부 테스트 시작** (내부 테스트는 보통 빠르게 반영)

### 테스터 추가

- **내부 테스트** → **테스터** 탭
- **이메일 목록** 생성 후 Google 계정 이메일 추가, 또는 **링크로 참여** 사용
- 테스터는 초대 수락 후 Play 스토어의 **테스트 참여** 링크 또는 앱 페이지에서 설치

## 6. 기기에서 확인 체크리스트

- [ ] 앱 아이콘·스플래시가 AIsle 브랜드로 표시되는지
- [ ] `https://www.aisleshub.com` WebView 로드
- [ ] Google 로그인: 시스템 브라우저 → `com.aisleshub.app://auth/callback` 복귀
- [ ] Supabase Redirect URLs에 `com.aisleshub.app://auth/callback` 등록됨

OAuth 상세는 [mobile-capacitor.md](./mobile-capacitor.md) 참고.

## 7. 아이콘·스플래시 교체

소스는 `public/watermark.png`입니다. 고해상도 전용 아이콘(1024×1024)이 있으면 `mobile/assets/icon.png`에 넣고:

```powershell
cd c:\dev\AIsle\mobile
npm run assets:generate
npm run sync
```

변경 후 AAB를 다시 빌드·업로드하고 `versionCode`를 올리세요.

## 다음 단계 (본 문서 범위 밖)

- AdMob 단위 ID·수익화 설정
- 프로덕션 / 오픈 / 클로즈드 테스트 트랙 승격
- 푸시 알림, 스토어 A/B 테스트