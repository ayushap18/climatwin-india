#!/usr/bin/env bash
# Publish wiki/*.md to the GitHub Wiki repo.
# Prereq: enable Wikis in repo Settings and create the first page once (see PUBLISH.md).
set -euo pipefail

REPO_SLUG="ayushap18/climatwin-india"
WIKI_URL="https://github.com/${REPO_SLUG}.wiki.git"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"

echo "▶ cloning ${WIKI_URL}"
if ! git clone "$WIKI_URL" "$TMP/wiki" 2>/dev/null; then
  echo "✗ Wiki repo not found. Enable Wikis in Settings and create the first page first (see PUBLISH.md)." >&2
  exit 1
fi

echo "▶ copying pages"
# copy every markdown page except this helper set
for f in "$SRC_DIR"/*.md; do
  base="$(basename "$f")"
  [ "$base" = "PUBLISH.md" ] && continue
  cp "$f" "$TMP/wiki/$base"
done

cd "$TMP/wiki"
git add -A
if git diff --cached --quiet; then
  echo "✓ wiki already up to date"
else
  git commit -m "docs(wiki): sync ClimaTwin India wiki pages"
  git push origin HEAD
  echo "✓ pushed wiki pages"
fi

rm -rf "$TMP"
