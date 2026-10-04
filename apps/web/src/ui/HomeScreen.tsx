import { useEffect, useState, type FormEvent } from "react";
import type { SceneManifest } from "../contracts";
import { rememberedForm, type Account } from "../multiplayer/useAccount";
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

function SignIn({ account }: { account: Account }) {
  const [form, setForm] = useState(rememberedForm);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const orgId = form.orgId || account.organisations[0]?.id || "";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await account.signIn(form.name, orgId, code);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="home-card signin" onSubmit={submit}>
      <h1>Sign in</h1>
      <label className="field">
        Your name
        <input name="signin-name" value={form.name} maxLength={32} autoFocus onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </label>
      <label className="field">
        Organisation
        <select name="signin-org" value={orgId} onChange={(e) => setForm({ ...form, orgId: e.target.value })}>
          {account.organisations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Organisation access code
        <input name="signin-code" type="password" value={code} autoComplete="off" onChange={(e) => setCode(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      {account.organisations.length === 0 && <p className="error">No organisations are set up on the session server yet.</p>}
      <div className="buttons">
        <button type="submit" disabled={busy || !form.name.trim() || !code || !orgId}>
          {busy ? "Checking…" : "Sign in"}
        </button>
      </div>
      <p className="muted small">
        The code is checked by the session server (SpacetimeDB), which then lists your organisation's scenes and lets you
        edit their shared pins, modules and rover. This browser is remembered; there is no password or e-mail.
      </p>
    </form>
  );
}

type Props = {
  account: Account;
  offlineSceneIds: string[];
  denied: string | null; // a scene id from the URL that this organisation may not open
  onOpen: (sceneId: string) => void;
};

/** Before a scene is open: connecting, sign-in, or "Your scenes" for the signed-in organisation. */
export function HomeScreen({ account, offlineSceneIds, denied, onOpen }: Props) {
  const offline = account.status === "offline";
  const sceneIds = offline ? offlineSceneIds : account.sceneIds;
  const cards = useSceneCards(account.status === "connecting" || (!offline && !account.member) ? [] : sceneIds);

  if (account.status === "connecting") return <div className="home"><p className="muted">Connecting to the session server…</p></div>;
  if (!offline && !account.member) return <div className="home"><SignIn account={account} /></div>;

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
            </button>
          );
        })}
      </div>
      {sceneIds.length === 0 && <p className="muted">No scenes have been shared with your organisation yet.</p>}
    </div>
  );
}
