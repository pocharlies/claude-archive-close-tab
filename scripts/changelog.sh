#!/usr/bin/env bash
# Prints the changelog section of a release: what each merged pull request says
# it does (title and description) plus the commits that went in, from the
# previous tag up to <ref>.
#
#   scripts/changelog.sh <version> [ref]
#
# Needs full history and tags (checkout with fetch-depth: 0), gh with GH_TOKEN
# and GITHUB_REPOSITORY.
set -euo pipefail

version="$1"
ref="${2:-HEAD}"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is not set}"

prev=$(git describe --tags --abbrev=0 "$ref^" 2>/dev/null || true)
range="${prev:+$prev..}$ref"

echo "## v$version — $(date -u +%F)"
echo
if [ -n "$prev" ]; then
  echo "Cambios desde $prev."
else
  echo "Primera versión con changelog: recoge toda la historia."
fi
echo

prs=$(git log --format=%H "$range" | while read -r sha; do
  gh api "repos/$repo/commits/$sha/pulls" --jq '.[] | select(.merged_at != null) | .number'
done | sort -un)

for n in $prs; do
  gh pr view "$n" --repo "$repo" --json number,title,body,url \
    --jq '"### \(.title) ([#\(.number)](\(.url)))\n\n\(.body // "")"' \
    | grep -v -e '^🤖 Generated with' -e '^Co-Authored-By:' -e '^https://claude.ai/code/session_' \
    | sed -E '3,$ s/^#{1,6} /#### /'
  echo
done

echo "### Commits"
echo
git log --no-merges --format='- %s (%h)' "$range"
