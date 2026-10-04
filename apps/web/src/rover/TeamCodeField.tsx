import { useState, type FormEvent } from "react";
import { setTeamCode } from "../config/backend";
import { useGrokAccess } from "./useGrokStatus";

/** Asks once for the team passcode when the server wants one; hidden otherwise. It is kept in this browser. */
export function TeamCodeField() {
  const { status, rejected } = useGrokAccess();
  const [value, setValue] = useState("");
  if (status !== "locked") return null;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setTeamCode(value.trim());
    setValue("");
  };

  return (
    <form className="team-code" onSubmit={onSubmit}>
      <input
        type="password"
        name="team-code"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Team passcode"
        aria-label="Team passcode"
        autoComplete="off"
      />
      <button type="submit" disabled={!value.trim()}>
        Unlock Grok
      </button>
      <span className={`small ${rejected ? "error" : "muted"}`}>
        {rejected ? "That passcode was not accepted." : "Grok chat, voice and concept renders spend the team's credits."}
      </span>
    </form>
  );
}
