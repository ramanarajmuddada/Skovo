import logging
from portal.api import api

ns = api.namespace('colleges', description='Find Colleges — rank-to-fit mapping')
logger = logging.getLogger("skovo")
