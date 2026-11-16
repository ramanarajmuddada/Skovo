import logging
from portal.api import api

ns = api.namespace('webhooks', description='Payment and third-party webhooks')
logger = logging.getLogger("skovo")
