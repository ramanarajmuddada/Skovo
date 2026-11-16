import logging
from portal.api import api

ns = api.namespace('mock-tests', description='Mock Tests — student practice exams')
logger = logging.getLogger("skovo")
