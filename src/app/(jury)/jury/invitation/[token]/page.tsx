import type { Metadata } from 'next';
import Link from 'next/link';
import { JuryEmailNotice } from '@/components/jury/JuryEmailNotice';
import { JuryInvitationAccept } from '@/components/jury/JuryInvitationAccept';
import styles from '@/components/jury/jury-entry.module.css';
import { invitationMessage } from '@/lib/jury-product/organization-invitation';
import { readInvitationPreview, listMembershipsForUser } from '@/lib/jury-product/jury-db';
import { juryLoginHref, jurySignupLink } from '@/lib/jury-product/jury-url';
import { getJuryEntry } from '@/lib/jury-product/session';
import { createClient } from '@/lib/supabase/server';
import { readJurySessionEmail } from '../../load';

export const metadata: Metadata = {
  title: 'Organization invitation — AIsles Jury',
};

export default async function JuryInvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const preview = await readInvitationPreview(token).catch(() => ({ ok: false as const, reason: 'NOT_FOUND' as const }));
  const entry = await getJuryEntry();
  const returnPath = `/jury/invitation/${token}`;
  if (!entry.ok && entry.reason === 'EMAIL_UNVERIFIED') {
    return <JuryEmailNotice email={await readJurySessionEmail()} />;
  }
  let notice: string | null = null;
  if (!preview.ok) notice = invitationMessage(preview.reason);
  else if (preview.invitation.status === 'EXPIRED') notice = invitationMessage('EXPIRED');
  else if (preview.invitation.status === 'ACCEPTED') notice = invitationMessage('ALREADY_USED');
  else if (!entry.ok && entry.reason === 'UNAUTHENTICATED') notice = null;
  else if (entry.ok || (!entry.ok && entry.reason === 'NO_MEMBERSHIP')) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const email = user?.email?.trim().toLowerCase() ?? '';
    if (email !== preview.invitation.email) notice = invitationMessage('EMAIL_MISMATCH');
    else if (user?.id) {
      const memberships = await listMembershipsForUser(user.id).catch(() => []);
      if (memberships.some((row) => row.tenantId === preview.invitation.tenantId)) {
        notice = invitationMessage('ALREADY_HAS_MEMBERSHIP');
      }
    }
  }

  const pending = preview.ok && preview.invitation.status === 'PENDING' && !notice;
  const canAccept = pending && (entry.ok || (!entry.ok && entry.reason === 'NO_MEMBERSHIP'));

  return (
    <section className={styles.screen}>
      <div className={styles.frame}>
        <h1 className={styles.brand}>AIsles Jury</h1>
        <h2 className={styles.loginTitle}>Organization invitation</h2>
        {preview.ok && !notice ? <p className={styles.copy}>{preview.invitation.tenantName}</p> : null}
        {notice ? <p className={styles.alert} role="alert">{notice}</p> : null}
        {canAccept && preview.ok ? (
          <JuryInvitationAccept
            token={token}
            organizationName={preview.invitation.tenantName}
            email={preview.invitation.email}
          />
        ) : null}
        {!entry.ok && entry.reason === 'UNAUTHENTICATED' && preview.ok && preview.invitation.status === 'PENDING' ? (
          <p className={styles.signup}>
            <Link className={styles.textLink} href={juryLoginHref(returnPath)}>Login</Link>
            {' · '}
            <Link className={styles.textLink} href={jurySignupLink(returnPath)}>Create account</Link>
          </p>
        ) : null}
      </div>
    </section>
  );
}
