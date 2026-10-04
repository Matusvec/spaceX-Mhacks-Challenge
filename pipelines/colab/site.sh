#!/usr/bin/env bash
# Train the multi-stop dataset on a Colab VM over SSH, with live progress in the browser.
#
#   pipelines/colab/site.sh connect   # one SSH connection + port forwards
#   pipelines/colab/site.sh push      # rsync the dataset to the VM
#   pipelines/colab/site.sh start     # gsplat MCMC, detached, plus TensorBoard
#   pipelines/colab/site.sh status    # step, loss, latest eval metrics
#   pipelines/colab/site.sh pull      # stats, ply, last checkpoint -> runs/<run>/
#
# Watch while it trains:
#   http://localhost:6006   TensorBoard: loss, Gaussian count, PSNR; Images tab: ground truth | render at each eval
#   http://localhost:8090   gsplat viewer: fly through the splat as it forms (stays up after the last step)
#
# Unlike launch.sh this never touches the Jupyter kernel, so it works while another agent
# holds it, and the run survives this laptop disconnecting. Colab allows ONE ssh session
# per VM: every command here multiplexes over the `connect` socket.
#
# Needs a passphrase-less key (colab ssh cannot unlock one):
#   ssh-keygen -t ed25519 -N "" -f ~/.ssh/colab_pss
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SESSION="${COLAB_SESSION:-pss-splat}"
KEY="${PSS_SSH_KEY:-$HOME/.ssh/colab_pss}"
DATA="${PSS_DATA:-$ROOT/data/colmap/cheyava_site}"
RUN="${PSS_RUN:-cheyava-site}"
MAX_STEPS="${PSS_MAX_STEPS:-30000}"
CAP_MAX="${PSS_CAP_MAX:-1500000}"
SH_DEGREE="${PSS_SH_DEGREE:-0}"   # view-dependent colour would bake each stop's lighting into the direction it was seen from
REMOTE=/content/pss_site
RDATA="$REMOTE/$(basename "$DATA")"   # each dataset keeps its own folder on the VM, so a new one never changes under a running job
INIT_SCALE=0.5       # Gaussian size against point spacing. The MCMC preset's 0.1 leaves this evenly spaced cloud full of gaps
DEPTH_FLOOR_M=0.5
NEEDLE="${PSS_NEEDLE:-1}"         # weight of the needle penalty (vm_patch_trainer.py); 0 turns it off
# Per-image colour grid in the trainer. PSS_BILAGRID=0 for a dataset whose frames were already
# brought to one exposure (pipelines/data/colour.py): then nothing lets the splat's colours drift.
GRID="--post-processing bilateral_grid --use-color-correction-metric"
[[ "${PSS_BILAGRID:-1}" == "0" ]] && GRID=""
NEEDLE_RATIO="${PSS_NEEDLE_RATIO:-2}"   # longest axis allowed, as a multiple of the middle one
# Positions start on the stereo surface, which is good to a few cm: let them move ten times slower
# than gsplat's default, and weigh the stereo depth ten times more.
EXTRA="${PSS_EXTRA:---means-lr 1.6e-5 --depth-lambda 0.1}"
VIEWER_PORT="${PSS_VIEWER_PORT:-8090}"   # not 8080: Colab's own Jupyter server has it on the VM
# gsplat compiles its CUDA kernels on first import. The 3DGUT kernels alone take over half an
# hour and this run does not use them, so build without them, in a cache of our own: importing
# gsplat with different build settings in the default cache would wipe another agent's build.
# An SSH shell also lacks the GPU library paths the notebook kernel gets; without them torch sees no CUDA.
GPU_ENV="LD_LIBRARY_PATH=/usr/lib64-nvidia LIBRARY_PATH=/usr/local/cuda/lib64/stubs PATH=/opt/bin:/usr/local/nvidia/bin:/usr/local/cuda/bin:\$PATH"
VM_ENV="$GPU_ENV TORCH_EXTENSIONS_DIR=$REMOTE/torch_ext BUILD_3DGUT=0"
SOCK="${XDG_RUNTIME_DIR:-/tmp}/pss-colab-$SESSION.sock"
SSH=(ssh -S "$SOCK" -o BatchMode=yes -o LogLevel=ERROR root@"$SESSION")

cmd_connect() {
  if ssh -S "$SOCK" -O check root@"$SESSION" 2>/dev/null; then
    echo "already connected"
    return
  fi
  [[ -f "$KEY" ]] || { echo "no key at $KEY (see the header of this script)"; exit 2; }
  ssh -M -S "$SOCK" -f -N -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ExitOnForwardFailure=no \
    -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ServerAliveInterval=30 \
    -o ProxyCommand="colab --auth=oauth2 ssh --proxy-mode -s $SESSION -i $KEY" \
    -L 6006:localhost:6006 -L $VIEWER_PORT:localhost:$VIEWER_PORT root@"$SESSION"
  echo "connected. TensorBoard http://localhost:6006  viewer http://localhost:$VIEWER_PORT"
}

cmd_push() {
  cmd_connect
  "${SSH[@]}" "mkdir -p $RDATA"
  rsync -az --delete --info=stats1 -e "ssh -S $SOCK -o BatchMode=yes" "$DATA/" root@"$SESSION":$RDATA/
}

