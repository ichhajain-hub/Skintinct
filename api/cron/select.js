import { readFileSync } from "fs";
import path from "path";
import { readState, updateState, newId } from "../../lib/state.js";
import { generateDraft } from "../../lib/gemini.js";
import { sendMessage } from "../../lib/telegram.js";
import { formatDraftMessage } from "../../lib/format.js";

export const config = { maxDuration: 60 };

const MIN_SCORE = () => Number(process.env.SELECTION_MIN_SCORE ?? 6);

function authorized(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}

function loadVoiceSkill() {
  return readFileSync(path.join(process.cwd(), "voice-skill.md"), "utf8");
}

// Union-find over triage's duplicate_of links so a "cluster" of near-duplicate
// notes can be drafted as one post instead of one each.
function clusterNotes(notes) {
  const parent = new Map(notes.map((n) => [n.id, n.id]));
  const find = (id) => (parent.get(id) === id ? id : (parent.set(id, find(parent.get(id))), parent.get(id)));
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const ids = new Set(notes.map((n) => n.id));
  for (const n of notes) {
    for (const dupId of n.triage?.duplicate_of || []) {
      if (ids.has(dupId)) union(n.id, dupId);
    }
  }
  const groups = new Map();
  for (const n of notes) {
    const root = find(n.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(n);
  }
  return [...groups.values()].map((members) => ({
    members,
    score: Math.max(...members.map((m) => m.triage.score)),
    oldest: members.reduce((a, b) => (a.created_at < b.created_at ? a : b)).created_at,
  }));
}

export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).send("Unauthorized");

  try {
    const { state } = await readState();

    const draftedNoteIds = new Set(state.drafts.flatMap((d) => d.note_ids));
    const eligible = state.notes.filter((n) => n.status === "triaged" && !draftedNoteIds.has(n.id));

    const clusters = clusterNotes(eligible)
      .filter((c) => c.score >= MIN_SCORE())
      .sort((a, b) => b.score - a.score || (a.oldest < b.oldest ? -1 : 1));

    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (clusters.length === 0) {
      await sendMessage(
        chatId,
        "Nothing cleared the bar for a draft this run — sending fewer posts this week rather than lowering the bar. I'll keep triaging as new notes come in.",
      );
      return res.status(200).send("nothing ready");
    }

    const best = clusters[0];
    const voiceSkill = loadVoiceSkill();
    const { text, citation } = await generateDraft({ voiceSkill, notes: best.members });

    const messageText = formatDraftMessage({ text, citation, notes: best.members });
    const sentId = await sendMessage(chatId, messageText);

    await updateState((s) => {
      s.drafts.push({
        id: newId("d"),
        note_ids: best.members.map((m) => m.id),
        created_at: new Date().toISOString(),
        status: "pending",
        content: text,
        citation,
        telegram_message_id: sentId,
      });
      s.meta.last_selection_run = new Date().toISOString();
      return s;
    }, "Select note(s) and send draft for review");

    return res.status(200).send("draft sent");
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message);
  }
}
