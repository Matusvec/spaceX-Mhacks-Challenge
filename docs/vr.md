# VR: standing on the terrain in a headset

**VR is off by default.** It exists only when the page address contains `?vr=1` (or `&vr=1`); without
that there is no Enter VR button, no level-of-detail build and no XR setup, and the app behaves as it
did before VR was written. Everything below assumes `vr=1` is in the address.

The viewer can be entered in VR from a headset's own browser (Meta Quest Browser). It runs standalone
in the headset; nothing is plugged into a computer. Quest Link and PC VR are not used.

## Open it on a Quest

1. In the headset, open the Browser and go to the deployed site with the flag, for example
   https://planetary-scene-studio.vercel.app/?vr=1
2. Sign in and open a scene, as on a laptop. Check that `vr=1` is still in the address once the scene is
   open; add it and reload if it is not.
3. Wait for the splat to load. The camera bar (top right of the 3D view) shows **Enter VR**; it reads
   "Enter VR (preparing…)" while the splat's level of detail is being built, which happens once per load.
4. Press **Enter VR**. You stand on the ground beside the rover at true scale, facing the first science pin
   (Cheyava Falls on Mars). On the Moon, which has no pin, you face north.
5. To leave, press the Meta button and quit, or take the headset off and press **Exit VR** on the page.

The button only appears where the browser reports that immersive VR is supported, so it is absent on a
laptop even with `vr=1`.

## Controls

| Control | Does |
|---|---|
| Left thumbstick | Walk, 1.5 m/s, in the direction you are looking, level with the ground |
| Right trigger (hold) | Fast: five times walking speed |
| Right thumbstick, left/right | Turn |
| Left trigger (hold) | Fly up; release and you settle back to the ground |
| Left grip (hold) | Sink while flying; never below the ground |
| A (right controller) | Show or hide the status card on the left controller |

Your feet follow the ground: the splat's own surface where it exists, the terrain elsewhere. There are no
collisions, so you can walk through rocks and the rover.

## Tuning without a redeploy

Add these to the page address (for example `...?vr=1&scene=mars-hero-01&vrsplats=150000&vrscale=0.6`), then reload.

| Parameter | Default | Meaning |
|---|---|---|
| `vr` | off | `1` turns VR on. |
| `vrsplats` | 250000 | Gaussians drawn per frame in VR. The scene has about 970,000; level of detail picks which. |
| `vrscale` | 0.75 | Render resolution as a share of the headset's native resolution (0.3 to 1.5). |
| `vrfoveation` | 1 | Fixed foveation, 0 (off) to 1 (strongest). |

## If it is slow

The status card shows frames per second and the number of Gaussians being drawn.

1. Lower `vrsplats`: try 150000, then 100000.
2. Lower `vrscale`: try 0.6, then 0.5.
3. Untick "Presentation fill" before entering (removes haze, the ground beyond the data and the fine grain).
4. If the card says "full" instead of "lod", the level of detail was not built and every Gaussian is drawn:
   reload and wait for "preparing…" to finish before entering.

## What changes in VR

- The splat is drawn with level of detail, so per-Gaussian layer colors and search highlights are not shown
  in the headset. They come back on exit.
- The suitability map is hidden. Page overlays (panels, chat windows) are not visible in the headset.
- The rover, pins, placed modules, other people's cursors and the sky stay.
- On exit the flat view returns to exactly the camera it had.

## What was tested, and what was not

Tested on a laptop with a WebXR device emulator (IWER, set up as a Quest 3) in headless Chromium:
entering and leaving, both eyes rendering, standing 1.6 m above the ground beside the rover, walking,
running, turning, flying and settling, the status card toggle, level of detail at 250,000 and 100,000
Gaussians, and the flat view being pixel-identical before and after.

Not tested: a real headset. Unknown until someone tries it: frame rate on a Quest, how long "preparing…"
takes there, whether the default `vrsplats` and `vrscale` are comfortable, controller button numbering on
Quest 2 against Quest 3, comfort of smooth turning, and the Moon scene in VR. Hand tracking is off.

To repeat the emulator check: `shots/make-xr-emulator.sh`, then run `shots/capture.mjs` with
`INJECT=shots/xr-emulator.js URL_PARAMS=vr=1` and click the Enter VR button from a `STEPS` script.
