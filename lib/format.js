export function formatDraftMessage({ text, citation, notes }) {
  const source = notes.map((n) => n.text).join("\n---\n");
  const cite = citation ? `\n\nGrounded on: ${citation.title} — ${citation.uri}` : "";
  return [
    text,
    cite,
    "",
    "— source note(s) —",
    source,
    "",
    "Reply: approve / edit: <feedback> / regenerate / skip",
  ].join("\n");
}