cmd_start() {
  cmd_connect
  # Evaluate often early on, so there is something to look at within the first minutes.
  local evals="1000 2000 4000 7000 10000 15000 20000 25000 $MAX_STEPS"
  "${SSH[@]}" "mkdir -p $REMOTE/runs/$RUN"
  rsync -az -e "ssh -S $SOCK -o BatchMode=yes" "$ROOT"/pipelines/colab/vm_*.py root@"$SESSION":$REMOTE/
  "${SSH[@]}" bash -s <<EOF
set -e
cd /content/gsplat/examples
if pgrep -f "site_trainer.py.*$REMOTE/runs/$RUN" >/dev/null; then echo "run $RUN is already training"; exit 0; fi
pkill -f "vm_sheets.py $REMOTE/runs/$RUN" || true
# A run that died before its first checkpoint leaves only noise for TensorBoard: clear it.
ls $REMOTE/runs/$RUN/ckpts/*.pt >/dev/null 2>&1 || rm -rf $REMOTE/runs/$RUN
mkdir -p $REMOTE/runs/$RUN
# Private, patched copy of the trainer (depth floor, needle penalty): see vm_patch_trainer.py.
python3 $REMOTE/vm_patch_trainer.py simple_trainer.py $REMOTE/site_trainer.py
pgrep -f "tensorboard.*$REMOTE/runs" >/dev/null || nohup tensorboard --logdir $REMOTE/runs --port 6006 --reload_interval 15 >$REMOTE/tensorboard.log 2>&1 </dev/null &
# Metric east-north-up in, metric east-north-up out: no world normalisation.
# No MCMC regularisers: a Gaussian here is seen by ~3% of the images, so between sightings
# the regulariser is its only gradient and Adam walks it to zero opacity. With them on, 80% of
# the Gaussians died every 100 steps and the splat turned to mush by step 4000.
# Depth loss: the stereo cloud. Pose opt: the last pixel between stops. Antialiased: Navcam
# and Mastcam-Z differ 20x in pixel scale. Bilateral grid: brightness differs by sol and stop.
$VM_ENV PSS_NEEDLE=$NEEDLE PSS_NEEDLE_RATIO=$NEEDLE_RATIO PSS_DEPTH_FLOOR=$DEPTH_FLOOR_M PYTHONPATH=/content/gsplat/examples PYTHONUNBUFFERED=1 nohup python3 $REMOTE/site_trainer.py mcmc \\
  --data-dir $RDATA --data-factor 1 --result-dir $REMOTE/runs/$RUN \\
  --no-normalize-world-space \\
  --max-steps $MAX_STEPS --strategy.cap-max $CAP_MAX --sh-degree $SH_DEGREE --init-scale $INIT_SCALE \\
  --depth-loss --pose-opt --antialiased --opacity-reg 0 --scale-reg 0 \\
  $GRID \\
  --eval-steps $evals --save-steps 7000 15000 $MAX_STEPS --save-ply --ply-steps 7000 15000 $MAX_STEPS \\
  --disable-video --tb-every 100 --port $VIEWER_PORT $EXTRA \\
  >$REMOTE/runs/$RUN/train.log 2>&1 </dev/null &
echo "started \$! -> $REMOTE/runs/$RUN/train.log"
nohup python3 $REMOTE/vm_sheets.py $REMOTE/runs/$RUN >$REMOTE/runs/$RUN/sheets.log 2>&1 </dev/null &
EOF
}

cmd_status() {
  cmd_connect >/dev/null
  "${SSH[@]}" bash -s <<EOF
cd $REMOTE/runs/$RUN 2>/dev/null || { echo "no run $RUN on the VM"; exit 1; }
if grep -q "Viewer running" train.log; then echo "state: done (viewer still up, GPU still held)"
elif pgrep -f "site_trainer.py.*$REMOTE/runs/$RUN" >/dev/null; then echo "state: training"
else echo "state: not running"; fi
tr '\\r' '\\n' <train.log | grep -E "loss=" | tail -1 | cut -c1-160
ls stats/val_step*.json 2>/dev/null | tail -1 | xargs -r sh -c 'echo "latest eval: \$0"; cat "\$0"; echo'
grep -E "loss=nan|Error|Traceback|CUDA out of memory" train.log | tail -3 | cut -c1-200
$GPU_ENV nvidia-smi --query-gpu=memory.used,utilization.gpu --format=csv,noheader
EOF
}

cmd_pull() {
  cmd_connect >/dev/null
  mkdir -p "$ROOT/runs/$RUN"
  # Everything but the eval PNGs (full-resolution pairs, hundreds of MB) and older checkpoints.
  rsync -az --info=stats1 -e "ssh -S $SOCK -o BatchMode=yes" \
    --include='stats/***' --include='sheets/***' --include='ply/***' --include="ckpts/" --include="ckpts/ckpt_$((MAX_STEPS - 1))_rank0.pt" \
    --include='cfg.yml' --include='train.log' --exclude='*' \
    root@"$SESSION":$REMOTE/runs/$RUN/ "$ROOT/runs/$RUN/"
  echo "local results: $ROOT/runs/$RUN"
}

case "${1:-}" in
  connect) cmd_connect ;;
  push) cmd_push ;;
  start) cmd_start ;;
  status) cmd_status ;;
  pull) cmd_pull ;;
  *) sed -n '2,12p' "$0"; exit 2 ;;
esac
