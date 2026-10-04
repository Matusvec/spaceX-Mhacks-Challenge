import { useEffect, useState, type FormEvent } from "react";
import { MODULE_LABELS } from "../config/scoring";
import type { Score } from "../contracts";
import { SPACETIME_MODULE, SPACETIME_URI } from "../multiplayer/connection";
import type { SharedScene } from "../multiplayer/useSharedScene";
import type { SceneRoot } from "../scene/SceneRoot";
import { isDefaultName, NameField } from "./NameField";
import type { RouteTarget } from "./useRover";

type Props = {
  shared: SharedScene;
  sceneRoot: SceneRoot | null;
  heightAt: (x: number, y: number) => number;
  onDrive: (target: RouteTarget) => void;
  driving: boolean;
  // Base camp placing uses the same terrain click; while it is on, pin picking waits.
  basecampPlacing: boolean;
  onBeginPick: () => void;
  editingModuleId: bigint | null;
  onKeepModule: () => void;
};

function grade(scoreJson: string): string {
  try {
    return `grade ${Math.round((JSON.parse(scoreJson) as Score).grade)}`;
  } catch {
    return "no score";
  }
}

// Presence, user pins and shared modules: the state every client reads from SpacetimeDB.
export function SharedPanel(props: Props) {
  const { shared, sceneRoot, heightAt, basecampPlacing } = props;
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<{ x: number; y: number } | null>(null);
  const [note, setNote] = useState("");

  const active = picking && !basecampPlacing;
  useEffect(() => {
    if (!sceneRoot || !active) return;
    sceneRoot.setPlaceHandler((x, y) => {
      // One click picks the spot; hand the mouse back to the camera straight away.
      sceneRoot.setPlaceHandler(null);
      setPicking(false);
      setPicked({ x, y });
    });
    return () => sceneRoot.setPlaceHandler(null);
  }, [sceneRoot, active]);

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!picked || !note.trim()) return;
    shared.actions.addPin({ ...picked, z: heightAt(picked.x, picked.y) }, note);
    setPicked(null);
    setNote("");
  };

  // Asked once, in place, while the name is still the generated one; "rename" opens it again.
  const [naming, setNaming] = useState(() => isDefaultName(shared.profile.name));
  const live = shared.status === "live";
  const count = shared.people.length;
  const chip = live ? `live, ${count} ${count === 1 ? "person" : "people"}` : shared.status === "connecting" ? "connecting…" : "offline: access not checked, not shared";

  return (
    <section className="shared">
      <h2>Shared session</h2>
      <span className={`chip chip-${shared.status}`} title={`SpacetimeDB ${SPACETIME_MODULE} at ${SPACETIME_URI}`}>
        ● {chip}
      </span>
      {!live && <p className="muted small">Pins and modules stay on this computer until the session server is reachable.</p>}
      {shared.error && <p className="error small">{shared.error}</p>}
      <ul className="people">
        {shared.people.map((person) => (
          <li key={person.id}>
            <span className="dot" style={{ background: person.color }} />
            {person.name}
            {person.isSelf && (
              <>
                {" "}
                <span className="muted">(you)</span>{" "}
                <button className="link" onClick={() => setNaming(true)}>
                  rename
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {naming && <NameField name={shared.profile.name} onSave={shared.setName} onClose={() => setNaming(false)} />}

      <h2>My pins</h2>
      <p className="muted small">Notes people left on the terrain{live ? ", shared live" : ""}. Not science data.</p>
      {shared.pins.length > 0 && (
        <ol className="user-pins">
          {shared.pins.map((pin) => (
            <li key={String(pin.id)}>
              <span className="diamond" style={{ background: pin.color }} />
              <strong>{pin.note}</strong>
              <div className="muted small">
                ({pin.position.x.toFixed(0)}, {pin.position.y.toFixed(0)}) m · {pin.mine ? "you" : pin.authorName}
              </div>
              <div className="buttons">
                <button
                  disabled={props.driving}
                  onClick={() => props.onDrive({ x: pin.position.x, y: pin.position.y, label: `pin "${pin.note}"` })}
                >
                  Drive here
                </button>
                <button
                  onClick={() => {
                    const next = window.prompt("Pin note", pin.note);
                    if (next?.trim()) shared.actions.renamePin(pin.id, next);
                  }}
                >
                  Rename
                </button>
                <button onClick={() => shared.actions.removePin(pin.id)}>Delete</button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {picked ? (
        <form className="pin-form" onSubmit={save}>
          <span className="muted small">
            Pin at ({picked.x.toFixed(0)}, {picked.y.toFixed(0)}) m
          </span>
          <input autoFocus value={note} maxLength={200} placeholder="Note for this spot" onChange={(e) => setNote(e.target.value)} />
          <div className="buttons">
            <button type="submit" disabled={!note.trim()}>
              Save pin
            </button>
            <button type="button" onClick={() => setPicked(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="buttons">
          <button
            className={active ? "active" : ""}
            disabled={!sceneRoot}
            onClick={() => {
              if (!picking) props.onBeginPick();
              setPicking(!picking);
            }}
          >
            {active ? "Click the terrain… (cancel)" : "Add pin"}
          </button>
        </div>
      )}

      {shared.modules.length > 0 && (
        <>
          <h2>Placed modules</h2>
          <ul className="shared-modules">
            {shared.modules.map((module) => (
              <li key={String(module.id)}>
                <span className="dot" style={{ background: module.color }} />
                {MODULE_LABELS[module.type]} · {grade(module.scoreJson)}
                <div className="muted small">
                  ({module.position.x.toFixed(0)}, {module.position.y.toFixed(0)}) m · {module.mine ? "you" : module.authorName}
                  {module.id === props.editingModuleId && " · editing"}
                </div>
                <div className="buttons">
                  {module.id === props.editingModuleId ? (
                    <button onClick={props.onKeepModule}>Keep, place another</button>
                  ) : (
                    <button onClick={() => shared.actions.deleteModule(module.id)}>Remove</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
