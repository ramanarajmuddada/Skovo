import os
import base64
import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email import encoders

logger = logging.getLogger("skovo")

# attachments: optional list of dicts -> {'filename': str, 'content': str|bytes, 'mimetype': 'text/calendar'}


def html_to_text(html: str) -> str:
    """A readable plain-text fallback derived from the HTML body.

    Crude on purpose — it is a fallback, not a second template. Block-level
    tags become newlines so the result is not one run-on paragraph, entities
    that actually appear in our templates are decoded, and runs of blank lines
    collapse.

    Callers with something better to say should pass `text_body` explicitly;
    the OTP mail does, because "your code is 927792" matters more than a
    flattened copy of the card.
    """
    import re
    from html import unescape
    s = re.sub(r'(?is)<(script|style|head)[^>]*>.*?</\1>', '', html)
    s = re.sub(r'(?i)<br\s*/?>', '\n', s)
    s = re.sub(r'(?i)</(p|div|tr|h[1-6]|table|li)>', '\n', s)
    s = re.sub(r'(?i)</td>', ' ', s)
    s = re.sub(r'<[^>]+>', '', s)
    s = unescape(s)
    s = '\n'.join(line.strip() for line in s.splitlines())
    s = re.sub(r'\n{3,}', '\n\n', s)
    return s.strip()


def send_email(to: str, subject: str, html_body: str, attachments=None,
               text_body: str = None) -> bool:
    """Send an email through the best configured provider.

    Provider priority:
      1. SendGrid  (SENDGRID_API_KEY)  — recommended for deliverability at scale
      2. SMTP      (MAILSERVER_*)      — Gmail OR Amazon SES SMTP credentials
    Falls through gracefully; returns False (never raises) so callers stay safe.

    `text_body` is optional and defaults to a stripped version of the HTML.
    Every message now carries BOTH parts: a `multipart/alternative` with only
    an HTML branch is what this used to send, and HTML-only mail is scored as
    spam by most filters — which matters most on a sending domain as new as
    this one. It also means a text-preferring client shows something rather
    than an empty message.
    """
    text_body = text_body or html_to_text(html_body)
    if os.environ.get('SENDGRID_API_KEY'):
        if _send_via_sendgrid(to, subject, html_body, attachments, text_body):
            return True
        # fall through to SMTP if SendGrid failed
    return _send_via_smtp(to, subject, html_body, attachments, text_body)


def _send_via_sendgrid(to, subject, html_body, attachments=None, text_body=None) -> bool:
    try:
        import requests
        api_key  = os.environ['SENDGRID_API_KEY']
        from_em  = os.environ.get('MAIL_FROM_EMAIL') or os.environ.get('MAILSERVER_USERNAME', 'no-reply@skovoai.com')
        from_nm  = os.environ.get('MAIL_SENDER_NAME', 'SKOVO Team')
        payload = {
            'personalizations': [{'to': [{'email': to}]}],
            'from': {'email': from_em, 'name': from_nm},
            'subject': subject,
            # text/plain FIRST: RFC 2046 says the last alternative is the
            # most-preferred, so HTML has to come second to be the one shown.
            'content': ([{'type': 'text/plain', 'value': text_body}] if text_body else [])
                       + [{'type': 'text/html', 'value': html_body}],
        }
        if attachments:
            payload['attachments'] = [{
                'content': base64.b64encode(
                    a['content'].encode() if isinstance(a['content'], str) else a['content']
                ).decode(),
                'filename': a['filename'],
                'type': a.get('mimetype', 'application/octet-stream'),
                'disposition': 'attachment',
            } for a in attachments]
        r = requests.post('https://api.sendgrid.com/v3/mail/send',
                          headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
                          json=payload, timeout=15)
        if r.status_code in (200, 201, 202):
            logger.info(f"Email sent via SendGrid to {to}")
            return True
        logger.error(f"SendGrid send failed ({r.status_code}): {r.text[:200]}")
        return False
    except Exception as e:
        logger.error(f"SendGrid error: {e}")
        return False


