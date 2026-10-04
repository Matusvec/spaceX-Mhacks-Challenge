"""Runs on the Colab VM beside the trainer: puts each evaluation's pictures into TensorBoard.

  python3 vm_sheets.py /content/pss_site/runs/<run>

The trainer saves every held-out view as a full-resolution "ground truth | render" PNG.
This shrinks them onto one sheet per evaluation step and logs it under Images, so the
step slider in TensorBoard shows the splat sharpening. Exits when training is done.
"""
import glob
import os
import re
import sys
import time

import cv2
import numpy as np
from torch.utils.tensorboard import SummaryWriter

RUN = sys.argv[1]
TILE_W, COLS, MOST = 900, 2, 12   # each tile is one ground-truth | render pair


def sheet(step):
    tiles = []
    for path in sorted(glob.glob(f"{RUN}/renders/val_step{step}_*.png"))[:MOST]:
        im = cv2.imread(path)
        tiles.append(cv2.resize(im, (TILE_W, round(im.shape[0] * TILE_W / im.shape[1])), interpolation=cv2.INTER_AREA))
    h = max(t.shape[0] for t in tiles)
    tiles = [cv2.copyMakeBorder(t, 0, h - t.shape[0], 0, 0, cv2.BORDER_CONSTANT) for t in tiles]
    tiles += [np.zeros_like(tiles[0])] * (-len(tiles) % COLS)
    return np.vstack([np.hstack(tiles[i:i + COLS]) for i in range(0, len(tiles), COLS)])


os.makedirs(f"{RUN}/sheets", exist_ok=True)
writer = SummaryWriter(f"{RUN}/tb_val")
done = set()
while True:
    finished = os.path.exists(f"{RUN}/train.log") and "Viewer running" in open(f"{RUN}/train.log", errors="ignore").read()[-4000:]
    # the stats file is written after the last picture of that evaluation
    for stats in sorted(glob.glob(f"{RUN}/stats/val_step*.json")):
        step = int(re.search(r"val_step(\d+)", stats).group(1))
        if step not in done:
            img = sheet(step)
            cv2.imwrite(f"{RUN}/sheets/val_step{step:05d}.jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])
            writer.add_image("val/ground_truth_left__render_right", img[..., ::-1], step, dataformats="HWC")
            writer.flush()
            done.add(step)
            print("sheet", step, img.shape, flush=True)
    if finished:
        break
    time.sleep(10)
