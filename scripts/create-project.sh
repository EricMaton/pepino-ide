#!/usr/bin/env bash
# Crea un GitHub Project (kanban) con las 70 issues del roadmap.
# Ejecutar DESPUES de create-issues.sh
# Uso:  bash scripts/create-project.sh
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "Necesitas GitHub CLI: https://cli.github.com"
  exit 1
fi

OWNER=$(gh api user --jq .login)
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)

echo "== Creando project board =="
URL=$(gh project create --owner "$OWNER" --title "🥒 Pepino Roadmap" --format board --description "Kanban del roadmap. Los sprints viven en los milestones.")
PROJECT_NUMBER=${URL##*/}
PROJECT_ID=$(gh project view "$PROJECT_NUMBER" --owner "$OWNER" --format json --jq .id)
echo "  Proyecto #$PROJECT_NUMBER: $URL"

echo "== Vinculando repo =="
REPO_ID=$(gh api "repos/$REPO" --jq .node_id)
gh api graphql -f query='mutation($p:ID!,$r:ID!){ linkProjectV2Repository(input:{projectId:$p, repositoryId:$r}){ clientMutationId } }' -f p="$PROJECT_ID" -f r="$REPO_ID" >/dev/null

echo "== Creando campo Status =="
gh api graphql -f query='mutation($p:ID!){ createProjectV2Field(input:{projectId:$p, dataType:SINGLE_SELECT, name:"Status", singleSelectOptions:[{name:"Todo",color:GRAY},{name:"En curso",color:BLUE},{name:"En revision",color:PURPLE},{name:"Hecho",color:GREEN}]}){ projectV2Field{ id } } }' -f p="$PROJECT_ID" >/dev/null

FL="gh project field-list $PROJECT_NUMBER --owner $OWNER --format json"
STATUS_FIELD_ID=$($FL --jq '.fields[] | select(.name=="Status") | .id')
TODO_ID=$($FL --jq '.fields[] | select(.name=="Status") | .options[] | select(.name=="Todo") | .id')

echo "== Anadiendo issues al board =="
gh issue list --repo "$REPO" --limit 100 --json url --jq '.[].url' | while read -r url; do
  gh project item-add "$PROJECT_NUMBER" --owner "$OWNER" --url "$url" >/dev/null
done

echo "== Poniendo todo en Todo =="
gh project item-list "$PROJECT_NUMBER" --owner "$OWNER" --limit 100 --format json --jq '.items[].id' | while read -r item; do
  gh api graphql -f query='mutation($p:ID!,$i:ID!,$f:ID!,$v:ID!){ updateProjectV2ItemFieldValue(input:{projectId:$p, itemId:$i, fieldId:$f, value:{singleSelectOptionId:$v}}){ clientMutationId } }' -f p="$PROJECT_ID" -f i="$item" -f f="$STATUS_FIELD_ID" -f v="$TODO_ID" >/dev/null
done

echo ""
echo "Listo: $URL"
echo "Consejo: en el proyecto, Settings -> auto-add workflow para $REPO"
