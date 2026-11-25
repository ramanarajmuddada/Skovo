#!/usr/bin/env bash
# Build and publish the two frontends. Run from the repo root with AWS creds set.
#   deploy/deploy-frontends.sh            # both
#   deploy/deploy-frontends.sh web        # skovoai.com  (students, achievers, public)
#   deploy/deploy-frontends.sh admin      # skovoai.info (console, admin, super admin)
set -euo pipefail
ACCT="${AWS_ACCOUNT_ID:-926465100328}"
WEB_DIST="${WEB_DISTRIBUTION_ID:-EKXK8P8WLSH6V}"
ADMIN_DIST="${ADMIN_DISTRIBUTION_ID:-EPF395BR46GBL}"
which="${1:-both}"

publish() { # name outdir bucket distribution
  echo ">> $1: build"; (cd Skovo && npm run "build:$1")
  echo ">> $1: upload"
  aws s3 sync "Skovo/$2" "s3://$3" --delete --only-show-errors \
      --cache-control "public,max-age=31536000,immutable" --exclude index.html
  aws s3 cp "Skovo/$2/index.html" "s3://$3/index.html" --only-show-errors \
      --cache-control "no-cache" --content-type text/html
  aws cloudfront create-invalidation --distribution-id "$4" --paths "/*" >/dev/null
  echo ">> $1: done"
}
[ "$which" = web   ] || [ "$which" = both ] && publish web   dist-web   "skovo-web-$ACCT"   "$WEB_DIST"
[ "$which" = admin ] || [ "$which" = both ] && publish admin dist-admin "skovo-admin-$ACCT" "$ADMIN_DIST"
exit 0
