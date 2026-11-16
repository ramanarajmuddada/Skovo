import logging
from portal.api import api

ns = api.namespace('subscription', description='Skovo Pro membership')
logger = logging.getLogger("skovo")
