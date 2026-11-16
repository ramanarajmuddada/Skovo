"""Scramble community and session message text before it is stored.

The key lives in MESSAGE_KEY on the server. The database stores the scrambled
text. Routes decrypt only when an allowed student or Skovo Admin is reading
that message. Sender, receiver, and time are not scrambled — tracking and
expiry need them.

A value without the prefix is older plaintext and is returned unchanged, so
opening an old chat does not fail. A missing or unusable key does not crash
a request: writes stay readable and reads return what is stored.
"""
import os

from cryptography.fernet import Fernet, InvalidToken

PREFIX = 'enc:v1:'

_fernet = None
_fernet_key = None


def _box():
    """The cipher for the current MESSAGE_KEY, or None when it cannot be used."""
    global _fernet, _fernet_key
    key = (os.environ.get('MESSAGE_KEY') or '').strip()
    if not key:
        return None
    if key == _fernet_key and _fernet is not None:
        return _fernet
    try:
        box = Fernet(key.encode('utf-8'))
    except (ValueError, TypeError):
        return None
    _fernet_key = key
    _fernet = box
    return box


def encrypt_message(value):
    """Return scrambled text for storage. Empty and already-scrambled values pass through."""
    if value is None:
        return None
    text = str(value)
    if text == '' or text.startswith(PREFIX):
        return text
    box = _box()
    if box is None:
        return text
    token = box.encrypt(text.encode('utf-8')).decode('ascii')
    return PREFIX + token


def decrypt_message(value):
    """Return readable text for an allowed reader. Older plaintext passes through."""
    if value is None:
        return None
    text = str(value)
    if not text.startswith(PREFIX):
        return text
    box = _box()
    if box is None:
        return text
    try:
        return box.decrypt(text[len(PREFIX):].encode('ascii')).decode('utf-8')
    except (InvalidToken, ValueError, TypeError):
        return text
