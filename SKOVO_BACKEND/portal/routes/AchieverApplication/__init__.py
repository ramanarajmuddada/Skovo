import logging
from portal.api import api

ns = api.namespace('achiever-application',
                   description='Achiever application — evidence, agreements, trust status')
logger = logging.getLogger("skovo")
