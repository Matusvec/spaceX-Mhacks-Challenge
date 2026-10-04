import type { Account } from "../multiplayer/useAccount";
import { useSceneCards } from "./HomeScreen";

type Props = {
  account: Account;
  sceneIds: string[]; // the scenes this person may hop to
  sceneId: string | null; // the open one, or null on the scene list
  onOpen: (sceneId: string | null) => void;
};

/** The bar above everything: which scene is open (and a way to hop to another permitted one), who is signed in, sign out. */
export function SceneSwitcher({ account, sceneIds, sceneId, onOpen }: Props) {
  const cards = useSceneCards(sceneIds);
  const title = (id: string) => {
    const card = cards[id];
    return typeof card === "object" ? `${card.body === "mars" ? "Mars" : "Moon"} · ${card.title}` : id;
  };
  const listed = sceneId && !sceneIds.includes(sceneId) ? [sceneId, ...sceneIds] : sceneIds;

  return (
    <header className="shell-bar">
      <strong>Planetary Scene Studio</strong>
      {(account.member || account.status === "offline") && (
        <>
          <button className="link" disabled={!sceneId} onClick={() => onOpen(null)}>
            {account.status === "offline" ? "Scenes" : "Your scenes"}
          </button>
          <select name="scene-switcher" aria-label="Open scene" value={sceneId ?? ""} onChange={(e) => onOpen(e.target.value || null)}>
            <option value="">Choose a scene…</option>
            {listed.map((id) => (
              <option key={id} value={id}>
                {title(id)}
              </option>
            ))}
          </select>
        </>
      )}
      <span className="shell-who">
        {account.status === "offline" ? (
          <span className="chip chip-offline" title={account.error ?? (account.solo ? "opened with ?solo" : undefined)}>
            offline: access not checked, not shared
          </span>
        ) : account.member ? (
          <>
            {account.member.name} · <span className="muted">{account.member.orgName}</span>{" "}
            <button onClick={() => void account.signOut()}>Sign out</button>
          </>
        ) : null}
      </span>
    </header>
  );
}
