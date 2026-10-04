#!/usr/bin/env bash
# Creates (or replaces) the three demo organisations, their access codes and their scenes.
# Usage: spacetime/seed-orgs.sh <server> <database>      e.g.  spacetime/seed-orgs.sh maincloud pss-studio-mhacks
# Must be run by the identity that published the module (the admin reducer rejects everyone else).
# The codes are generated on the first run and kept OUTSIDE the repo, in
#   ~/.config/pss-studio/org-codes-<database>.env   (mode 600)
# Run it again to re-apply the same codes; delete that file first to rotate them.
set -euo pipefail
server=${1:?server nickname, e.g. local or maincloud}
database=${2:?database name}
codes="$HOME/.config/pss-studio/org-codes-$database.env"

if [ ! -f "$codes" ]; then
  mkdir -p "$(dirname "$codes")"
  code() { openssl rand -hex 6 | tr 'a-f' 'A-F' | sed 's/\(....\)\(....\)\(....\)/\1-\2-\3/'; }
  umask 077
  printf 'PSS_CODE_NASA=%s\nPSS_CODE_SPACEX=%s\nPSS_CODE_CONTROL=%s\n' "$(code)" "$(code)" "$(code)" > "$codes"
  echo "generated new access codes in $codes"
fi
# shellcheck disable=SC1090
. "$codes"

seed() { spacetime call --server "$server" "$database" admin_set_organisation "\"$1\"" "\"$2\"" "\"$3\"" "$4" > /dev/null; echo "  $2 -> $4"; }
seed nasa-mars-2020  "NASA Mars 2020 science team" "$PSS_CODE_NASA"    '["mars-hero-01"]'
seed spacex-lunar    "SpaceX lunar landing team"   "$PSS_CODE_SPACEX"  '["moon-malapert-01"]'
seed mission-control "Mission control (demo)"      "$PSS_CODE_CONTROL" '["mars-hero-01","moon-malapert-01"]'
echo "codes are in $codes"
