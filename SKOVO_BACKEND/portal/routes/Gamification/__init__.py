import logging
from portal.api import api

ns = api.namespace('gamification', description='Badges, Streaks & Gamification')
logger = logging.getLogger("skovo")
