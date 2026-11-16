import logging
from portal.api import api

ns = api.namespace('achiever', description='Achiever Portal — auth, login, register')
logger = logging.getLogger("skovo")
