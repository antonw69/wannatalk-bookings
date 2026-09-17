import nodemailer from 'nodemailer';

const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpSecure = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
const smtpUser = process.env.SMTP_USER;
const smtpPassword = process.env.SMTP_PASSWORD;
const mailFrom = process.env.MAIL_FROM || `WannaTalk <${smtpUser}>`;
const mailReplyTo = process.env.MAIL_REPLY_TO || smtpUser;
const appBaseUrl = String(process.env.APP_BASE_URL || 'https://bookings.wannatalk.co.za').replace(/\/$/, '');

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function transporter() {
  if (!smtpHost || !smtpUser || !smtpPassword) throw new Error('SMTP configuration is incomplete');
  return nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    requireTLS: !smtpSecure,
    auth: { user: smtpUser, pass: smtpPassword },
  });
}

export function mailConfigurationStatus() {
  return {
    configured: Boolean(smtpHost && smtpUser && smtpPassword),
    host: smtpHost || null,
    port: smtpPort,
    secure: smtpSecure,
    sender: mailFrom,
  };
}

export async function verifyMailTransport() {
  const configuration = mailConfigurationStatus();
  if (!configuration.configured) return { ...configuration, ok: false, error: 'Email is not configured' };
  const startedAt = Date.now();
  const transport = transporter();
  try {
    await transport.verify();
    return { ...configuration, ok: true, responseMs: Date.now() - startedAt };
  } catch (error) {
    return { ...configuration, ok: false, responseMs: Date.now() - startedAt, error: error.message };
  } finally {
    transport.close();
  }
}

export async function sendPasswordResetEmail({ email, fullName, token, expiresMinutes }) {
  const resetUrl = `${appBaseUrl}/#reset=${encodeURIComponent(token)}`;
  const safeName = escapeHtml(fullName || 'WannaTalk user');
  const subject = 'Reset your WannaTalk password';
  const text = [
    `Hello ${fullName || 'WannaTalk user'},`,
    '',
    'We received a request to reset your WannaTalk booking password.',
    `Open this secure link to choose a new password: ${resetUrl}`,
    '',
    `This link expires in ${expiresMinutes} minutes and can only be used once.`,
    'If you did not request this change, you can ignore this email.',
    '',
    'WannaTalk — You are not alone.',
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f2f8f4;font-family:Arial,sans-serif;color:#163d2b"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:28px 12px;background:#f2f8f4"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border:1px solid #d7eadf;border-radius:18px;overflow:hidden"><tr><td style="padding:26px 32px;background:linear-gradient(135deg,#16a56f,#064d2f);color:#fff"><div style="font-size:25px;font-weight:800">WannaTalk</div><div style="margin-top:5px;font-size:13px;opacity:.88">You are not alone.</div></td></tr><tr><td style="padding:32px"><h1 style="margin:0 0 18px;font-size:24px;color:#064d2f">Reset your password</h1><p style="font-size:16px;line-height:1.6">Hello ${safeName},</p><p style="font-size:16px;line-height:1.6">We received a request to reset your WannaTalk booking password.</p><p style="margin:28px 0"><a href="${resetUrl}" style="display:inline-block;padding:14px 22px;border-radius:12px;background:#087a45;color:#fff;text-decoration:none;font-weight:700">Choose a new password</a></p><p style="font-size:14px;line-height:1.6;color:#587064">This secure link expires in ${expiresMinutes} minutes and can only be used once.</p><p style="font-size:14px;line-height:1.6;color:#587064">If you did not request this change, you can safely ignore this email.</p></td></tr><tr><td style="padding:18px 32px;background:#eff8f2;color:#587064;font-size:12px">Copyright WannaTalkTM 2026</td></tr></table></td></tr></table></body></html>`;

  return transporter().sendMail({
    from: mailFrom,
    replyTo: mailReplyTo,
    to: email,
    subject,
    text,
    html,
  });
}

export async function sendOtpEmail({ email, fullName, code, expiresMinutes }) {
  const safeName = escapeHtml(fullName || 'WannaTalk user');
  const safeCode = escapeHtml(code);
  const subject = 'Your WannaTalk verification code';
  const text = [
    `Hello ${fullName || 'WannaTalk user'},`,
    '',
    `Your WannaTalk verification code is: ${code}`,
    `This code expires in ${expiresMinutes} minutes and can only be used once.`,
    'If you did not request this code, please ignore this email and contact WannaTalk support.',
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f2f8f4;font-family:Arial,sans-serif;color:#163d2b"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:28px 12px;background:#f2f8f4"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border:1px solid #d7eadf;border-radius:18px;overflow:hidden"><tr><td style="padding:26px 32px;background:linear-gradient(135deg,#16a56f,#064d2f);color:#fff"><div style="font-size:25px;font-weight:800">WannaTalk</div><div style="margin-top:5px;font-size:13px;opacity:.88">Secure account verification</div></td></tr><tr><td style="padding:32px"><h1 style="margin:0 0 18px;font-size:24px;color:#064d2f">Verification code</h1><p style="font-size:16px;line-height:1.6">Hello ${safeName},</p><p style="font-size:16px;line-height:1.6">Enter this code to continue signing in to WannaTalk:</p><div style="margin:26px 0;padding:18px;border-radius:14px;background:#eff8f2;text-align:center;font-size:34px;font-weight:800;letter-spacing:8px;color:#064d2f">${safeCode}</div><p style="font-size:14px;line-height:1.6;color:#587064">This code expires in ${expiresMinutes} minutes and can only be used once.</p><p style="font-size:14px;line-height:1.6;color:#587064">If you did not request this code, ignore this email and contact WannaTalk support.</p></td></tr><tr><td style="padding:18px 32px;background:#eff8f2;color:#587064;font-size:12px">Copyright WannaTalkTM 2026</td></tr></table></td></tr></table></body></html>`;

  return transporter().sendMail({ from: mailFrom, replyTo: mailReplyTo, to: email, subject, text, html });
}

export async function sendCommunicationEmail({ email, fullName, subject, message }) {
  const safeName = escapeHtml(fullName || 'WannaTalk patient');
  const safeSubject = String(subject || 'Message from WannaTalk').slice(0, 160);
  const safeMessage = escapeHtml(String(message || '')).replace(/\n/g, '<br>');
  const text = [`Hello ${fullName || 'WannaTalk patient'},`, '', String(message || ''), '', 'WannaTalk — You are not alone.'].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f2f8f4;font-family:Arial,sans-serif;color:#163d2b"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:28px 12px;background:#f2f8f4"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border:1px solid #d7eadf;border-radius:18px;overflow:hidden"><tr><td style="padding:26px 32px;background:linear-gradient(135deg,#16a56f,#064d2f);color:#fff"><div style="font-size:25px;font-weight:800">WannaTalk</div><div style="margin-top:5px;font-size:13px;opacity:.88">You are not alone.</div></td></tr><tr><td style="padding:32px"><h1 style="margin:0 0 18px;font-size:24px;color:#064d2f">${escapeHtml(safeSubject)}</h1><p style="font-size:16px;line-height:1.6">Hello ${safeName},</p><p style="font-size:16px;line-height:1.7">${safeMessage}</p><p style="font-size:13px;line-height:1.6;color:#587064">For your privacy, reply only with information you are comfortable sharing by email.</p></td></tr><tr><td style="padding:18px 32px;background:#eff8f2;color:#587064;font-size:12px">Copyright WannaTalkTM 2026</td></tr></table></td></tr></table></body></html>`;
  return transporter().sendMail({ from: mailFrom, replyTo: mailReplyTo, to: email, subject: safeSubject, text, html });
}
