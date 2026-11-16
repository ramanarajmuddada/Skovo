import logging
from portal.api import api

ns = api.namespace('coaching-centres', description='Coaching & Skill Centres with exclusive Skovo discounts')
logger = logging.getLogger("skovo")
