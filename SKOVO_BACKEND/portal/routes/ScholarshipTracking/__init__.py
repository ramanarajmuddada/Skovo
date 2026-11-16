import logging
from portal.api import api

ns = api.namespace('scholarship-tracking', description='Scholarship Application Tracker')
logger = logging.getLogger("skovo")
