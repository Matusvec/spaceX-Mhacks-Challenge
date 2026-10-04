#!/usr/bin/env bash
# Drive a Colab GPU from this repo. Never starts login.
# See docs/colab-cli.md.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SESSION="${COLAB_SESSION:-pss-splat}"
GPU="${COLAB_GPU:-A100}"
DATA="${PSS_DATA:-$ROOT/data/colmap/cheyava_s56d0}"
RUN="${PSS_RUN:-cheyava-quick}"
MAX_STEPS="${PSS_MAX_STEPS:-7000}"
CAP_MAX="${PSS_CAP_MAX:-500000}"
DATA_FACTOR="${PSS_DATA_FACTOR:-4}"
SH_DEGREE="${PSS_SH_DEGREE:-1}"
TOKEN="${COLAB_TOKEN:-$HOME/.config/colab-cli/token.json}"
ADC="${COLAB_ADC:-$HOME/.config/gcloud/application_default_credentials.json}"
PART_BYTES=8000000
AUTH=()

need_colab() {
  if ! command -v colab >/dev/null 2>&1; then
    echo "colab is not on PATH. Install it, then rerun check:"
    echo "  uv tool install google-colab-cli"
    exit 2
  fi
}

print_login() {
  echo "This script will not open a browser or read a code."
  echo "In the terminal where gcloud is waiting, press Ctrl-C, then run:"
  echo "  gcloud auth application-default login --no-launch-browser \\"
  echo "    --scopes=openid,https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/userinfo.email,https://www.googleapis.com/auth/colaboratory"
  echo "Open the URL it prints, then paste the browser code into that same terminal."
  echo "Then rerun: pipelines/colab/launch.sh ${1:-check}"
}

need_token() {
  need_colab
  if [[ -f "$TOKEN" ]]; then
    AUTH=(--auth=oauth2)
    return
  fi
  if [[ -f "$ADC" ]]; then
    AUTH=(--auth=adc)
    return
  fi
  echo "No Colab credentials at $TOKEN or $ADC."
  print_login "$1"
  exit 2
}

py_quote() {
  python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1"
}

cmd_check() {
  need_colab
  echo "colab: $(command -v colab)"
  colab version
  if [[ -f "$TOKEN" ]]; then
    echo "auth: oauth2 ($TOKEN)"
    colab --auth=oauth2 sessions
  elif [[ -f "$ADC" ]]; then
    echo "auth: adc ($ADC)"
    colab --auth=adc sessions
  else
    echo "auth: missing"
    print_login check
    exit 2
  fi
}

cmd_session() {
  need_token session
  # `colab status` exits 0 even when the session does not exist, so read what it says.
  if ! colab "${AUTH[@]}" status -s "$SESSION" 2>&1 | grep -q "not found"; then
    echo "session $SESSION already up"
    colab "${AUTH[@]}" status -s "$SESSION"
    return
  fi
  if colab "${AUTH[@]}" new -s "$SESSION" --gpu "$GPU" --high-mem; then
    return
  fi
  echo "Could not allocate ${GPU} high-RAM. Retrying ${GPU} without high-RAM."
  if colab "${AUTH[@]}" new -s "$SESSION" --gpu "$GPU"; then
    return
  fi
  echo "Could not allocate ${GPU}. Retrying a T4."
  colab "${AUTH[@]}" new -s "$SESSION" --gpu T4
}

remote_exec() {
  local timeout="$1"
  local src="$2"
  colab "${AUTH[@]}" exec -s "$SESSION" --timeout "$timeout" -f "$src"
}

cmd_upload() {
  need_token upload
  if [[ ! -d "$DATA/images" || ! -d "$DATA/sparse" ]]; then
    echo "COLMAP tree not found at $DATA (need images/ and sparse/)."
    exit 2
  fi
  local stage part_dir n
  stage="$(mktemp -d)"
  # -h: images/ holds symlinks into data/raw; ship the files. database.db is only needed locally.
  tar -C "$DATA" -h --exclude=./database.db -czf "$stage/colmap.tgz" .
  split -b "$PART_BYTES" -d -a 3 "$stage/colmap.tgz" "$stage/part."
  n="$(find "$stage" -name 'part.*' | wc -l)"
  echo "uploading $n parts from $DATA"
  remote_exec 120 <(printf '%s\n' 'import os; os.makedirs("/content/pss/upload", exist_ok=True); print("ready")')
  for part in "$stage"/part.*; do
    colab "${AUTH[@]}" upload -s "$SESSION" "$part" "/content/pss/upload/$(basename "$part")"
  done
  part_dir="/content/pss/upload"
  remote_exec 600 <(
    cat <<PY
import glob, os, tarfile
parts = sorted(glob.glob("$part_dir/part.*"))
blob = "/content/pss/colmap.tgz"
with open(blob, "wb") as out:
    for part in parts:
        with open(part, "rb") as fh:
            out.write(fh.read())
os.makedirs("/content/pss/colmap", exist_ok=True)
with tarfile.open(blob, "r:gz") as tar:
    tar.extractall("/content/pss/colmap")
print("PSS_UPLOAD", len(os.listdir("/content/pss/colmap/images")), "images")
PY
  )
  rm -rf "$stage"
}

