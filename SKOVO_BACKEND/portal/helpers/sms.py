import os
import requests
import logging

logger = logging.getLogger("skovo")


def send_otp_msg91(phone: str, otp: str) -> bool:
    """Send OTP via MSG91."""
    try:
        auth_key = os.environ.get('MSG91_AUTH_KEY', '')
        template_id = os.environ.get('MSG91_OTP_TEMPLATE_ID', '')
        sender_id = os.environ.get('MSG91_SENDER_ID', 'SKOVO')

        if not auth_key or not template_id:
            logger.warning("MSG91 credentials not configured.")
            return False

        url = "https://api.msg91.com/api/v5/otp"
        payload = {
            "template_id": template_id,
            "mobile": f"91{phone.lstrip('+')}",
            "authkey": auth_key,
            "otp": otp
        }
        response = requests.post(url, json=payload, timeout=10)
        data = response.json()
        if data.get('type') == 'success':
            logger.info(f"MSG91 OTP sent to {phone}")
            return True
        logger.warning(f"MSG91 failed: {data}")
        return False
    except Exception as e:
        logger.error(f"MSG91 send_otp error: {e}")
        return False


def send_otp_fast2sms(phone: str, otp: str) -> bool:
    """Fallback OTP via Fast2SMS."""
    try:
        api_key = os.environ.get('FAST2SMS_API_KEY', '')
        if not api_key:
            logger.warning("Fast2SMS API key not configured.")
            return False

        url = "https://www.fast2sms.com/dev/bulkV2"
        payload = {
            "route": "otp",
            "variables_values": otp,
            "numbers": phone.lstrip('+91').lstrip('+')
        }
        headers = {"authorization": api_key}
        response = requests.post(url, json=payload, headers=headers, timeout=10)
        data = response.json()
        if data.get('return'):
            logger.info(f"Fast2SMS OTP sent to {phone}")
            return True
        logger.warning(f"Fast2SMS failed: {data}")
        return False
    except Exception as e:
        logger.error(f"Fast2SMS send_otp error: {e}")
        return False


def send_otp_sms(phone: str, otp: str) -> bool:
    """Try MSG91 first, fall back to Fast2SMS."""
    if send_otp_msg91(phone, otp):
        return True
    return send_otp_fast2sms(phone, otp)
