import logging
from portal.api import api

ns = api.namespace('market', description='Market — curated student deals & offers')
logger = logging.getLogger("skovo")
