import { NextResponse } from 'next/server';
import { Webhook } from 'standardwebhooks';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildEmailHtml({ email, confirmationUrl, siteUrl = 'https://godyrect.com' }) {
  const logo = `${siteUrl}/logo.png`;
  const safeEmail = escapeHtml(email);
  const safeConfirmationUrl = escapeHtml(confirmationUrl);
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0b1020;font-family:Arial,Helvetica,sans-serif;color:#fff;">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
      <div style="background:#121b3f;border:1px solid #2a3c78;border-radius:20px;overflow:hidden;">
        <div style="padding:28px 28px 16px;text-align:center;background:linear-gradient(180deg,#16275f 0%,#0b1020 100%);">
          <img src="${logo}" alt="GoDyrect" style="height:42px;width:auto;object-fit:contain;display:block;margin:0 auto 16px;" />
          <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#8fb7ff;font-weight:700;">Welcome to GoDyrect</div>
          <h1 style="margin:12px 0 0;font-size:32px;line-height:1.1;">Welcome to GoDyrect</h1>
        </div>
        <div style="padding:28px;">
          <p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:rgba(255,255,255,.88);">Thanks for joining GoDyrect. Confirm this email address to finish creating your account:</p>
          <p style="margin:0 0 22px;font-size:16px;line-height:1.6;color:#fff;font-weight:700;">${safeEmail}</p>
          <div style="text-align:center;margin:28px 0;">
            <a href="${safeConfirmationUrl}" style="display:inline-block;background:#2e7dff;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;">Confirm your email</a>
          </div>
          <p style="margin:0;font-size:14px;line-height:1.6;color:rgba(255,255,255,.72);">If the button doesn’t work, copy and paste this link into your browser:</p>
          <p style="margin:10px 0 0;font-size:13px;line-height:1.5;word-break:break-all;color:#8fb7ff;">${safeConfirmationUrl}</p>
        </div>
      </div>
      <p style="text-align:center;margin:16px 0 0;font-size:12px;color:rgba(255,255,255,.5);">GoDyrect · ${siteUrl}</p>
    </div>
  </body>
</html>`;
}

export async function POST(req) {
  const apiKey = process.env.RESEND_API_KEY;
  const hookSecret = process.env.SEND_EMAIL_HOOK_SECRET;
  if (!apiKey) {
    return NextResponse.json({ error: 'Missing RESEND_API_KEY' }, { status: 500 });
  }
  if (!hookSecret) {
    return NextResponse.json({ error: 'Missing SEND_EMAIL_HOOK_SECRET' }, { status: 500 });
  }

  const payload = await req.text();
  const headers = Object.fromEntries(req.headers);
  const secret = hookSecret.startsWith('v1,whsec_') ? hookSecret.slice('v1,whsec_'.length) : hookSecret;

  let body;
  try {
    body = new Webhook(secret).verify(payload, headers);
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Invalid hook signature',
        details: error?.message || String(error),
        hint: 'Make sure SEND_EMAIL_HOOK_SECRET matches the exact secret from Supabase Auth Hooks, including the v1,whsec_ prefix in the stored value.',
      },
      { status: 403 }
    );
  }

  const eventType = body?.email_data?.email_action_type || '';
  const confirmationUrl = body?.email_data?.redirect_to || body?.email_data?.action_link || body?.email_data?.url || '';
  const email = body?.user?.email || body?.user?.user_email || '';
  const siteUrl = body?.email_data?.site_url || 'https://godyrect.com';

  if (!confirmationUrl || !email) {
    return NextResponse.json({ error: 'Missing email or confirmation URL' }, { status: 400 });
  }

  const subject = eventType.toLowerCase().includes('recovery')
    ? 'Reset your GoDyrect password'
    : 'Welcome to GoDyrect';

  const html = buildEmailHtml({ email, confirmationUrl, siteUrl });

  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'GoDyrect <no-reply@godyrect.com>',
      to: [email],
      subject,
      html,
    }),
  });

  const resendJson = await resendResponse.json().catch(() => ({}));

  if (!resendResponse.ok) {
    return NextResponse.json(
      { error: resendJson?.message || 'Failed to send email', details: resendJson },
      { status: resendResponse.status || 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
