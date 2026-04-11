/**
 * 클립보드에 텍스트 복사.
 * 모바일 Safari 등은 사용자 탭 직후 동기적으로 클립보드 API가 이어져야 하므로,
 * 이 함수를 호출하기 전에 `await fetch` 등으로 이벤트 루프를 한 번 비우면 실패할 수 있습니다.
 */
export async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      /* 폴백 시도 */
    }
  }
  if (fallbackExecCommandCopy(text)) return;
  throw new Error('clipboard unavailable');
}

function fallbackExecCommandCopy(text: string): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    ta.style.opacity = '0';
    ta.setAttribute('aria-hidden', 'true');
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
