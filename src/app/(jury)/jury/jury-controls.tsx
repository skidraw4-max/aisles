/**
 * I-083 (UI plan P2): shared Button + StatusBadge for Jury screens. No hooks, so usable from server and client components.
 */
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import {
  Ban, Check, CircleAlert, CircleCheck, CircleDashed, CircleX, Info, LoaderCircle, OctagonAlert, Trash2, type LucideIcon,
} from 'lucide-react';
import { statusTone, type StatusTone } from '@/lib/jury-product/status-tone';
import styles from './jury.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'lg';
export type SaveState = 'idle' | 'saving' | 'saved';

const VARIANT: Record<ButtonVariant, string | undefined> = {
  primary: styles.jbPrimary,
  secondary: styles.jbSecondary,
  ghost: styles.jbGhost,
  danger: styles.jbDanger,
};

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', extra?: string): string {
  return [styles.jb, VARIANT[variant], size === 'lg' ? styles.jbLg : undefined, extra].filter(Boolean).join(' ');
}

type Common = { variant?: ButtonVariant; size?: ButtonSize; icon?: LucideIcon; saveState?: SaveState; children?: ReactNode };

function Content({ icon: Icon, saveState, children }: Pick<Common, 'icon' | 'saveState' | 'children'>) {
  if (saveState === 'saving') return <><LoaderCircle className={styles.jbSpin} aria-hidden size={16} />{children}</>;
  if (saveState === 'saved') return <><Check aria-hidden size={16} />저장됨</>;
  return <>{Icon ? <Icon aria-hidden size={16} /> : null}{children}</>;
}

export function Button({ variant, size, icon, saveState, className, children, ...rest }: Common & Omit<ComponentProps<'button'>, 'children'>) {
  const busy = saveState === 'saving';
  return (
    <button {...rest} className={buttonClass(variant, size, className)} disabled={rest.disabled || busy} aria-busy={busy || rest['aria-busy'] || undefined}>
      <Content icon={icon} saveState={saveState}>{children}</Content>
      {saveState && saveState !== 'idle' ? <span className={styles.srOnly} aria-live="polite">{busy ? '저장 중' : '저장됨'}</span> : null}
    </button>
  );
}

export function ButtonLink({ variant, size, icon, className, children, ...rest }: Omit<Common, 'saveState'> & Omit<ComponentProps<typeof Link>, 'children'>) {
  return <Link {...rest} className={buttonClass(variant, size, className)}><Content icon={icon}>{children}</Content></Link>;
}

const TONE_CLASS: Record<StatusTone, string | undefined> = {
  pass: styles.sbPass, fail: styles.sbFail, partial: styles.sbPartial, blocked: styles.sbBlocked, error: styles.sbError,
  running: styles.sbRunning, deleted: styles.sbDeleted, neutral: styles.sbNeutral, info: styles.sbInfo,
};
const TONE_ICON: Record<StatusTone, LucideIcon> = {
  pass: CircleCheck, fail: CircleX, partial: CircleAlert, blocked: Ban, error: OctagonAlert,
  running: LoaderCircle, deleted: Trash2, neutral: CircleDashed, info: Info,
};

export function badgeClass(tone: StatusTone = 'info'): string {
  return [styles.sb, TONE_CLASS[tone]].filter(Boolean).join(' ');
}

/** Status pill: icon + Korean label. `status` is the raw code (used for tone/title); children is the already-localized label. */
export function StatusBadge(props: { status?: string | null; tone?: StatusTone; title?: string; children: ReactNode; className?: string; 'data-source-tone'?: string }) {
  const text = typeof props.children === 'string' ? props.children : null;
  const tone = props.tone ?? statusTone(props.status, text);
  const Icon = TONE_ICON[tone];
  return (
    <span className={[badgeClass(tone), props.className].filter(Boolean).join(' ')} title={props.title} data-tone={tone} data-source-tone={props['data-source-tone']}>
      <Icon aria-hidden size={14} />{props.children}
    </span>
  );
}
