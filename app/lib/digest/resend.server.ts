type ResendEmailRequest = {
  from: string;
  to: string;
  subject: string;
  html: string;
};

export async function sendResendEmail(env: any, args: ResendEmailRequest) {
  const apiKey = (env?.RESEND_API_KEY ?? (process as any)?.env?.RESEND_API_KEY) as string | undefined;
  if (!apiKey) {
    throw new Error('[RIDVAN-E1101] Missing RESEND_API_KEY');
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: args.from,
      to: args.to,
      subject: args.subject,
      html: args.html,
    }),
  });

  const json = (await res.json().catch(() => null)) as any;
  if (!res.ok) {
    throw new Error(`[RIDVAN-E1102] Resend failed (${res.status}): ${json?.message ?? 'unknown error'}`);
  }

  return json;
}
