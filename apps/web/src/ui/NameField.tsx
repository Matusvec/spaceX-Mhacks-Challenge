import { useState, type FormEvent } from "react";

// ponytail: a name that looks like the generated default ("Explorer 123") counts as "not chosen yet".
export const isDefaultName = (name: string) => /^Explorer \d+$/.test(name);

type Props = { name: string; onSave: (name: string) => void; onClose: () => void };

// Inline "what should we call you" field for the shared session, instead of a browser prompt.
export function NameField({ name, onSave, onClose }: Props) {
  const [text, setText] = useState(isDefaultName(name) ? "" : name);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (text.trim()) onSave(text);
    onClose();
  };

  return (
    <form onSubmit={onSubmit}>
      <label className="field">
        Your name, as others will see it
        <input name="shared-name" value={text} maxLength={32} placeholder={name} onChange={(e) => setText(e.target.value)} autoFocus={!isDefaultName(name)} />
      </label>
      <div className="buttons">
        <button type="submit" disabled={!text.trim()}>
          Save
        </button>
        <button type="button" onClick={onClose}>
          {isDefaultName(name) ? `Stay ${name}` : "Cancel"}
        </button>
      </div>
    </form>
  );
}
