#!/usr/bin/env bash
# Builds shots/xr-emulator.js: Meta's WebXR device emulator (IWER, MIT) set up as a Quest 3, for
# entering VR in headless Chromium with shots/capture.mjs (INJECT=shots/xr-emulator.js URL_PARAMS=vr=1).
# The native XRWebGLBinding is hidden so three.js uses the emulator's XRWebGLLayer path.
set -euo pipefail
out="$(dirname "$0")/xr-emulator.js"
curl -fsSL https://unpkg.com/iwer@2.0.1/build/iwer.min.js > "$out"
cat >> "$out" <<'JS'

try {
  const device = new IWER.XRDevice(IWER.metaQuest3, { stereoEnabled: true });
  device.installRuntime();
  device.position.set(0, 1.6, 0);
  window.__xrDevice = device;
  window.XRWebGLBinding = undefined;
} catch (error) {
  window.__xrError = String(error);
}
JS
echo "wrote $out"
