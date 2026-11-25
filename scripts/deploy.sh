#!/usr/bin/env bash
# RE: pattern from lgweb-pipelines/scripts/deploy.sh (git archive HEAD -> lgweb-apps, docker compose, Caddy site with validate+rollback)
# Usage: scripts/deploy.sh   (refuses a dirty tree or a red gate; secrets are written to the server once, never via git)
set -euo pipefail
cd "$(dirname "$0")/.."
# Git Bash on Windows rewrites standalone "/srv/..." arguments into C:/Program Files/Git/...; switch that off for ssh/scp.
export MSYS2_ARG_CONV_EXCL="*"
HOST=lgweb-apps
REMOTE=/srv/docs-demo
SITE=docs-demo.lgweb.work

if [ -n "$(git status --porcelain)" ]; then
  echo "REFUSED: working tree is dirty (commit or stash first):" >&2
  git status --short >&2
  exit 1
fi

# Local gate (tests need the dev pgvector container on 127.0.0.1:54329).
docker compose -f compose.dev.yml up -d --wait db
pnpm gate

SHA=$(git rev-parse HEAD)
echo "== deploying $SHA"

# First deploy only: write /srv/docs-demo/.env on the server (chmod 600) from the local key store.
if ! ssh "$HOST" "test -f $REMOTE/.env"; then
  echo "== writing $REMOTE/.env (first deploy)"
  ssh "$HOST" "mkdir -p $REMOTE/data"
  KEY=$(unset MSYS2_ARG_CONV_EXCL; keyget ANTHROPIC_API_KEY | tr -d '\r\n')
  [ -n "$KEY" ] || { echo "keyget returned an empty ANTHROPIC_API_KEY" >&2; exit 1; }
  printf '%s' "$KEY" | ssh "$HOST" "umask 077; { printf 'ANTHROPIC_API_KEY='; cat; printf '\nPOSTGRES_PASSWORD=%s\n' \"\$(openssl rand -hex 24)\"; } > $REMOTE/.env"
fi

ssh "$HOST" "mkdir -p $REMOTE/app.new $REMOTE/data && rm -rf $REMOTE/app.new/* && test -f $REMOTE/.env"
git archive HEAD | ssh "$HOST" "tar -x -C $REMOTE/app.new"
scp -q deploy/compose.yml "$HOST:$REMOTE/compose.yml"
scp -q deploy/$SITE.caddy "$HOST:$REMOTE/$SITE.caddy"

ssh "$HOST" "bash -s -- $REMOTE $SHA $SITE" <<'REMOTE_SCRIPT'
set -euo pipefail
REMOTE=$1; SHA=$2; SITE=$3
cd "$REMOTE"
chmod 600 .env
rm -rf app.old
[ -d app ] && mv app app.old
mv app.new app
export GIT_SHA=$SHA
DC="docker compose -p docs-demo -f compose.yml"
$DC up -d --build
# Idempotent corpus ingest (skips when the corpus hash is unchanged). Same hardened image, no published ports.
$DC run --rm -T --no-deps app node_modules/.bin/tsx scripts/ingest.ts </dev/null   # </dev/null: otherwise docker eats the rest of this ssh-fed script
# Drop older images of THIS app only.
docker images docs-demo-app --format '{{.Tag}}' | grep -v "^$SHA$" | xargs -r -I{} docker rmi docs-demo-app:{} || true

# Caddy: only our own site file is added; every other site is untouched.
mkdir -p /etc/caddy/sites
if ! cmp -s "$SITE.caddy" "/etc/caddy/sites/$SITE.caddy" 2>/dev/null; then
  BAK=/etc/caddy/Caddyfile.bak-$(date +%s)
  cp /etc/caddy/Caddyfile "$BAK"
  cp "$SITE.caddy" "/etc/caddy/sites/$SITE.caddy"
  if caddy validate --config /etc/caddy/Caddyfile; then
    systemctl reload caddy
  else
    echo "caddy validate FAILED - restoring" >&2
    cp "$BAK" /etc/caddy/Caddyfile
    rm -f "/etc/caddy/sites/$SITE.caddy"
    exit 1
  fi
fi
REMOTE_SCRIPT

echo "== waiting for healthz"
got=""
for i in $(seq 1 40); do
  got=$(curl -fsS "https://$SITE/healthz" 2>/dev/null || true)
  if echo "$got" | grep -q "\"sha\":\"$SHA\""; then echo "OK $got"; exit 0; fi
  sleep 3
done
echo "healthz did not report $SHA (last: $got)" >&2
exit 1
