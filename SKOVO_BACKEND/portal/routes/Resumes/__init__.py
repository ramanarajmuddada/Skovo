import logging
from portal.api import api

ns = api.namespace('resumes', description='Resume Builder')
logger = logging.getLogger("skovo")
