import os
import base64
from Crypto.Cipher import AES
from Crypto.Random import get_random_bytes


def _get_key() -> bytes:
    """
    Load AES key from ENCRYPTION_KEY env var.
    Value must be a base64-encoded 16, 24, or 32 byte key.
    Generate one with: python -c "import os,base64; print(base64.b64encode(os.urandom(32)).decode())"
    """
    key_b64 = os.environ.get('ENCRYPTION_KEY', '')
    if not key_b64:
        raise RuntimeError("ENCRYPTION_KEY environment variable is not set.")
    try:
        key = base64.b64decode(key_b64)
    except Exception:
        key = key_b64.encode('utf-8')
    if len(key) not in (16, 24, 32):
        raise RuntimeError(
            f"ENCRYPTION_KEY must decode to 16, 24, or 32 bytes (got {len(key)}). "
            "Use a base64-encoded key."
        )
    return key


def encrypt(plaintext: str) -> str:
    """AES-GCM authenticated encryption. Returns base64(nonce[16] + tag[16] + ciphertext)."""
    key = _get_key()
    nonce = get_random_bytes(16)
    cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
    ciphertext, tag = cipher.encrypt_and_digest(plaintext.encode('utf-8'))
    return base64.b64encode(nonce + tag + ciphertext).decode('utf-8')


def decrypt(token: str) -> str:
    """AES-GCM authenticated decryption. Raises ValueError if authentication fails."""
    key = _get_key()
    raw = base64.b64decode(token.encode('utf-8'))
    nonce = raw[:16]
    tag = raw[16:32]
    ciphertext = raw[32:]
    cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
    try:
        return cipher.decrypt_and_verify(ciphertext, tag).decode('utf-8')
    except ValueError:
        raise ValueError("Decryption failed: authentication tag mismatch.")
