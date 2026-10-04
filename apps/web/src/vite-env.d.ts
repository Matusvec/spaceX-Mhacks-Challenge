/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BACKEND_URL?: string;
  // Deployed build (scripts/deploy_vercel.sh): Grok routes on the page's own origin under /api; scene opened by the bare URL.
  readonly VITE_SAME_ORIGIN?: string;
  readonly VITE_DEFAULT_SCENE?: string;
  // SpacetimeDB (src/multiplayer): server and database name. Defaults: ws://<this host>:3000, pss-studio.
  readonly VITE_SPACETIME_URI?: string;
  readonly VITE_SPACETIME_MODULE?: string;
}
