import { useEffect, useState, type FormEvent } from "react";
import type { SceneManifest } from "../contracts";
import { rememberedName, type Account } from "../multiplayer/useAccount";
import { bundleFileUrl } from "../scene/loadBundle";

// What the cards show comes from each bundle's scene.json; fetched once per scene id.
const manifests = new Map<string, Promise<SceneManifest>>();

function fetchManifest(sceneId: string): Promise<SceneManifest> {
  let pending = manifests.get(sceneId);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(bundleFileUrl(sceneId, "scene.json"));
      if (!response.ok) throw new Error(`${response.status} loading scene.json`);
      return (await response.json()) as SceneManifest;
    })();
    manifests.set(sceneId, pending);
    pending.catch(() => manifests.delete(sceneId));
  }
  return pending;
}

/** Each scene's manifest, or an error message, as they arrive. */
export function useSceneCards(sceneIds: string[]): Record<string, SceneManifest | string> {
  const [cards, setCards] = useState<Record<string, SceneManifest | string>>({});
  const key = sceneIds.join("|");
  useEffect(() => {
    let cancelled = false;
    for (const id of key ? key.split("|") : []) {
      fetchManifest(id)
        .then((manifest) => !cancelled && setCards((c) => ({ ...c, [id]: manifest })))
        .catch((err: unknown) => !cancelled && setCards((c) => ({ ...c, [id]: err instanceof Error ? err.message : String(err) })));
    }
    return () => {
      cancelled = true;
    };
  }, [key]);
  return cards;
}

const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

// One line built only from fields of scene.json: extent, resolution, splat and number of sources.
function describe(manifest: SceneManifest): string {
  const [width, depth] = manifest.terrain.size_m;
  const splat = manifest.splat ? `, with a ${manifest.splat.count.toLocaleString()}-Gaussian splat` : "";
  return `${km(width)} × ${km(depth)} of terrain at ${manifest.terrain.resolution_m} m/px${splat} · ${manifest.sources.length} cited sources`;
}

// The landing page is the sign-in: one access-code box over a picture of our own Mars scene.
function Landing({ account }: { account: Account }) {
  const [name, setName] = useState(rememberedName);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connecting = account.status === "connecting";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // No name given: a generated one; the shared panel asks for a real one inside the scene.
      await account.enter(name.trim() || `Explorer ${Math.floor(Math.random() * 900 + 100)}`, code);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="landing">
      <form className="landing-card" onSubmit={submit}>
        <p className="eyebrow">Mars · Moon</p>
        <h1>Planetary Scene Studio</h1>
        <p className="landing-line">Plan a base on Mars or the Moon, on the real ground, together.</p>
        <input
          name="signin-code"
          type="password"
          aria-label="Access code"
          placeholder="Access code"
          value={code}
          autoComplete="off"
          autoFocus
          onChange={(e) => setCode(e.target.value)}
        />
        <input name="signin-name" aria-label="Your name" placeholder="Your name (optional)" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} />
        <button type="submit" disabled={busy || connecting || !code.trim()}>
          {connecting ? "Connecting…" : busy ? "Checking…" : "Enter"}
        </button>
        {error && <p className="error">{error}</p>}
        <p className="muted small">Your organisation's code opens its scenes. This browser is remembered.</p>
      </form>
      <p className="landing-foot">
        Live session by SpacetimeDB
        {!connecting && ` · ${account.live.length} ${account.live.length === 1 ? "person" : "people"} in a scene now`}
      </p>
    </div>
  );
}

type Props = {
  account: Account;
  offlineSceneIds: string[];
  denied: string | null; // a scene id from the URL that this organisation may not open
  onOpen: (sceneId: string) => void;
};

/** Before a scene is open: the landing page (access code), or "Your scenes" with who is live in each. */
export function HomeScreen({ account, offlineSceneIds, denied, onOpen }: Props) {
  const offline = account.status === "offline";
  const sceneIds = offline ? offlineSceneIds : account.sceneIds;
  const cards = useSceneCards(account.status === "connecting" || (!offline && !account.member) ? [] : sceneIds);

  if (!offline && !account.member) return <Landing account={account} />;
  // Who is in each scene right now, from Spacetime presence (same room as this tab, if it has one).
  const room = new URLSearchParams(window.location.search).get("room");
  const liveIn = (id: string) => account.live.filter((person) => person.sceneId === (room ? `${id}#${room}` : id));

  return (
    <div className="home">
      <h1>{offline ? "Scenes" : "Your scenes"}</h1>
      {offline ? (
        <p className="chip chip-offline">offline: access not checked, not shared</p>
      ) : (
        <p className="muted">
          {account.member!.orgName} may open {sceneIds.length === 1 ? "this scene" : `these ${sceneIds.length} scenes`}.
        </p>
      )}
      {denied && (
        <p className="error">
          Your organisation does not have the scene “{denied}”. Ask its owner for access, or sign in with another organisation.
        </p>
      )}
      <div className="scene-cards">
        {sceneIds.map((id) => {
          const card = cards[id];
          const manifest = typeof card === "object" ? card : null;
          return (
            <button key={id} className="home-card scene-card" data-scene={id} onClick={() => onOpen(id)}>
              <span className="eyebrow">{manifest ? (manifest.body === "mars" ? "Mars" : "Moon") : id}</span>
              <strong>{manifest?.title ?? (typeof card === "string" ? `Could not read this scene (${card})` : "Loading…")}</strong>
              {manifest && <span className="muted small">{describe(manifest)}</span>}
              {!offline && (
                <span className="scene-live small">
                  {liveIn(id).length === 0 ? (
                    <span className="muted">nobody here right now</span>
                  ) : (
                    <>
                      <span className="chip chip-live">● {liveIn(id).length} live</span>
                      {liveIn(id).map((person) => (
                        <span key={person.id} className="live-person">
                          <span className="dot" style={{ background: person.color }} />
                          {person.name}
                        </span>
                      ))}
                    </>
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {sceneIds.length === 0 && <p className="muted">No scenes have been shared with your organisation yet.</p>}
    </div>
  );
}
