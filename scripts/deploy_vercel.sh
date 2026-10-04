#!/usr/bin/env bash
# Builds the Vercel deployment of Planetary Scene Studio, and uploads it only when asked.
#
#   scripts/deploy_vercel.sh            dry run: build everything into .vercel-stage/, check it, upload nothing
#   scripts/deploy_vercel.sh --serve    dry run, then serve the result on http://localhost:8100 (a local stand-in)
#   scripts/deploy_vercel.sh --deploy   dry run, then set the secrets on Vercel and deploy to production
#
# What is deployed: the built viewer and two scene bundles as static files, plus ONE Python function
# (apps/backend/vercel_app.py) for the Grok routes under /api. All 3D runs in the visitor's browser and the shared
# session goes straight from the browser to SpacetimeDB. Before --deploy, run `npx vercel login` once yourself.
#
# Settings (environment): ORG_CODES (file with the organisations' sign-in codes, which also unlock Grok),
# TEAM_CODE (the extra team passcode for the Grok routes; else read from deploy/vercel/.env.deploy,
# else made up and saved there), VERCEL_PROJECT (default planetary-scene-studio), BACKEND (default http://127.0.0.1:8000,
# used once to compute the prepared searches), SKIP_SEARCH=1 (ship without prepared searches), PORT (--serve, 8100),
# VERCEL_BUILD=1 (also run Vercel's own builder locally on the result, as a check; needs no login).
set -euo pipefail

MODE=${1:-dry-run}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
STAGE=$ROOT/.vercel-stage
CONFIG=$ROOT/deploy/vercel
SCENES_SRC=$ROOT/scenes
SCENES=(mars-hero-01 moon-malapert-01)
DEFAULT_SCENE=mars-hero-01
BACKEND=${BACKEND:-http://127.0.0.1:8000}
PROJECT=${VERCEL_PROJECT:-planetary-scene-studio}
PY=$ROOT/apps/backend/.venv/bin/python
MAX_UPLOAD_MB=100 # Hobby plan: what one CLI deployment may upload (vercel.com/docs/limits)

say() { printf '\n== %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
# One value from a dotenv file on stdout, with no newline. Only ever piped or captured, never shown.
dotenv_value() { "$PY" -c 'import sys; from dotenv import dotenv_values; sys.stdout.write(dotenv_values(sys.argv[1]).get(sys.argv[2]) or "")' "$1" "$2"; }

case $MODE in dry-run | --serve | --deploy) ;; *) die "unknown option $MODE (use --serve or --deploy, or nothing for a dry run)" ;; esac
[ -x "$PY" ] || die "no backend venv at $PY"

say "1/6 Stage folder: $STAGE"
mkdir -p "$STAGE"
printf '*\n' >"$STAGE/.gitignore" # never committed
find "$STAGE" -mindepth 1 -maxdepth 1 ! -name .vercel ! -name .gitignore -exec rm -rf {} + # .vercel keeps the project link

say "2/6 Function: apps/backend/vercel_app.py and the modules it uses"
cp "$ROOT/apps/backend/vercel_app.py" "$STAGE/app.py"
cp "$ROOT"/apps/backend/{intents,render,voice,xai,settings}.py "$STAGE/"
cp "$CONFIG/vercel.json" "$CONFIG/requirements.txt" "$STAGE/"
printf '3.12\n' >"$STAGE/.python-version"
for scene in "${SCENES[@]}"; do # the function only needs each scene's name and body, for the prompt
  mkdir -p "$STAGE/scene_facts/$scene"
  cp -L "$SCENES_SRC/$scene/scene.json" "$STAGE/scene_facts/$scene/"
done

say "3/6 Viewer: typecheck, then vite build in same-origin mode"
(
  cd "$ROOT/apps/web"
  npx tsc --noEmit
  VITE_SAME_ORIGIN=1 VITE_DEFAULT_SCENE=$DEFAULT_SCENE VITE_BACKEND_URL= npx vite build --outDir "$STAGE/public" --emptyOutDir
)

say "4/6 Scenes: ${SCENES[*]}"
for scene in "${SCENES[@]}"; do
  [ -f "$SCENES_SRC/$scene/scene.json" ] || die "scene $scene not found in $SCENES_SRC"
  mkdir -p "$STAGE/public/scenes/$scene"
  # terrain_texture_gray.jpg is an export by-product the viewer never loads.
  rsync -aL --exclude terrain_texture_gray.jpg "$SCENES_SRC/$scene/" "$STAGE/public/scenes/$scene/"
