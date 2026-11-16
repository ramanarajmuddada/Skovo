import logging
from portal.api import api

ns = api.namespace('assemble', description='Assemble — Community groups, posts, likes')
logger = logging.getLogger("skovo")
