import logging
from portal.api import api

ns = api.namespace('billing', description='Coupons, invoices & receipts')
logger = logging.getLogger("skovo")
