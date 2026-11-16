import logging
from portal.api import api

ns = api.namespace('certifications', description='User Certifications Tracker')
logger = logging.getLogger("skovo")
