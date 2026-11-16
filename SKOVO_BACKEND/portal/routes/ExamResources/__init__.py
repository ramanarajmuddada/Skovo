import logging
from portal.api import api

ns = api.namespace('exam-resources', description='Study Materials & Exam Resources')
logger = logging.getLogger("skovo")
