import logging
from portal.api import api

ns = api.namespace('cg', description='Career Guidance — student-facing read-only endpoints')
logger = logging.getLogger("skovo")
