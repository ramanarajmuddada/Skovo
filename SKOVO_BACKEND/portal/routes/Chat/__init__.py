import logging
from portal.api import api

ns = api.namespace('chat', description='Session chat messages')
logger = logging.getLogger("skovo")
