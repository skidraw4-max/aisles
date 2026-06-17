'use client';

import { useEffect } from 'react';
import {
  KAKAO_ADFIT_SCRIPT_SRC,
  onAdfitScriptLoad,
  renderAllAdfitUnitsInDom,
  whenAdfitReady,
} from '@/lib/kakao-adfit-runtime';

const SCRIPT_MARKER = 'data-aisle-kakao-adfit';

/**
 * Kakao AdFit ba.min.js — body 맨 아래에서 ins 뒤에 1회 주입 (공식 설치 순서).
 * next/script·layout raw script는 head로 끌어올려져 ins보다 먼저 실행된다.
 */
export function KakaoAdFitScript() {
  useEffect(() => {
    const existing = document.querySelector<HTMLScriptElement>(`script[${SCRIPT_MARKER}]`);
    if (existing) {
      whenAdfitReady(() => renderAllAdfitUnitsInDom());
      return;
    }

    const script = document.createElement('script');
    script.async = true;
    script.type = 'text/javascript';
    script.src = KAKAO_ADFIT_SCRIPT_SRC;
    script.charset = 'utf-8';
    script.setAttribute(SCRIPT_MARKER, '1');
    script.onload = () => {
      onAdfitScriptLoad();
      whenAdfitReady(() => renderAllAdfitUnitsInDom());
    };
    document.body.appendChild(script);
  }, []);

  return null;
}
