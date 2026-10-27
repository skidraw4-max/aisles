'use client';

/** I-070: on narrow screens keep the active service tab scrolled into view (horizontal only). */
import { useEffect } from 'react';

export function ServiceTabScroll({ containerId, active }: { containerId: string; active: string }) {
  useEffect(() => {
    const box = document.getElementById(containerId);
    const tab = box?.querySelector<HTMLElement>('[data-active="true"]');
    if (!box || !tab || box.scrollWidth <= box.clientWidth) return;
    const left = tab.offsetLeft - (box.clientWidth - tab.offsetWidth) / 2;
    box.scrollLeft = Math.max(0, left);
  }, [containerId, active]);
  return null;
}
