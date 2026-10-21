/**
 * Premium transactional email templates.
 *
 * Everything is table-based with inline styles so it renders consistently in
 * Gmail, Apple Mail, Outlook, and mobile clients. Brand: near-black ink,
 * electric indigo accent (#280dff), soft mist gray surfaces.
 */

export const BRAND = {
  name: "Omnivex Academy",
  accent: "#280dff",
  accentSoft: "#efeaff",
  ink: "#0b1020",
  body: "#4b5266",
  mist: "#8a90a6",
  surface: "#f4f5f9",
  border: "#e6e8f0",
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Appends the current year to footer copy: "© 2026 Omnivex Academy". */
function yearLine(): number {
  return new Date().getFullYear();
}

type WrapArgs = {
  preheader: string;
  contentHtml: string;
};

/**
 * Renders the shared brand shell around a block of content HTML.
 */
export function wrapEmail({ preheader, contentHtml }: WrapArgs): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${escapeHtml(BRAND.name)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.surface};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <!-- Preheader: hidden inbox preview text -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    ${escapeHtml(preheader)}&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.surface};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
          <!-- Accent bar -->
          <tr>
            <td style="height:5px;background:linear-gradient(90deg,${BRAND.accent} 0%,#7c5cff 100%);border-radius:14px 14px 0 0;font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <!-- Card -->
          <tr>
            <td style="background:#ffffff;border:1px solid ${BRAND.border};border-top:none;padding:36px 32px 28px;">
              <!-- Brand row -->
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="40" valign="middle">
                    <div style="width:36px;height:36px;border-radius:11px;background:${BRAND.ink};color:#ffffff;font-size:19px;font-weight:800;line-height:36px;text-align:center;">O</div>
                  </td>
                  <td valign="middle" style="padding-left:12px;">
                    <span style="font-size:16px;font-weight:700;color:${BRAND.ink};letter-spacing:-0.2px;">${escapeHtml(BRAND.name)}</span>
                  </td>
                </tr>
              </table>

              ${contentHtml}

              <!-- Divider -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr><td style="border-top:1px solid ${BRAND.border};font-size:0;line-height:0;">&nbsp;</td></tr>
              </table>

              <p style="margin:18px 0 0;font-size:12px;line-height:1.7;color:${BRAND.mist};">
                © ${yearLine()} ${escapeHtml(BRAND.name)} · Premium Amazon KDP mentorship &amp; community.<br/>
                You're receiving this because you have an account at omnivex.academy.
              </p>
            </td>
          </tr>
          <!-- Bottom spacer -->
          <tr>
            <td style="height:28px;font-size:0;line-height:0;">&nbsp;</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** H1 + lead paragraph block used by the transactional templates. */
function heading(title: string, lead?: string): string {
  return `
              <h1 style="margin:26px 0 0;font-size:22px;line-height:1.35;font-weight:700;color:${BRAND.ink};letter-spacing:-0.3px;">${escapeHtml(title)}</h1>
              ${
                lead
                  ? `<p style="margin:10px 0 0;font-size:14px;line-height:1.7;color:${BRAND.body};">${lead}</p>`
                  : ""
              }`;
}

function paragraph(text: string): string {
  return `<p style="margin:16px 0 0;font-size:14px;line-height:1.7;color:${BRAND.body};">${escapeHtml(text)}</p>`;
}

/** Primary CTA button (bulletproof table-based). */
export function buttonBlock(label: string, url: string): string {
  const safeUrl = escapeHtml(url);
  return `
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 0;">
                <tr>
                  <td align="center" bgcolor="${BRAND.accent}" style="border-radius:11px;">
                    <a href="${safeUrl}" style="display:inline-block;padding:13px 30px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:11px;">${escapeHtml(label)}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:14px 0 0;font-size:12px;line-height:1.6;color:${BRAND.mist};">Button not working? Paste this link into your browser:<br/>
                <a href="${safeUrl}" style="color:${BRAND.mist};word-break:break-all;">${safeUrl}</a>
              </p>`;
}

/* ------------------------------------------------------------------ */
/* Verification code (premium OTP hero)                                */
/* ------------------------------------------------------------------ */

export function verificationOtpEmail(name: string, otp: string): { subject: string; html: string } {
  const first = escapeHtml(name.split(/\s+/)[0] || "there");
  const content = `
              ${heading(`Confirm your email`, `Welcome to the academy, ${first}. Enter this code to verify your address and step inside.`)}
              <!-- OTP hero -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 0;">
                <tr>
                  <td align="center" bgcolor="${BRAND.ink}" style="border-radius:14px;padding:26px 12px;">
                    <p style="margin:0;font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:#8ea0e8;">Your verification code</p>
                    <p style="margin:12px 0 0;font-family:'SF Mono',SFMono-Regular,Menlo,Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:10px;color:#ffffff;padding-left:10px;">${escapeHtml(otp)}</p>
                    <p style="margin:12px 0 0;font-size:11px;color:#6d7bb3;">Expires in 10 minutes · single use</p>
                  </td>
                </tr>
              </table>
              ${paragraph(
                "If you didn't create an Omnivex Academy account, you can safely ignore this email.",
              )}`;
  return {
    subject: `Your ${BRAND.name} verification code: ${otp}`,
    html: wrapEmail({
      preheader: `Your verification code is ${otp} — it expires in 10 minutes.`,
      contentHtml: content,
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Password reset                                                      */
/* ------------------------------------------------------------------ */

export function passwordResetEmail(name: string, url: string): { subject: string; html: string } {
  const first = escapeHtml(name.split(/\s+/)[0] || "there");
  const content = `
              ${heading(`Reset your password`, `Hi ${first}, we received a request to choose a new password for your ${BRAND.name} account.`)}
              ${buttonBlock("Choose a new password", url)}
              ${paragraph(
                "This link is single-use and expires in 1 hour. If you didn't request it, no action is needed — your password stays unchanged.",
              )}`;
  return {
    subject: `Reset your ${BRAND.name} password`,
    html: wrapEmail({
      preheader: "Choose a new password for your Omnivex Academy account.",
      contentHtml: content,
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Admin broadcast                                                     */
/* ------------------------------------------------------------------ */

/**
 * Wraps admin-authored content HTML (built with the composer snippets) in the
 * premium brand shell. The inner HTML is trusted — only admins compose it.
 */
export function broadcastEmail(subject: string, innerHtml: string, firstName?: string): {
  subject: string;
  html: string;
} {
  const greeting = firstName
    ? `<p style="margin:22px 0 0;font-size:14px;font-weight:600;color:${BRAND.ink};">Hey ${escapeHtml(firstName)} 👋</p>`
    : "";
  return {
    subject,
    html: wrapEmail({
      preheader: subject,
      contentHtml: `${heading(subject)}${greeting}
              <div style="margin-top:18px;font-size:14px;line-height:1.7;color:${BRAND.body};">${innerHtml}</div>`,
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Plain-text companions (used by Resend `text` + dev_outbox)          */
/* ------------------------------------------------------------------ */

export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, " ")
    .trim();
}
