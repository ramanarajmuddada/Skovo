import logging
from portal.api import api

ns = api.namespace('achiever-reviews', description='Achiever ratings & reviews')
logger = logging.getLogger("skovo")
