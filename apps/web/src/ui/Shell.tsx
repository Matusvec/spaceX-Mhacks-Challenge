import { useCallback, useState, type ReactNode } from "react";
import { useAccount } from "../multiplayer/useAccount";
import type { SharedAccount } from "../multiplayer/useSharedScene";
import { HomeScreen } from "./HomeScreen";
import { SceneSwitcher } from "./SceneSwitcher";

// With no session server there is nobody to ask which scenes are yours: offer the bundles this build ships with.
// (VITE_DEFAULT_SCENE is the scene a deployed build was shipped with.)
const OFFLINE_SCENE_IDS = [...new Set([import.meta.env.VITE_DEFAULT_SCENE, "mars-hero-01", "moon-malapert-01"].filter((id): id is string => !!id))];

type Props = { children: (sceneId: string, account: SharedAccount) => ReactNode };

/**
 * One app, one tab: sign in, pick one of your organisation's scenes, hop between them without a reload.
 * `?scene=` deep links open directly when the signed-in organisation has that scene.
 */
export function Shell({ children }: Props) {
  const account = useAccount();
  const [sceneId, setSceneId] = useState(() => new URLSearchParams(window.location.search).get("scene"));

  const open = useCallback((next: string | null) => {
    setSceneId(next);
    // Keep the address in step (a reload or a shared link lands on the same scene) without navigating.
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("scene", next);
    else url.searchParams.delete("scene");
    window.history.replaceState(null, "", url);
  }, []);

  const offline = account.status === "offline";
  const sceneIds = offline ? OFFLINE_SCENE_IDS : account.sceneIds;
  // Offline nothing can be checked (and nothing is shared). Online, the server's my_scenes rows decide.
  const allowed = sceneId !== null && (offline || (account.member !== null && account.sceneIds.includes(sceneId)));
  const denied = sceneId !== null && account.status === "live" && account.member !== null && !allowed ? sceneId : null;
  const session: SharedAccount = { link: account.link, status: account.status, error: account.error, name: account.member?.name ?? null };

  return (
    <div className="shell">
      <SceneSwitcher account={account} sceneIds={sceneIds} sceneId={allowed ? sceneId : null} onOpen={open} />
      <div className="shell-body">
        {allowed ? children(sceneId, session) : <HomeScreen account={account} offlineSceneIds={OFFLINE_SCENE_IDS} denied={denied} onOpen={open} />}
      </div>
    </div>
  );
}
