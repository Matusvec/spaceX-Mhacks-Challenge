const MAX_CHARS = 64;

// One short clause of a long source or resolution string, without URLs, for the line under a layer.
// The full text and its links are in the Sources dialog.
export function shortSource(text: string | undefined): string {
  if (!text) return "not stated";
  const noUrls = text.replace(/,?\s*https?:\/\/\S+/g, "").trim();
  const cut = noUrls.search(/[;:]\s/);
  const clause = cut >= 12 ? noUrls.slice(0, cut) : noUrls;
  if (clause.length <= MAX_CHARS) return clause;
  return clause.slice(0, clause.lastIndexOf(" ", MAX_CHARS)).replace(/[,.(]+$/, "") + "…";
}

// "20 m/px · computed from LOLA DEMs + JPL DE421 ephemeris"
export function resolutionAndSource(layer: { resolution?: string; source?: string }): string {
  return `${shortSource(layer.resolution)} · ${shortSource(layer.source)}`;
}

if (import.meta.env.DEV) {
  console.assert(shortSource("orbital, 18 m/px; moved 198 m west") === "orbital, 18 m/px");
  console.assert(shortSource("Paper X, https://doi.org/10.1/abc") === "Paper X");
  console.assert(shortSource(undefined) === "not stated");
}
