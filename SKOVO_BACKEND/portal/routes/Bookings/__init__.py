import logging
from portal.api import api

ns = api.namespace('bookings', description='Student Bookings — enrolled cohorts')
logger = logging.getLogger("skovo")
