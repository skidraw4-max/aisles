'use client';

import { useEffect, useState } from 'react';
import { isCapacitorNative } from '@/lib/capacitor-oauth';
import { PLAY_STORE_URL } from '@/lib/mobile-app';
import styles from './site-footer.module.css';

function GooglePlayBadge({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 135 40"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-hidden
    >
      <rect width="135" height="40" rx="5" fill="#000" />
      <rect
        x="0.5"
        y="0.5"
        width="134"
        height="39"
        rx="4.5"
        fill="none"
        stroke="#A6A6A6"
        strokeWidth="1"
      />
      <path
        d="M9.5 7.8v24.4c0 .5.3.9.7 1.1l.1.1 13.7-13.7v-.4L10.3 6.7l-.1.1c-.4.2-.7.6-.7 1z"
        fill="#4285F4"
      />
      <path
        d="M27.5 20.5l-4.1-4.1-13.7 13.7c.2.2.5.3.8.3.3 0 .6-.1.8-.3l15.2-8.8"
        fill="#34A853"
      />
      <path d="M27.5 19.5l-4.1 4.1 4.1 4.1 8.8-5.1c.5-.3.5-.9 0-1.2l-8.8-4.9z" fill="#FBBC04" />
      <path
        d="M9.5 7.8l13.7 13.7 4.1-4.1L14.4 6.5c-.5-.3-1.1-.1-1.4.4-.1.2-.2.5-.2.9v0z"
        fill="#EA4335"
      />
      <text
        x="44"
        y="14"
        fill="#fff"
        fontFamily="Roboto, Arial, sans-serif"
        fontSize="5.5"
        letterSpacing="0.04em"
      >
        GET IT ON
      </text>
      <text
        x="44"
        y="27"
        fill="#fff"
        fontFamily="Roboto, Arial, sans-serif"
        fontSize="11"
        fontWeight="500"
        letterSpacing="-0.02em"
      >
        Google Play
      </text>
    </svg>
  );
}

export function FooterPlayStoreBadge() {
  const [hide, setHide] = useState(false);

  useEffect(() => {
    setHide(isCapacitorNative());
  }, []);

  if (hide) return null;

  return (
    <a
      href={PLAY_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={styles.playStoreLink}
      aria-label="Google Play에서 AIsle 앱 다운로드 (새 탭)"
    >
      <GooglePlayBadge className={styles.playStoreBadge} />
    </a>
  );
}
