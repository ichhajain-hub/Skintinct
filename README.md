# Skinstinct voice pipeline

Turns Meera's raw Telegram notes into voice-matched LinkedIn drafts she
reviews before anything goes out. No auto-publish, anywhere.

```
Telegram note/voice memo
        │  (webhook)
        ▼
data/state.json  ── committed via GitHub API, no database
        │  (daily cron)
        ▼
Gemini triage — score, topic, near-dup clustering, hard "never publishable" flag
        │
        ▼
Mon/Wed/Fri cron: pick best untouched triaged note/cluster
        │  (if nothing clears the bar → tell her that on Telegram, send fewer drafts)
        ▼
Gemini draft — voice-skill.md as system context + live search grounding
        │
        ▼
Telegram: draft + source note + grounded citation
        │  she replies: approve / edit: <feedback> / regenerate / skip
        ▼
approve → published/<date>-<id>.md committed, source note(s) marked `used`
skip    → note(s) marked `rejected` (with her reason, if given)
```

## Why this shape

- **Editorial judgment is a real step, not a rubber stamp.** Triage runs as
  its own Gemini call, on a schedule, over the whole `new` backlog — not
  per-message reflexes. It writes a one-line rationale per note back into
  state precisely so "why did it pick this" is inspectable later
  ([api/cron/triage.js](api/cron/triage.js)).
- **Nothing publishes itself.** Approval is a human reply to a specific
  Telegram message. The webhook has no code path that posts to LinkedIn or
  anywhere public.
- **If nothing's good enough, she hears about it.** [api/cron/select.js](api/cron/select.js)
  sends fewer drafts that week rather than lowering the bar, and says so
  explicitly on Telegram when nothing clears it.
- **State lives in the repo, not a database.** At this scale (60 notes,
  3 posts/week) a committed `data/state.json` is simpler to inspect, diff,
  and back up than standing up Postgres for it.

## Layout

- `api/telegram/webhook.js` — ingestion + reply-command handling
- `api/cron/triage.js` — scheduled Gemini triage over `new` notes
- `api/cron/select.js` — Mon/Wed/Fri: select + draft + send
- `lib/` — GitHub Contents API, state read/update, Telegram, Gemini
- `data/state.json` — the one state file, committed via GitHub API
- `voice-skill.md` — **replace with the real Voice Skill file**
- `notes/`, `published/` — human-readable backlog and voice archive (see
  each folder's README)

See [SETUP.md](SETUP.md) for the one-time setup checklist.
