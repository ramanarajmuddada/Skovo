"""Message safety for students under 18 (feature-updates.md §6, §16 item 12).

Used by community chat, direct messages and mentor chat:
    * phone numbers are masked (10-digit Indian mobiles, with +91 / 0 / spaces / dashes)
    * outside links are refused unless the community allows them
    * words on the admin's blocked list (Telugu + English) are masked
Phone numbers are never shown anywhere on SKOVO; masking also flags the message
so the owner and platform admin can see someone tried.
"""
import re
import time
import unicodedata

MASK = '••••••••••'

# A 10-digit Indian mobile (starts 6-9), optionally +91 / 91 / 0, with spaces,
# dots or dashes between digits. Long digit runs (OTPs, roll numbers > 10) are
# left alone; 10-12 digit runs that look like phones are masked.
_PHONE = re.compile(
    r'(?<![\d])(?:\+?91[\s.\-]*|0)?[6-9](?:[\s.\-]*\d){9}(?![\d])')
_LINK = re.compile(r'(https?://|www\.|\b[a-z0-9\-]+\.(?:com|in|net|org|io|me|co|link|xyz|app|ly)\b)', re.I)
_WA_TG = re.compile(r'\b(wa\.me|whatsapp\.com|t\.me|telegram\.me|chat\.whatsapp)\b', re.I)

_words_cache = {'at': 0, 'words': []}


def _blocked_words():
    if time.time() - _words_cache['at'] < 60:
        return _words_cache['words']
    try:
        from portal.helpers.sp import call_proc
        words = [unicodedata.normalize('NFC', r['word']).casefold() for r in call_proc('sp_cm_blocked_words') or []]
    except Exception:                                        # noqa: BLE001
        words = _words_cache['words']
    _words_cache.update(at=time.time(), words=words)
    return words


def mask_phones(text):
    """-> (masked text, number of numbers masked)."""
    if not text:
        return text, 0
    n = 0

    def repl(_m):
        nonlocal n
        n += 1
        return MASK
    return _PHONE.sub(repl, text), n


def has_link(text):
    return bool(text and (_LINK.search(text) or _WA_TG.search(text)))


def mask_words(text):
    if not text:
        return text, 0
    words = _blocked_words()
    if not words:
        return text, 0
    hits = 0
    out = text
    for w in words:
        if not w:
            continue
        pattern = re.compile(r'(?<!\w)' + re.escape(w) + r'(?!\w)', re.I)
        out, k = pattern.subn('*' * len(w), out)
        hits += k
    return out, hits


def clean(text, allow_links=False):
    """-> (clean text, flags dict, error or None). Error = refuse the message."""
    text = unicodedata.normalize('NFC', (text or '').strip())
    flags = {}
    # WhatsApp / Telegram links are a phone number by another name: always refused.
    if _WA_TG.search(text):
        return None, {'blocked': 'messaging_link'}, 'Links to WhatsApp or Telegram are not allowed.'
    if not allow_links and has_link(text):
        return None, {'blocked': 'link'}, 'Links are not allowed in this community.'
    text, phones = mask_phones(text)
    if phones:
        flags['phone_masked'] = phones
    text, bad = mask_words(text)
    if bad:
        flags['words_masked'] = bad
    return text, flags, None
