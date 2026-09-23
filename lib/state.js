import { getFile, putFile } from "./github.js";

const STATE_PATH = "data/state.json";

const EMPTY_STATE = {
  notes: [],
  drafts: [],
  meta: { last_triage_run: null, last_selection_run: null },
};

export async function readState() {
  const { content, sha } = await getFile(STATE_PATH);
  if (!content) return { state: structuredClone(EMPTY_STATE), sha: null };
  return { state: JSON.parse(content), sha };
}

// Optimistic-concurrency write: re-reads and re-applies `mutate` if another
// request (webhook vs. cron, or two overlapping webhooks) committed first.
export async function updateState(mutate, commitMessage, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    const { state, sha } = await readState();
    const next = await mutate(state);
    if (next === null) return null; // mutate() can bail out (no-op) by returning null
    try {
      await putFile(STATE_PATH, JSON.stringify(next, null, 2) + "\n", commitMessage, sha);
      return next;
    } catch (err) {
      if (err.code === "SHA_CONFLICT" && i < attempts - 1) continue;
      throw err;
    }
  }
  throw new Error("updateState: too many conflicting writes");
}

export function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
}
