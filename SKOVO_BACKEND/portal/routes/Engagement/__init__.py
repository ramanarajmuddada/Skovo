import logging
from portal.api import api

ns = api.namespace('engagement', description='Daily goal, quests, mistakes, paths, shop, friends (§7)')
logger = logging.getLogger("skovo")