cmd_train() {
  need_token train
  local src
  src="$(mktemp --suffix .py)"
  {
    echo "import os"
    echo "os.environ['PSS_DATA_DIR'] = $(py_quote /content/pss/colmap)"
    echo "os.environ['PSS_RESULT_DIR'] = $(py_quote "/content/pss/runs/$RUN")"
    echo "os.environ['PSS_LOG'] = $(py_quote "/content/pss/logs/$RUN.csv")"
    echo "os.environ['PSS_DATA_FACTOR'] = $(py_quote "$DATA_FACTOR")"
    echo "os.environ['PSS_MAX_STEPS'] = $(py_quote "$MAX_STEPS")"
    echo "os.environ['PSS_CAP_MAX'] = $(py_quote "$CAP_MAX")"
    echo "os.environ['PSS_SH_DEGREE'] = $(py_quote "$SH_DEGREE")"
    cat "$ROOT/pipelines/colab/remote_train.py"
  } >"$src"
  # Silence budget, not a wall clock. The trainer prints every step.
  remote_exec 28800 "$src"
  rm -f "$src"
}

cmd_pull() {
  need_token pull
  local dest stage src kind name count i part
  dest="$ROOT/runs/$RUN"
  mkdir -p "$dest"
  stage="$(mktemp -d)"
  src="$(mktemp --suffix .py)"
  cat >"$src" <<'PY'
import glob, os, shutil
out = "/content/pss/outbox"
shutil.rmtree(out, ignore_errors=True)
os.makedirs(out + "/files", exist_ok=True)
lines = []

def add(path, dest_name):
    size = os.path.getsize(path)
    if size <= 8_000_000:
        shutil.copy2(path, os.path.join(out, "files", dest_name))
        lines.append(f"file {dest_name}")
        return
    n = 0
    os.makedirs(os.path.join(out, "parts", dest_name), exist_ok=True)
    with open(path, "rb") as fh:
        while True:
            blob = fh.read(8_000_000)
            if not blob:
                break
            with open(os.path.join(out, "parts", dest_name, f"{n:03d}"), "wb") as part:
                part.write(blob)
            n += 1
    lines.append(f"join {dest_name} {n}")

for path in sorted(glob.glob("/content/pss/logs/*.csv")):
    add(path, os.path.basename(path))
ckpts = sorted(glob.glob("/content/pss/runs/*/ckpts/*.pt"))
if ckpts:
    add(ckpts[-1], os.path.basename(ckpts[-1]))
plys = sorted(glob.glob("/content/pss/runs/*/ply/*.ply"))
if plys:
    add(plys[-1], os.path.basename(plys[-1]))
if not lines:
    raise SystemExit("PSS_PULL nothing to download yet")
with open(out + "/manifest.txt", "w") as fh:
    fh.write("\n".join(lines) + "\n")
print("\n".join(lines))
PY
  remote_exec 300 "$src"
  rm -f "$src"
  colab "${AUTH[@]}" download -s "$SESSION" /content/pss/outbox/manifest.txt "$stage/manifest.txt"
  while read -r kind name count; do
    [[ -z "${kind:-}" ]] && continue
    if [[ "$kind" == "file" ]]; then
      colab "${AUTH[@]}" download -s "$SESSION" "/content/pss/outbox/files/$name" "$dest/$name"
    elif [[ "$kind" == "join" ]]; then
      : >"$dest/$name"
      for ((i = 0; i < count; i++)); do
        printf -v part "%03d" "$i"
        colab "${AUTH[@]}" download -s "$SESSION" "/content/pss/outbox/parts/$name/$part" "$stage/part"
        cat "$stage/part" >>"$dest/$name"
      done
    fi
  done <"$stage/manifest.txt"
  rm -rf "$stage"
  echo "local results: $dest"
}

cmd_stop() {
  need_token stop
  colab "${AUTH[@]}" stop -s "$SESSION"
}

usage() {
  echo "Usage: pipelines/colab/launch.sh {check|session|upload|train|pull|stop|all}"
  exit 2
}

case "${1:-check}" in
  check) cmd_check ;;
  session) cmd_session ;;
  upload) cmd_upload ;;
  train) cmd_train ;;
  pull) cmd_pull ;;
  stop) cmd_stop ;;
  all)
    cmd_session
    cmd_upload
    if cmd_train; then
      cmd_pull
      cmd_stop
    else
      echo "train failed. Session $SESSION is still up. Logs: colab ${AUTH[*]} log -s $SESSION"
      echo "Release it with: pipelines/colab/launch.sh stop"
      exit 1
    fi
    ;;
  *) usage ;;
esac
