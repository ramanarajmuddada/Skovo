import logging
from portal.api import api

ns = api.namespace('college-reviews', description='College Reviews')
logger = logging.getLogger("skovo")