def _send_via_smtp(to, subject, html_body, attachments=None, text_body=None) -> bool:
    try:
        domain   = os.environ.get('MAILSERVER_DOMAIN', 'smtp.gmail.com')
        port     = int(os.environ.get('MAILSERVER_PORT', 587))
        username = os.environ.get('MAILSERVER_USERNAME', '')
        password = os.environ.get('MAILSERVER_PASSWORD', '')
        name     = os.environ.get('MAIL_SENDER_NAME', 'SKOVO Team')
        # The address recipients see. Kept separate from MAILSERVER_USERNAME,
        # which is only the transport login — the two are the same address only
        # when you authenticate as the mailbox you send from.
        from_em  = os.environ.get('MAIL_FROM_EMAIL') or username

        if not username or not password or 'your_' in password:
            logger.warning("Email credentials not configured.")
            return False

        msg = MIMEMultipart('mixed')
        msg['Subject'] = subject
        msg['From']    = f"{name} <{from_em}>"
        msg['To']      = to
        alt = MIMEMultipart('alternative')
        # Plain text attached FIRST, HTML second. In multipart/alternative the
        # LAST part is the most-preferred one, so reversing these would show
        # recipients the text version.
        if text_body:
            alt.attach(MIMEText(text_body, 'plain', 'utf-8'))
        alt.attach(MIMEText(html_body, 'html', 'utf-8'))
        msg.attach(alt)
        for a in (attachments or []):
            content = a['content'].encode() if isinstance(a['content'], str) else a['content']
            maintype, _, subtype = a.get('mimetype', 'application/octet-stream').partition('/')
            part = MIMEBase(maintype, subtype or 'octet-stream')
            part.set_payload(content)
            encoders.encode_base64(part)
            part.add_header('Content-Disposition', 'attachment', filename=a['filename'])
            msg.attach(part)

        with smtplib.SMTP(domain, port) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(username, password)
            server.sendmail(from_em, to, msg.as_string())

        logger.info(f"Email sent via SMTP to {to}")
        return True
    except smtplib.SMTPAuthenticationError:
        logger.error("SMTP auth failed — check credentials in .env")
        return False
    except Exception as e:
        logger.error(f"Email send error: {e}")
        return False


def otp_email_text(otp: str) -> str:
    """The plain-text alternative for the OTP mail.

    Written by hand rather than stripped from the HTML: a flattened card reads
    as six numbers on separate lines, and the one thing this message exists to
    deliver is a single six-digit code.
    """
    return (
        f"Your SKOVO verification code is {otp}\n\n"
        "It is valid for 10 minutes.\n\n"
        "SKOVO will never ask for this code over phone or chat. "
        "Do not share it with anyone.\n\n"
        "If you did not request this code you can ignore this email — "
        "someone may have entered your address by mistake.\n\n"
        "— SKOVO. This is an automated email; please do not reply."
    )


def otp_email_body(otp: str) -> str:
    # Each digit is a TABLE CELL, not a flex box.
    #
    # This was `display:inline-flex; align-items:center` inside a div. Outlook
    # renders with Word, which supports neither, so the alignment there was
    # luck rather than design. A `<td>` with a fixed height and a matching
    # line-height is the technique that has worked in every client for twenty
    # years, and it needs no fallback.
    digits = ''.join(
        f'<td align="center" valign="middle" width="46" height="58" '
        f'style="width:46px;height:58px;background:#f0f4ff;border:2px solid #2563eb;'
        f'border-radius:10px;font-size:28px;font-weight:800;color:#1d4ed8;'
        f'font-family:Consolas,Menlo,monospace;line-height:58px;text-align:center;">{d}</td>'
        f'<td width="8" style="width:8px;font-size:0;line-height:0;">&nbsp;</td>'
        for d in otp
    )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <meta name="x-apple-disable-message-reformatting"/>
  <!-- Declare light only. Gmail and Apple Mail will otherwise invent a dark
       palette for this card, and an auto-inverted pale-blue digit box on a
       near-black ground is unreadable. -->
  <meta name="color-scheme" content="light"/>
  <meta name="supported-color-schemes" content="light"/>
  <title>SKOVO – Verify Your Identity</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">

  <!-- Preheader: the grey line the inbox shows next to the subject. Without
       it the client grabs whatever text comes first — here, the tagline — so
       the list said "Your Career Readiness Platform" instead of the one fact
       that matters. Hidden in the body itself, then padded so no further
       markup is pulled into the preview. -->
  <div style="display:none;font-size:1px;color:#f4f6fb;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    Your code is {otp} — valid for 10 minutes.
    &#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;
    &#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;
  </div>

  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f6fb;padding:40px 16px;">
    <tr><td align="center">

      <!-- Card -->
      <table width="520" cellpadding="0" cellspacing="0" border="0"
             style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);max-width:520px;">

        <!-- Header -->
        <tr>
          <!-- bgcolor AND a background-color before the gradient.
               Outlook renders with Word, which ignores linear-gradient
               entirely — so this header had no background there at all, and
               the white SKOVO wordmark on it was white-on-white. The brand
               disappeared in the one client most likely to be a workplace
               inbox. The gradient is still there for everyone else; solid
               blue is simply what Outlook falls back to. -->
          <td bgcolor="#2563eb" style="background-color:#2563eb;background:linear-gradient(135deg,#1d4ed8 0%,#2563eb 60%,#3b82f6 100%);padding:32px 40px;text-align:center;">
            <div style="display:inline-block;background-color:#1d4ed8;border-radius:12px;padding:8px 20px;">
              <span style="color:#ffffff;font-size:26px;font-weight:900;letter-spacing:2px;text-transform:uppercase;">SKOVO</span>
            </div>
            <p style="margin:12px 0 0;color:#dbeafe;font-size:13px;letter-spacing:0.5px;">Your Career Readiness Platform</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:40px 40px 20px;">
            <p style="margin:0 0 6px;font-size:22px;font-weight:700;color:#1e293b;">Verify your identity</p>
            <p style="margin:0 0 28px;font-size:15px;color:#64748b;line-height:1.6;">
              Use the one-time code below to complete your sign‑in. This code is valid for <strong>10 minutes</strong>.
            </p>

            <!-- OTP Digits -->
            <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 12px;">
              <tr>{digits}</tr>
            </table>

            <!-- The same code once more, as ordinary selectable text.
                 Six separate cells cannot be copy-pasted — on a phone that
                 means reading six digits, switching apps, and typing them
                 from memory. It is also what a screen reader can announce as
                 one number instead of six unrelated ones. -->
            <p style="margin:0 0 28px;text-align:center;font-size:13px;color:#94a3b8;line-height:1.6;">
              Or copy it:
              <span style="font-family:Consolas,Menlo,monospace;font-size:15px;font-weight:700;color:#334155;letter-spacing:2px;">{otp}</span>
            </p>

            <!-- Security Notice -->
            <table cellpadding="0" cellspacing="0" border="0" width="100%"
                   style="background:#fff7ed;border-left:4px solid #f97316;border-radius:0 8px 8px 0;margin-bottom:28px;">
              <tr>
                <td style="padding:14px 18px;">
                  <p style="margin:0;font-size:13px;color:#92400e;line-height:1.6;">
                    <strong>&#9888; Security tip:</strong> SKOVO will <strong>never</strong> ask for this code over phone or chat.
                    Do not share it with anyone.
                  </p>
                </td>
              </tr>
            </table>

            <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
              If you didn't request this code, you can safely ignore this email.
              Someone may have entered your email address by mistake.
            </p>
          </td>
        </tr>

        <!-- Divider -->
        <tr><td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #f1f5f9;margin:0;"/></td></tr>

        <!-- Footer -->
        <tr>
          <td style="padding:24px 40px 32px;text-align:center;">
            <p style="margin:0 0 6px;font-size:12px;color:#cbd5e1;">
              &copy; 2025 SKOVO. All rights reserved.
            </p>
            <p style="margin:0;font-size:12px;color:#cbd5e1;">
              This is an automated email — please do not reply.
            </p>
          </td>
        </tr>

      </table>
      <!-- /Card -->

    </td></tr>
  </table>
