'use client';

import { QRCodeSVG } from 'qrcode.react';
import { PLAY_STORE_URL } from '@/lib/mobile-app';
import carouselStyles from '@/app/(root)/page.module.css';
import styles from './AppLaunchBanner.module.css';

const QR_SIZE = 112;
const QR_SIZE_HERO = 72;

function AppLaunchBarContent({ qrSize }: { qrSize: number }) {
  return (
    <>
      <div className={styles.textCol}>
        <p className={styles.badge}>NEW · Android 앱 출시</p>
        <h2 className={styles.headline}>AIsle 앱으로 AI 트렌드를 더 편하게</h2>
        <p className={styles.body}>
          웹과 동일한 피드·복도·AI FORTUNE을 앱에서 바로 이용하세요.
        </p>
        <p className={styles.sub}>Google Play에서 AIsle 검색 또는 QR 코드로 설치</p>
        <a
          href={PLAY_STORE_URL}
          className={styles.cta}
          target="_blank"
          rel="noopener noreferrer"
        >
          Google Play에서 받기
        </a>
      </div>
      <div className={styles.qrCol}>
        <a
          href={PLAY_STORE_URL}
          className={styles.qrLink}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Google Play에서 AIsle 앱 설치 (새 탭)"
        >
          <QRCodeSVG value={PLAY_STORE_URL} size={qrSize} level="M" />
        </a>
        <p className={styles.qrCaption}>스마트폰으로 스캔</p>
      </div>
    </>
  );
}

/** 홈 히어로 캐러셀 첫 슬라이드 (Banner A) */
export function AppLaunchHeroSlide() {
  return (
    <div className={styles.heroSlideLayout} aria-label="Android 앱 출시 안내">
      <div className={styles.heroSlideMain}>
        <p
          className={`${carouselStyles.heroCarouselEyebrow} ${carouselStyles.heroCarouselEyebrowAppLaunch}`}
        >
          NEW · Android 앱 출시
        </p>
        <h1 className={`${carouselStyles.heroTitle} ${carouselStyles.heroTitleHome}`}>
          <span className={carouselStyles.heroTitleLine}>AIsle 앱으로</span>
          <span className={carouselStyles.heroTitleLine}>
            <span className={carouselStyles.heroTitleAccent}>AI 트렌드</span>
            <span className={carouselStyles.heroTitleRest}>를 더 편하게</span>
          </span>
        </h1>
        <p className={`${carouselStyles.heroLead} ${carouselStyles.heroLeadHome}`}>
          웹과 동일한 피드·복도·AI FORTUNE을 앱에서 바로 이용하세요. Google Play에서 AIsle 검색
          또는 QR 코드로 설치하세요.
        </p>
        <div
          className={`${carouselStyles.heroCtaRow} ${carouselStyles.heroCarouselCtaRow} ${carouselStyles.heroCarouselCtaRowStack}`}
          data-cta-count="1"
        >
          <a
            href={PLAY_STORE_URL}
            className={carouselStyles.heroCtaPrimary}
            target="_blank"
            rel="noopener noreferrer"
          >
            Google Play에서 받기
          </a>
          <span className={carouselStyles.heroCarouselCtaSpacer} aria-hidden="true" />
        </div>
      </div>
      <div className={styles.heroQrCol}>
        <a
          href={PLAY_STORE_URL}
          className={styles.heroQrLink}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Google Play에서 AIsle 앱 설치 (새 탭)"
        >
          <QRCodeSVG value={PLAY_STORE_URL} size={QR_SIZE_HERO} level="M" />
        </a>
        <p className={styles.heroQrCaption}>스캔</p>
      </div>
    </div>
  );
}

/** NoticeBar 등 좁은 영역용 앱 출시 배너 (Banner A) */
export function AppLaunchBarSlide() {
  return (
    <aside className={styles.banner} aria-label="Android 앱 출시 안내">
      <AppLaunchBarContent qrSize={QR_SIZE} />
    </aside>
  );
}
