'use client';

import * as React from 'react';

export type AcceptanceCriteriaDialogClasses = {
  button?: string;
  dialog?: string;
  inner?: string;
  close?: string;
  title?: string;
  body?: string;
  footer?: string;
  secondaryButton?: string;
};

/** Display-only popup listing a task's full acceptance criteria. Native modal <dialog> (Esc, focus trap); same pattern as ReviewSummaryDialog. */
export function AcceptanceCriteriaDialog({ criteria, classes = {} }: { criteria: string[]; classes?: AcceptanceCriteriaDialogClasses }) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const opener = React.useRef<HTMLButtonElement>(null);
  const titleId = React.useId();
  const items = criteria.map((item) => item.trim()).filter(Boolean);
  if (items.length === 0) return <span>—</span>;
  const close = () => ref.current?.close();
  return (
    <>
      <button
        ref={opener}
        type="button"
        className={classes.button}
        aria-haspopup="dialog"
        title={`완료 기준 ${items.length}개`}
        onClick={() => ref.current?.showModal()}
      >
        확인하기
      </button>
      <dialog
        ref={ref}
        className={classes.dialog}
        aria-modal="true"
        aria-labelledby={titleId}
        onClose={() => opener.current?.focus()}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <div className={classes.inner}>
          <button type="button" className={classes.close} aria-label="닫기" onClick={close}>✕</button>
          <h3 id={titleId} className={classes.title}>완료 기준</h3>
          <ul className={classes.body}>
            {items.map((item, index) => <li key={index}>{item}</li>)}
          </ul>
          <div className={classes.footer}>
            <span />
            <button type="button" className={classes.secondaryButton} onClick={close}>닫기</button>
          </div>
        </div>
      </dialog>
    </>
  );
}