done

say "5/6 Prepared searches (the deployment cannot run the CLIP text search itself)"
mkdir -p "$STAGE/public/search"
if [ "${SKIP_SEARCH:-}" = 1 ]; then
  echo "skipped (SKIP_SEARCH=1): the deployed search box will offer no searches"
else
  for scene in "${SCENES[@]}"; do
    [ -f "$SCENES_SRC/$scene/clusters.json" ] || { echo "$scene: no clusters, no search"; continue; }
    "$PY" - "$BACKEND" "$scene" "$CONFIG/search_phrases.txt" "$STAGE/public/search/$scene.json" <<'PYEOF' ||
import json, sys
import httpx
backend, scene, phrases_file, out = sys.argv[1:]
answers = []
for phrase in filter(None, (line.strip() for line in open(phrases_file))):
    response = httpx.post(f"{backend}/query", json={"scene_id": scene, "text": phrase}, timeout=180)
    response.raise_for_status()
    body = response.json()
    answers.append({"text": phrase, "cluster_ids": body["cluster_ids"], "explanation": body["explanation"]})
    print(f"  {scene}: {phrase!r} -> {len(body['cluster_ids'])} clusters")
json.dump(answers, open(out, "w"))
PYEOF
      die "could not compute the prepared searches: the local backend must be running at $BACKEND (or pass SKIP_SEARCH=1)"
  done
fi

say "6/6 Checks"
ENV_LOCAL=$ROOT/apps/web/.env.local
for name in VITE_SPACETIME_URI VITE_SPACETIME_MODULE; do
  value=$(dotenv_value "$ENV_LOCAL" "$name")
  [ -n "$value" ] || die "$name is not set in apps/web/.env.local, so the build has no shared session"
  grep -rqF -- "$value" "$STAGE/public/assets" || die "$name ($value) is not in the built bundle"
  echo "shared session: $name=$value is in the bundle"
done
grep -rqF 'VITE_SAME_ORIGIN' "$STAGE/public/assets" && die "VITE_SAME_ORIGIN was not replaced at build time" || true
# The xAI key must be in no file that is uploaded. The scan reads the key from .env itself and prints only a verdict.
"$PY" - "$ROOT/apps/backend/.env" "$STAGE" <<'PYEOF'
import pathlib, sys
from dotenv import dotenv_values
key = (dotenv_values(sys.argv[1]).get("XAI_API_KEY") or "").encode()
stage = pathlib.Path(sys.argv[2])
bad = [p for p in stage.rglob("*") if p.is_file() and (p.name.startswith(".env") or (key and key in p.read_bytes()))]
if bad:
    sys.exit(f"ERROR: secret material would be uploaded: {[str(p.relative_to(stage)) for p in bad]}")
print("secrets: no .env file and no xAI key anywhere in the stage folder" + ("" if key else " (no key in apps/backend/.env to look for)"))
PYEOF
(cd "$STAGE" && TEAM_CODE=check PYTHONDONTWRITEBYTECODE=1 "$PY" -c 'import app; print("function: app.py imports;", len(app.app.routes), "routes")')
files=$(find "$STAGE" -type f ! -path "$STAGE/.vercel/*" | wc -l)
total_mb=$(du -sm --exclude=.vercel "$STAGE" | cut -f1)
function_kb=$(du -sk --exclude=.vercel --exclude=public "$STAGE" | cut -f1)
echo "size: $files files, $total_mb MB to upload (Hobby limit $MAX_UPLOAD_MB MB); function source $function_kb KB before dependencies"
echo "largest files:"
find "$STAGE/public" -type f -printf '%s %P\n' | sort -rn | head -5 | awk '{ printf "  %6.1f MB  %s\n", $1 / 1e6, $2 }'
[ "$total_mb" -lt "$MAX_UPLOAD_MB" ] || die "the deployment is $total_mb MB, over the $MAX_UPLOAD_MB MB upload limit"
if [ "${VERCEL_BUILD:-}" = 1 ]; then
  # Optional: let Vercel's own builder (local, no login, nothing uploaded) build a copy without the big scene files.
  CHECK=$(mktemp -d)
  rsync -a --exclude .vercel --exclude 'public/scenes/*/*.bin' --exclude 'public/scenes/*/*.spz' "$STAGE/" "$CHECK/"
  mkdir "$CHECK/.vercel"
  printf '{"projectId":"prj_dryrun","orgId":"team_dryrun","settings":{"framework":"fastapi"}}' >"$CHECK/.vercel/project.json"
  (cd "$CHECK" && npx --yes vercel build --prod </dev/null >"$CHECK/build.log" 2>&1) || { tail -20 "$CHECK/build.log"; die "vercel build failed"; }
  "$PY" - "$CHECK/.vercel/output" <<'PYEOF'
