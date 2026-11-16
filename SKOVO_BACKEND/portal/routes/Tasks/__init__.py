import logging
from portal.api import api

ns = api.namespace('tasks', description='Student Tasks — cohort task submissions')
logger = logging.getLogger("skovo")
