#!/usr/bin/env python3
"""Fine-tune SegFormer-B1 on AI4Mars (soil, bedrock, sand, big rock; unlabelled pixels ignored).

  .venv-semantic/bin/python pipelines/semantic/train_ai4mars.py --epochs 12        # train, or resume, then test
  .venv-semantic/bin/python pipelines/semantic/train_ai4mars.py --test-only        # test runs/ai4mars/best.pt

Writes to runs/ai4mars/: loss.csv (step, loss), val.csv (one row per epoch), last.pt, best.pt (best validation
mIoU), test_metrics.json. Rerunning resumes from last.pt; a run already at --epochs goes straight to the test.

Validation is the last row group of each train shard (crowd labels, never trained on). The test splits
test_min1/2/3 are the dataset's 322 expert-checked images where at least 1, 2 or 3 annotators labelled a pixel
and all agreed (folders masked-gold-minN-100agree in the original release, see data/ai4mars/prepare.py).
"""
import argparse
import csv
import json
import time
from pathlib import Path

import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader

from ai4mars_data import CLASSES, IGNORE, AI4Mars, count_labelled, row_groups
from seg_model import PRETRAINED, build, logits

OUT = Path("runs/ai4mars")
CLASS_WEIGHTS = [1.0, 1.0, 1.5, 3.0]   # big rock is under 1% of labelled pixels; a mild push, not inverse frequency
EVAL_SCALE = 0.5                        # evaluate on the 1024 px image halved, scored against full-size labels


@torch.no_grad()
def evaluate(model, split, scale=EVAL_SCALE, workers=4):
    """Confusion matrix over a split -> mIoU, per-class IoU, pixel accuracy, labelled pixel counts."""
    model.eval()
    conf = torch.zeros(len(CLASSES), len(CLASSES), dtype=torch.long, device="cuda")
    for gray, lab in DataLoader(AI4Mars(split, train=False), batch_size=8, num_workers=workers):
        gray, lab = gray.cuda(), lab.cuda().long()
        small = F.interpolate(gray[:, None], scale_factor=scale, mode="area")[:, 0] if scale != 1 else gray
        with torch.autocast("cuda", dtype=torch.float16):
            pred = logits(model, small, out_size=lab.shape[-2:]).argmax(1)
        ok = lab != IGNORE
        conf += torch.bincount(lab[ok] * len(CLASSES) + pred[ok], minlength=len(CLASSES) ** 2).view_as(conf)
    conf = conf.double()
    tp = conf.diag()
    iou = (tp / (conf.sum(0) + conf.sum(1) - tp).clamp(min=1)).tolist()
    return {"miou": sum(iou) / len(iou), "iou": dict(zip(CLASSES, iou)), "pixel_acc": (tp.sum() / conf.sum()).item(),
            "labelled_pixels": dict(zip(CLASSES, conf.sum(1).long().tolist()))}


