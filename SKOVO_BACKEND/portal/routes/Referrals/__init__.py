import logging
from portal.api import api

ns = api.namespace('referrals', description='Student referral programme')
logger = logging.getLogger("skovo")
