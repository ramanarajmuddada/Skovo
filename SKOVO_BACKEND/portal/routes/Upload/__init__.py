import logging
from portal.api import api

ns = api.namespace('upload', description='File upload service')
logger = logging.getLogger("skovo")
