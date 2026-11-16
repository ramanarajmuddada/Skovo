import logging
from portal.api import api

ns = api.namespace('document-vault', description='Document Vault')
logger = logging.getLogger("skovo")
