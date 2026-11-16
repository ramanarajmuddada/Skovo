import logging
from portal.api import api

ns = api.namespace('dashboard', description='Student Dashboard — readiness score, upcoming cohorts, quick actions')
logger = logging.getLogger("skovo")
