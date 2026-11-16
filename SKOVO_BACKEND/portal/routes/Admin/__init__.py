import logging
from portal.api import api

ns = api.namespace('skovo-platform-panel-admin', description='Admin Panel API')
logger = logging.getLogger("skovo")