</body>
</html>"""


def send_otp_email(email: str, otp: str, name: str = "Student") -> bool:
    # The hand-written text part, not the stripped-HTML default — see
    # otp_email_text for why.
    return send_email(email, f"{otp} is your SKOVO verification code",
                      otp_email_body(otp), text_body=otp_email_text(otp))


def simple_email_body(heading: str, message: str, button_url: str = None, button_label: str = None) -> str:
    """Generic transactional email body (session confirmations, reminders, refunds).

    Card layout: brand bar, heading, message, one clear button, and the same
    link written out underneath for mail apps that block buttons.
    """
    import html as _h
    safe_msg = _h.escape(message or '').replace(chr(10), '<br/>')
    button = ""
    if button_url and button_label:
        button = (
            f'<tr><td align="center" style="padding:8px 0 0;">'
            f'<a href="{button_url}" style="display:inline-block;background:#2563eb;color:#ffffff;'
            f'text-decoration:none;font-weight:700;font-size:15px;padding:13px 30px;border-radius:10px;">'
            f'{_h.escape(button_label)} &rarr;</a></td></tr>'
            f'<tr><td align="center" style="padding:14px 0 0;font-size:12px;color:#94a3b8;line-height:1.5;">'
            f'Button not working? Open this link:<br/>'
            f'<a href="{button_url}" style="color:#2563eb;word-break:break-all;">{_h.escape(button_url)}</a></td></tr>'
        )
    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;">{_h.escape((message or '')[:140])}</div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;padding:32px 12px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr><td style="background:#2563eb;padding:18px 28px;"><span style="color:#ffffff;font-size:19px;font-weight:800;letter-spacing:0.5px;">SKOVO</span></td></tr>
        <tr><td style="padding:28px 28px 24px;">
          <h1 style="margin:0 0 10px;font-size:20px;line-height:1.3;color:#0f172a;">{_h.escape(heading or '')}</h1>
          <div style="margin:0 0 22px;padding:14px 16px;background:#f8fafc;border-left:3px solid #2563eb;border-radius:8px;font-size:15px;line-height:1.6;color:#334155;">{safe_msg}</div>
          <table width="100%" cellpadding="0" cellspacing="0" border="0">{button}</table>
        </td></tr>
        <tr><td style="padding:14px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:12px;line-height:1.5;color:#94a3b8;">You're receiving this because you have an account on SKOVO. Need help? Reply from Help &amp; support in the app.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""
