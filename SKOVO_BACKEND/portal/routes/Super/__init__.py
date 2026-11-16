import logging
from portal.api import api

ns = api.namespace('skovo-platform-owner', description='SKOVO Super Admin API')
logger = logging.getLogger("skovo")
