import logging
from portal.api import api

ns = api.namespace('public', description='Public, no-session data for the marketing site')
logger = logging.getLogger("skovo")
