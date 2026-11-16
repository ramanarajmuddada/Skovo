import logging
from portal.api import api

ns = api.namespace('readiness', description='Readiness Assessment — 4-step career evaluation')
logger = logging.getLogger("skovo")
