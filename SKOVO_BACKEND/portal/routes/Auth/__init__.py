import logging
from portal.api import api

ns = api.namespace('auth', description='Phone / Email OTP Authentication')
logger = logging.getLogger("skovo")
