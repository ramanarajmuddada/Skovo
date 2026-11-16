import logging
from portal.api import api

ns = api.namespace('payments', description='Payment orders and checkout')
logger = logging.getLogger("skovo")
