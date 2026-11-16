import logging
from portal.api import api

ns = api.namespace('profile', description='My Profile — personal info, career interests, readiness score')
logger = logging.getLogger("skovo")
