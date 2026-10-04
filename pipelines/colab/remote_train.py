"""gsplat MCMC on the Colab VM.

`launch.sh train` sends this source with `colab exec -f` after prepending
environment assignments. The kernel's working directory is `/content`.
"""

import csv
import os
import re
import shutil
import subprocess
import sys

DATA_DIR = os.environ.get("PSS_DATA_DIR", "/content/pss/colmap")
RESULT_DIR = os.environ.get("PSS_RESULT_DIR", "/content/pss/runs/cheyava-quick")
LOG_PATH = os.environ.get("PSS_LOG", "/content/pss/logs/cheyava-quick.csv")
DATA_FACTOR = os.environ.get("PSS_DATA_FACTOR", "4")
MAX_STEPS = int(os.environ.get("PSS_MAX_STEPS", "7000"))
CAP_MAX = os.environ.get("PSS_CAP_MAX", "500000")
SH_DEGREE = os.environ.get("PSS_SH_DEGREE", "1")
REPO = os.environ.get("PSS_GSPLAT_REPO", "/content/gsplat")
DRIVE_ROOT = "/content/drive/MyDrive/pss"

LOSS_RE = re.compile(r"loss=([0-9.eE+-]+)")
STEP_RE = re.compile(r"(\d+)\s*/\s*\d+")


def sparse_has_points(data_dir):
    sparse = os.path.join(data_dir, "sparse", "0")
    for name in ("points3D.bin", "points3D.txt"):
        path = os.path.join(sparse, name)
        if os.path.isfile(path) and os.path.getsize(path) > 64:
            return True
    return False


def drive_copy(path):
    if not os.path.isdir("/content/drive/MyDrive"):
        return
    rel = os.path.relpath(path, "/content/pss")
    dest = os.path.join(DRIVE_ROOT, rel)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.copy2(path, dest)
    print(f"PSS_DRIVE {dest}", flush=True)


def ensure_repo():
    trainer = os.path.join(REPO, "examples", "simple_trainer.py")
    if not os.path.isfile(trainer):
        subprocess.check_call(
            [
                "git",
                "clone",
                "--depth",
                "1",
                "https://github.com/nerfstudio-project/gsplat.git",
                REPO,
            ]
        )
    # The example imports datasets/, utils.py, and gsplat.scene from this repo.
    subprocess.check_call(
        [sys.executable, "-m", "pip", "install", "-e", REPO],
    )


def save_steps(max_steps):
    marks = [2000, 5000, 7000, 15000, 30000]
    chosen = [s for s in marks if s < max_steps]
    chosen.append(max_steps)
    return chosen


def main():
    os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
    os.makedirs(RESULT_DIR, exist_ok=True)
    ensure_repo()

    steps = save_steps(MAX_STEPS)
    cmd = [
        sys.executable,
        "examples/simple_trainer.py",
        "mcmc",
        "--disable-viewer",
        "--disable-video",
        "--data-dir",
        DATA_DIR,
        "--result-dir",
        RESULT_DIR,
        "--data-factor",
        str(DATA_FACTOR),
        "--max-steps",
        str(MAX_STEPS),
        "--sh-degree",
        str(SH_DEGREE),
        "--strategy.cap-max",
        str(CAP_MAX),
        "--save-ply",
        "--save-steps",
        *[str(s) for s in steps],
        "--ply-steps",
        *[str(s) for s in steps],
    ]
    if sparse_has_points(DATA_DIR):
        cmd.append("--depth-loss")
        print("PSS_DEPTH on (sparse points found)", flush=True)
    else:
        print("PSS_DEPTH off (no sparse points yet)", flush=True)

    print("PSS_CMD " + " ".join(cmd), flush=True)
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"

    new_log = not os.path.exists(LOG_PATH) or os.path.getsize(LOG_PATH) == 0
    with open(LOG_PATH, "a", newline="") as log_file:
        writer = csv.writer(log_file)
        if new_log:
            writer.writerow(["step", "loss"])
            log_file.flush()
        proc = subprocess.Popen(
            cmd,
            cwd=REPO,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        pending = ""
        rows = 0
        assert proc.stdout is not None
        while True:
            blob = proc.stdout.read(4096)
            if blob == "":
                break
            sys.stdout.write(blob)
            sys.stdout.flush()
            pending += blob
            while "\n" in pending or "\r" in pending:
                cut = len(pending)
                for sep in ("\n", "\r"):
                    at = pending.find(sep)
                    if at != -1:
                        cut = min(cut, at)
                line = pending[:cut]
                pending = pending[cut + 1 :]
                loss = LOSS_RE.search(line)
                step = STEP_RE.search(line)
                if not (loss and step):
                    continue
                writer.writerow([step.group(1), loss.group(1)])
                log_file.flush()
                rows += 1
                if rows % 50 == 0:
                    drive_copy(LOG_PATH)
        code = proc.wait()

    ckpt_dir = os.path.join(RESULT_DIR, "ckpts")
    if os.path.isdir(ckpt_dir):
        for name in sorted(os.listdir(ckpt_dir)):
            drive_copy(os.path.join(ckpt_dir, name))
    if code != 0:
        print(f"PSS_FAIL exit={code}", flush=True)
        sys.exit(code)
    print(f"PSS_DONE result_dir={RESULT_DIR} log={LOG_PATH}", flush=True)


main()
