import logging
from portal.api import api

ns = api.namespace('applications', description='My Applications — track job/internship application pipeline')
logger = logging.getLogger("skovo")
