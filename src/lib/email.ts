type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

type SendEmailResult =
  | { ok: true; id: string | null }
  | { ok: false; error: string; status?: number };

export function buildEmailSubject(localPart: string): string {
  const cleaned = localPart.trim().replace(/^\[[^\]]+\]\s*/, '');
  return `[AIsle] ${cleaned || '알림'}`;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim() || process.env.RESEND_FROM_EMAIL?.trim();

  if (!apiKey || !from) {
    return { ok: false, error: 'RESEND_API_KEY 또는 EMAIL_FROM 이 설정되지 않았습니다.' };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: input.to,
      subject: buildEmailSubject(input.subject),
      html: input.html,
      text: input.text,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { ok: false, status: res.status, error: detail || `Resend responded ${res.status}` };
  }

  const json = (await res.json().catch(() => null)) as { id?: string } | null;
  return { ok: true, id: json?.id ?? null };
}
