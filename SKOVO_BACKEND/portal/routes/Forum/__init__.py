import logging
from portal.api import api

ns = api.namespace('forum', description='Community Forum / Q&A')
logger = logging.getLogger("skovo")
