import logging
from portal.api import api

ns = api.namespace('notifications', description='User notifications')
logger = logging.getLogger("skovo")
