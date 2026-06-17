import { KAKAO_ADFIT_SCRIPT_SRC } from '@/lib/kakao-adfit-runtime';

/** 홈 SSR HTML — ins(AdBanner) 뒤에 ba.min.js (head hoist 방지를 위해 next/script 미사용) */
export function KakaoAdFitScriptTag() {
  return (
    <script
      async
      type="text/javascript"
      charSet="utf-8"
      src={KAKAO_ADFIT_SCRIPT_SRC}
      data-aisle-kakao-adfit="ssr"
    />
  );
}
