import logging
from portal.api import api

ns = api.namespace('college-applications', description='College Application Tracker')
logger = logging.getLogger("skovo")
