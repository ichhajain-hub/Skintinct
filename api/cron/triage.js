import { updateState } from "../../lib/state.js";
import { triageNotes } from "../../lib/gemini.js";

export const config = { maxDuration: 60 };

function authorized(req) {
  if (!process.env.CRON_SECRET) return true; // not set: skip check (local/dev only)
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}

export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).send("Unauthorized");

  try {
    const result = await updateState(async (state) => {
      const fresh = state.notes.filter((n) => n.status === "new");
      if (fresh.length === 0) return null; // nothing to do, don't commit an empty no-op

      const verdicts = await triageNotes(fresh);
      const byId = new Map(verdicts.map((v) => [v.id, v]));

      for (const note of fresh) {
        const v = byId.get(note.id);
        if (!v) continue; // model dropped it; leave as `new`, it'll be retried next run
        note.triage = {
          score: v.score,
          topic: v.topic,
          duplicate_of: v.duplicate_of || [],
          rationale: v.rationale,
          triaged_at: new Date().toISOString(),
        };
        if (v.publishable) {
          note.status = "triaged";
        } else {
          note.status = "rejected";
          note.rejected_reason = v.rationale;
        }
      }
      state.meta.last_triage_run = new Date().toISOString();
      return state;
    }, "Triage new notes");

    if (result === null) return res.status(200).send("nothing to triage");
    return res.status(200).send("triaged");
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message);
  }
}