import json, os, sys
out = sys.argv[1]
config = json.load(open(f"{out}/functions/fastapi.func/.vc-config.json"))
files = config["filePathMap"]
assert not any(name.startswith("public/") for name in files), "static files leaked into the function"
assert os.path.isfile(f"{out}/static/index.html"), "index.html is not a static file"
mb = sum(os.path.getsize(os.path.join(out, "..", "..", path)) for path in files.values()) / 1e6
print(f"vercel build: ok. One function ({config['runtime']}, maxDuration {config['maxDuration']} s, {mb:.0f} MB of 500 MB), static files separate")
PYEOF
  rm -rf "$CHECK"
fi

if [ "$MODE" = dry-run ]; then
  say "Dry run finished. Nothing was uploaded."
  echo "Try it locally:  scripts/deploy_vercel.sh --serve     Deploy:  npx vercel login && scripts/deploy_vercel.sh --deploy"
  exit 0
fi

# The team passcode: from the environment, else deploy/vercel/.env.deploy (git-ignored), else a new one saved there.
TEAM_CODE=${TEAM_CODE:-$(dotenv_value "$CONFIG/.env.deploy" TEAM_CODE)}
if [ -z "$TEAM_CODE" ]; then
  TEAM_CODE=$("$PY" -c 'import secrets; print("mars-" + secrets.token_hex(3))')
  printf 'TEAM_CODE=%s\n' "$TEAM_CODE" >"$CONFIG/.env.deploy"
  echo "made a new team passcode and saved it in deploy/vercel/.env.deploy"
fi
# One code per person: each organisation's sign-in code (checked by SpacetimeDB) must also unlock the Grok routes,
# so the server gets them all as one comma-separated list. The codes file lives outside the repo.
ORG_CODES=${ORG_CODES:-$HOME/.config/pss-studio/org-codes-pss-studio-mhacks.env}
GROK_CODES=$TEAM_CODE
if [ -f "$ORG_CODES" ]; then
  for name in PSS_CODE_NASA PSS_CODE_SPACEX PSS_CODE_CONTROL; do
    code=$(dotenv_value "$ORG_CODES" "$name")
    [ -n "$code" ] && GROK_CODES="$GROK_CODES,$code"
  done
  echo "Grok accepts the team passcode and the organisation sign-in codes from $ORG_CODES ($(printf '%s' "$GROK_CODES" | tr -cd , | wc -c) of 3 found)"
else
  echo "no organisation codes file at $ORG_CODES: Grok accepts only the team passcode"
fi
[ -n "$(dotenv_value "$ROOT/apps/backend/.env" XAI_API_KEY)" ] || die "XAI_API_KEY is not set in apps/backend/.env"

if [ "$MODE" = --serve ]; then
  say "Serving the staged deployment on http://localhost:${PORT:-8100} (Ctrl+C to stop). Team passcode: $TEAM_CODE"
  cd "$STAGE"
  XAI_API_KEY=$(dotenv_value "$ROOT/apps/backend/.env" XAI_API_KEY) TEAM_CODE=$GROK_CODES STAGE=$STAGE \
    exec "$PY" -m uvicorn --app-dir "$CONFIG" serve_local:app --host 127.0.0.1 --port "${PORT:-8100}"
fi

say "Deploying to Vercel project $PROJECT"
cd "$STAGE"
npx --yes vercel whoami >/dev/null || die "not logged in: run  npx vercel login  yourself, then run this again"
npx --yes vercel project add "$PROJECT" >/dev/null 2>&1 || true # no-op when it already exists
npx --yes vercel link --yes --project "$PROJECT"
# Secrets go from the file straight into the CLI's stdin: they are never arguments and never printed.
dotenv_value "$ROOT/apps/backend/.env" XAI_API_KEY | npx --yes vercel env add XAI_API_KEY production --force
printf '%s' "$GROK_CODES" | npx --yes vercel env add TEAM_CODE production --force
npx --yes vercel deploy --prod --yes
say "Deployed. Share the production address above (https://$PROJECT.vercel.app unless the name was taken)."
echo "Team passcode for Grok chat, voice and concept renders: $TEAM_CODE"
