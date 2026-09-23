import { readFileSync } from "fs";
import path from "path";
import { updateState, readState, newId } from "../../lib/state.js";
import { sendMessage, downloadVoiceFile } from "../../lib/telegram.js";
import { generateDraft, transcribeAudio } from "../../lib/gemini.js";
import { putFile, getFile } from "../../lib/github.js";
import { formatDraftMessage } from "../../lib/format.js";

export const config = { maxDuration: 60 };

function loadVoiceSkill() {
  return readFileSync(path.join(process.cwd(), "voice-skill.md"), "utf8");
}

const COMMANDS = {
  approve: /^approve$/i,
  edit: /^edit:\s*(.+)$/is,
  regenerate: /^regenerate$/i,
  skip: /^skip\b:?\s*(.*)$/is,
};

function parseCommand(text) {
  if (!text) return null;
  const trimmed = text.trim();
  if (COMMANDS.approve.test(trimmed)) return { type: "approve" };
  if (COMMANDS.regenerate.test(trimmed)) return { type: "regenerate" };
  const editMatch = trimmed.match(COMMANDS.edit);
  if (editMatch) return { type: "edit", feedback: editMatch[1].trim() };
  const skipMatch = trimmed.match(COMMANDS.skip);
  if (skipMatch) return { type: "skip", reason: skipMatch[1].trim() || null };
  return null;
}

// Approving a draft doesn't just flip a status — it commits the finished
// post into published/ so the voice reference keeps growing.
async function publishApprovedDraft(draft) {
  const slug = draft.id.replace(/[^a-z0-9_]/gi, "");
  const filePath = `published/${new Date().toISOString().slice(0, 10)}-${slug}.md`;
  const frontmatter = [
    "---",
    `draft_id: ${draft.id}`,
    `note_ids: [${draft.note_ids.join(", ")}]`,
    `approved_at: ${new Date().toISOString()}`,
    "---",
    "",
  ].join("\n");
  const { sha } = await getFile(filePath);
  await putFile(filePath, frontmatter + draft.content, `Publish approved draft ${draft.id}`, sha);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  if (
    process.env.TELEGRAM_WEBHOOK_SECRET &&
    req.headers["x-telegram-bot-api-secret-token"] !== process.env.TELEGRAM_WEBHOOK_SECRET
  ) {
    return res.status(401).send("Unauthorized");
  }

  const update = req.body || {};
  const message = update.message;
  if (!message) return res.status(200).send("ignored");

  const chatId = String(message.chat.id);
  if (chatId !== String(process.env.TELEGRAM_CHAT_ID)) {
    return res.status(200).send("ignored: not the configured chat");
  }

  try {
    // --- Resolve incoming text, transcribing voice memos if needed ---
    let text = message.text || message.caption || null;
    let source = "telegram_text";
    if (!text && message.voice) {
      const { base64, mimeType } = await downloadVoiceFile(message.voice.file_id);
      text = await transcribeAudio({ base64, mimeType });
      source = "telegram_voice";
    }
    if (!text) return res.status(200).send("ignored: no text/voice content");

    const command = parseCommand(text);

    if (!command) {
      // A fresh raw fragment, not a reply to a draft: append to the backlog.
      await updateState((state) => {
        state.notes.push({
          id: newId("n"),
          text,
          source,
          created_at: new Date().toISOString(),
          status: "new",
          telegram_message_id: message.message_id,
        });
        return state;
      }, `Add note from Telegram (${source})`);
      return res.status(200).send("note recorded");
    }

    // --- Everything below acts on a pending draft ---
    const replyId = message.reply_to_message?.message_id;

    const { state } = await readState();
    let draft = replyId
      ? state.drafts.find((d) => d.telegram_message_id === replyId && d.status === "pending")
      : null;
    if (!draft) {
      const pending = state.drafts.filter((d) => d.status === "pending");
      if (pending.length === 1) draft = pending[0];
    }
    if (!draft) {
      await sendMessage(
        chatId,
        "I don't see a pending draft to apply that to — reply directly to the draft message, or send a new note.",
      );
      return res.status(200).send("no pending draft");
    }

    if (command.type === "approve") {
      await publishApprovedDraft(draft);
      await updateState((s) => {
        const d = s.drafts.find((x) => x.id === draft.id);
        d.status = "approved";
        d.approved_at = new Date().toISOString();
        for (const noteId of d.note_ids) {
          const n = s.notes.find((x) => x.id === noteId);
          if (n) n.status = "used";
        }
        return s;
      }, `Approve draft ${draft.id}`);
      await sendMessage(chatId, "Published to the voice archive. Nice one.", { replyToMessageId: message.message_id });
      return res.status(200).send("approved");
    }

    if (command.type === "skip") {
      await updateState((s) => {
        const d = s.drafts.find((x) => x.id === draft.id);
        d.status = "skipped";
        d.skip_reason = command.reason;
        for (const noteId of d.note_ids) {
          const n = s.notes.find((x) => x.id === noteId);
          if (n) {
            n.status = "rejected";
            n.rejected_reason = command.reason || "skipped after draft review";
          }
        }
        return s;
      }, `Skip draft ${draft.id}`);
      await sendMessage(chatId, "Got it, skipped. That note won't come back up.", {
        replyToMessageId: message.message_id,
      });
      return res.status(200).send("skipped");
    }

    if (command.type === "regenerate" || command.type === "edit") {
      await sendMessage(chatId, "On it — regenerating...", { replyToMessageId: message.message_id });
      const notes = draft.note_ids.map((id) => state.notes.find((n) => n.id === id));
      const voiceSkill = loadVoiceSkill();
      const { text: draftText, citation } = await generateDraft({
        voiceSkill,
        notes,
        previousDraft: draft.content,
        feedback: command.type === "edit" ? command.feedback : null,
      });

      const sentId = await sendMessage(
        chatId,
        formatDraftMessage({ text: draftText, citation, notes }),
      );

      await updateState((s) => {
        const d = s.drafts.find((x) => x.id === draft.id);
        d.status = "superseded";
        const revision = {
          id: newId("d"),
          note_ids: d.note_ids,
          created_at: new Date().toISOString(),
          status: "pending",
          content: draftText,
          citation,
          telegram_message_id: sentId,
          revises: d.id,
        };
        s.drafts.push(revision);
        return s;
      }, `Revise draft ${draft.id} (${command.type})`);

      return res.status(200).send("regenerated");
    }

    return res.status(200).send("unhandled");
  } catch (err) {
    console.error(err);
    try {
      await sendMessage(chatId, `Something broke on my end handling that: ${err.message}`);
    } catch {}
    return res.status(200).send("error handled");
  }
}
