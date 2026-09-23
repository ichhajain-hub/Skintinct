// One-time local import of the existing notes/ backlog into data/state.json,
// so the 60 already-written fragments enter the same pipeline as future
// Telegram messages instead of needing special-cased handling.
//
// Assumption: each file directly under notes/ (excluding README.md) is ONE
// fragment — its whole contents become one note. If your export instead puts
// many fragments in a single file, split it into one-file-per-fragment first
// (or adjust the loop below to split on a delimiter).
//
// Run locally: node scripts/seed-notes.js
// Then commit + push data/state.json yourself (no GitHub API needed for this
// one-time step since you already have the repo checked out).

import { readFileSync, readdirSync, writeFileSync, existsSync } from "fs";
import path from "path";
import crypto from "crypto";

const NOTES_DIR = path.join(process.cwd(), "notes");
const STATE_PATH = path.join(process.cwd(), "data", "state.json");

const state = existsSync(STATE_PATH)
  ? JSON.parse(readFileSync(STATE_PATH, "utf8"))
  : { notes: [], drafts: [], meta: { last_triage_run: null, last_selection_run: null } };

const existingTexts = new Set(state.notes.map((n) => n.text.trim()));

const files = readdirSync(NOTES_DIR).filter(
  (f) => (f.endsWith(".md") || f.endsWith(".txt")) && f.toLowerCase() !== "readme.md",
);

let added = 0;
for (const file of files.sort()) {
  const text = readFileSync(path.join(NOTES_DIR, file), "utf8").trim();
  if (!text || existingTexts.has(text)) continue;
  state.notes.push({
    id: `n_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
    text,
    source: `seed:${file}`,
    created_at: new Date().toISOString(),
    status: "new",
    telegram_message_id: null,
  });
  existingTexts.add(text);
  added++;
}

writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
console.log(`Seeded ${added} new note(s) from notes/ into data/state.json (${files.length} file(s) scanned).`);
