#!/usr/bin/env bash
# Crea labels, milestones y todas las issues del roadmap en GitHub.
# Requisitos: GitHub CLI (gh) autenticado y el repo ya creado.
# Uso:  bash scripts/create-issues.sh
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "Necesitas GitHub CLI: https://cli.github.com (gh auth login)"
  exit 1
fi

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
echo "Repo: $REPO"

echo "== Creando labels =="
for spec in "type:feat" "type:bug" "type:spike" "type:docs" \
            "area:core" "area:infra" "area:projects" "area:editor" "area:git" \
            "area:terminal" "area:plugins" "area:settings" "area:ai" \
            "priority:high" "priority:medium" "priority:low"; do
  gh label create "$spec" --repo "$REPO" --force >/dev/null
done

echo "== Creando milestones =="
cut -f1 scripts/issues.tsv | sort -u | while read -r sprint; do
  [ -z "$sprint" ] && continue
  if ! gh api "repos/$REPO/milestones" --jq '.[].title' | grep -qx "$sprint"; then
    gh api "repos/$REPO/milestones" -f title="$sprint" --jq '.title' >/dev/null
    echo "  milestone: $sprint"
  fi
done

echo "== Creando issues =="
while IFS=$'\t' read -r sprint title labels body; do
  [ -z "$title" ] && continue
  gh issue create --repo "$REPO" --title "$title" --body "$body" \
      --label "$labels" --milestone "$sprint" >/dev/null
  echo "  issue: $title"
done < scripts/issues.tsv

echo "Listo. Revisa: https://github.com/$REPO/milestones"
