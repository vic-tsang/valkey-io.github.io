#!/usr/bin/env bash
# Checks that every Pagefind index this site's search merges is reachable and was built with a compatible
# Pagefind version. With Pagefind's own mergeIndex, a merged index that is missing or unreachable stops the
# whole search box (valkey.io's template checks first and skips it), and
# Pagefind 1.5 changed the index format, so merging across 1.4/1.5 gives wrong results or no search at all.
# 1.5.0 and 1.5.2 (and 1.3.0 and 1.4.0) were compatible in testing, so major.minor is compared.
#
# Usage: check-merged-pagefind-versions.sh <this site's Pagefind version> <file that lists the merged bundle URLs>
#   The bundle URLs (https://<host>/pagefind/) are read from the file that configures mergeIndex, so the list
#   isn't kept in two places: static/pagefind-merge.js on valkey.io, astro.config.mjs on the Starlight sites.
# Needs only curl and jq. CURL_ARGS adds curl options (used for local tests: --connect-to, --cacert).
set -euo pipefail
local_version=$1
bundles=$(grep -Eo 'https://[A-Za-z0-9.-]+/pagefind/' "$2" | sort -u)
if [ -z "$bundles" ]; then
  echo "No merged Pagefind bundle URLs found in $2" >&2
  exit 1
fi

failed=0
for bundle in $bundles; do
  # shellcheck disable=SC2086  # CURL_ARGS is a list of options
  if ! version=$(curl -fsS --max-time 20 ${CURL_ARGS:-} "${bundle}pagefind-entry.json" | jq -er .version); then
    echo "::error::${bundle}pagefind-entry.json can't be read. Merging it fails while it is missing."
    failed=1
  elif [ "${version%.*}" != "${local_version%.*}" ]; then
    echo "::error::${bundle} was built with Pagefind ${version}, this site with ${local_version}. Merged search needs the same major.minor version."
    failed=1
  else
    echo "ok: ${bundle} Pagefind ${version} (this site ${local_version})"
  fi
done
exit "$failed"