def test(model):
    results = {"model": PRETRAINED, "eval_scale": EVAL_SCALE, "images_per_split": 322}
    for split in ("test_min1", "test_min2", "test_min3"):
        results[split] = evaluate(model, split)
        results[split + "_native_res"] = evaluate(model, split, scale=1.0)
        r = results[split]
        print(f"{split}: mIoU {r['miou']:.4f}  acc {r['pixel_acc']:.4f}  " + "  ".join(f"{c} {v:.4f}" for c, v in r["iou"].items())
              + f"   (native res: mIoU {results[split + '_native_res']['miou']:.4f})")
    (OUT / "test_metrics.json").write_text(json.dumps(results, indent=2) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=12)
    ap.add_argument("--batch", type=int, default=12)
    ap.add_argument("--lr", type=float, default=6e-5)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--max-steps", type=int, default=0, help="stop early, for a smoke test")
    ap.add_argument("--test-only", action="store_true")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    torch.backends.cudnn.benchmark = True

    model = build().cuda()
    if args.test_only:
        model.load_state_dict(torch.load(OUT / "best.pt", weights_only=True)["model"])
        return test(model)

    data = AI4Mars("train", train=True)
    steps_per_epoch = count_labelled(data.groups) // args.batch
    total = args.epochs * steps_per_epoch
    head = [p for n, p in model.named_parameters() if n.startswith("decode_head")]
    body = [p for n, p in model.named_parameters() if not n.startswith("decode_head")]
    opt = torch.optim.AdamW([{"params": body, "lr": args.lr}, {"params": head, "lr": args.lr * 10}], weight_decay=0.01)
    warmup = 300
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min((s + 1) / warmup, max(1 - s / total, 0.0)))
    scaler = torch.amp.GradScaler("cuda")
    weights = torch.tensor(CLASS_WEIGHTS, device="cuda")
    epoch, step, best = 0, 0, -1.0
    if (OUT / "last.pt").exists():
        ck = torch.load(OUT / "last.pt", weights_only=True)
        model.load_state_dict(ck["model"]), opt.load_state_dict(ck["opt"]), sched.load_state_dict(ck["sched"])
        scaler.load_state_dict(ck["scaler"])
        epoch, step, best = ck["epoch"], ck["step"], ck["best"]
        print(f"resumed at epoch {epoch}, step {step}, best val mIoU {best:.4f}")
    else:   # fresh run: start the logs
        (OUT / "loss.csv").write_text("step,loss\n")
        (OUT / "val.csv").write_text("epoch,step,minutes,train_loss,val_miou,val_pixel_acc," + ",".join("iou_" + c for c in CLASSES) + "\n")
    print(f"{steps_per_epoch} steps per epoch, {total} total, {len(data.groups)} train row groups, "
          f"{len(row_groups('val'))} validation row groups")

    t0 = time.time()
    while epoch < args.epochs:
        model.train()
        data.epoch = epoch
        running, n = 0.0, 0
        for gray, lab in DataLoader(data, batch_size=args.batch, num_workers=args.workers, drop_last=True, pin_memory=True):
            gray, lab = gray.cuda(non_blocking=True), lab.cuda(non_blocking=True).long()
            with torch.autocast("cuda", dtype=torch.float16):
                loss = F.cross_entropy(logits(model, gray).float(), lab, weight=weights, ignore_index=IGNORE)
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.step(opt), scaler.update(), sched.step()
            step, running, n = step + 1, running + loss.item(), n + 1
            if step % 50 == 0:
                with open(OUT / "loss.csv", "a") as f:
                    csv.writer(f).writerow([step, f"{running / n:.5f}"])
                print(f"epoch {epoch} step {step} loss {running / n:.4f} {(time.time() - t0) / 60:.1f} min", flush=True)
            if args.max_steps and step >= args.max_steps:
                break
        epoch += 1
        m = evaluate(model, "val")
        with open(OUT / "val.csv", "a") as f:
            csv.writer(f).writerow([epoch, step, f"{(time.time() - t0) / 60:.1f}", f"{running / max(n, 1):.5f}", f"{m['miou']:.5f}",
                                    f"{m['pixel_acc']:.5f}"] + [f"{m['iou'][c]:.5f}" for c in CLASSES])
        print(f"epoch {epoch} done: val mIoU {m['miou']:.4f} acc {m['pixel_acc']:.4f} {m['iou']}", flush=True)
        if m["miou"] > best:
            best = m["miou"]
            torch.save({"model": model.state_dict(), "epoch": epoch, "val": m}, OUT / "best.pt")
        torch.save({"model": model.state_dict(), "opt": opt.state_dict(), "sched": sched.state_dict(),
                    "scaler": scaler.state_dict(), "epoch": epoch, "step": step, "best": best}, OUT / "last.tmp")
        (OUT / "last.tmp").replace(OUT / "last.pt")
        if args.max_steps and step >= args.max_steps:
            return
    model.load_state_dict(torch.load(OUT / "best.pt", weights_only=True)["model"])
    test(model)


if __name__ == "__main__":
    main()
