#!/bin/bash
# Checks the Pagefind index built by build/pagefind-step.sh.
# Usage: build/check-search-index.sh [public-dir]     (needs only bash, find, grep, gzip, sed, sort, comm)
#
# 1. Coverage: every full HTML page Zola rendered, other than redirects (alias stubs and external
#    event pages carry http-equiv="refresh"), must be in the index. The expected list doesn't depend
#    on pagefind.yml, so a root selector that stops matching shows up as missing pages.
# 2. Scoping: the site footer must not be in any record. If scoping stops working, Pagefind indexes
#    whole pages and the footer text appears in every record.
set -euo pipefail
public=${1:-public}
footer_sentinel="Valkey and the Valkey logo are trademarks of LF Projects"

expected=$(mktemp); indexed=$(mktemp); records=$(mktemp)
find "$public" -name index.html -not -path "$public/pagefind/*" -print0 \
  | xargs -0 grep -L 'http-equiv="refresh"' \
  | xargs grep -l '<html' \
  | sed -e "s|^$public||" -e 's|index\.html$||' | sort > "$expected"

# Each fragment is gzip("pagefind_dcd" + one line of JSON) whose first key is the page URL.
for fragment in "$public"/pagefind/fragment/*.pf_fragment; do gzip -dc "$fragment"; echo; done > "$records"
sed -n 's|^pagefind_dcd{"url":"\([^"]*\)".*|\1|p' "$records" | sort > "$indexed"
footer_hits=$(grep -cF "$footer_sentinel" "$records" || true)

missing=$(comm -23 "$expected" "$indexed")
echo "Search index: $(wc -l < "$indexed" | tr -d ' ') records; $(wc -l < "$expected" | tr -d ' ') rendered pages expected; footer text in ${footer_hits} records"
status=0
if [ ! -s "$indexed" ]; then
  echo "The search index is empty" >&2
  status=1
fi
if [ -n "$missing" ]; then
  echo "Pages missing from the search index ($(wc -l <<< "$missing" | tr -d ' ')):" >&2
  echo "$missing" >&2
  status=1
fi
if [ "$footer_hits" -gt 0 ]; then
  echo "The site footer was indexed in ${footer_hits} records: check root_selector and exclude_selectors in pagefind.yml" >&2
  grep -F "$footer_sentinel" "$records" | sed -n 's|^pagefind_dcd{"url":"\([^"]*\)".*|  \1|p' >&2
  status=1
fi
exit $status
