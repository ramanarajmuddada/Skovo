import logging
from portal.api import api

ns = api.namespace('courses', description='Achiever-launched courses — browse, enroll, manage')
logger = logging.getLogger("skovo")
