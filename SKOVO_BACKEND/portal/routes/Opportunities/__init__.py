import logging
from portal.api import api

ns = api.namespace('opportunities', description='Readiness-gated internships, fresher jobs, fellowships')
logger = logging.getLogger("skovo")
