# Setup checklist

## 1. Drop in the real content

- Replace `voice-skill.md` with the finished Voice Skill file.
- Put the 15 published pieces in `published/` (they're the ground truth
  behind the Voice Skill already; keeping them here too means the archive
  that `approve` grows over time starts from the real baseline).
- Put the 60 backlog fragments in `notes/`, one per file, then:
  ```bash
  npm run seed-notes
  ```
  This writes them into `data/state.json` as `new` notes. Commit the result.

## 2. Telegram bot

Meera already has a bot (or make one via **@BotFather** → `/newbot`).

- Grab the bot token.
- Get her chat ID: send the bot any message, then hit
  `https://api.telegram.org/bot<token>/getUpdates` and read `message.chat.id`.
- Invent a random string for `TELEGRAM_WEBHOOK_SECRET` (e.g. `openssl rand -hex 20`).

## 3. GitHub

- Create the repo (or use this one) and push this project to it.
- Create a **fine-grained personal access token** scoped to just this repo,
  with **Contents: Read and write** permission. Nothing else.

## 4. Gemini

- Get an API key from Google AI Studio.
- Default model is `gemini-2.5-flash` (fast + supports search grounding and
  structured JSON output, which triage relies on). Override via `GEMINI_MODEL`
  if you want `gemini-2.5-pro` instead.

## 5. Vercel

- Import the repo as a new Vercel project.
- Set all the env vars from `.env.example` in Project Settings → Environment
  Variables (`GITHUB_BRANCH` defaults to `main` if omitted).
- Deploy. Two cron jobs are already wired up via `vercel.json`:
  - `api/cron/triage` — daily at 5:00 AM IST (`30 23 * * *` UTC)
  - `api/cron/select` — Mon/Wed/Fri at 7:00 AM IST (`30 1 * * 1,3,5` UTC)
  - Both fit the Hobby-plan limit of daily-or-less cron frequency; if you're
    on Pro and want triage to run more than once a day, that's a one-line
    schedule change.

## 6. Point Telegram at the deployment

```bash
TELEGRAM_BOT_TOKEN=xxx TELEGRAM_WEBHOOK_SECRET=yyy \
  node scripts/register-webhook.js https://your-app.vercel.app
```

Re-run this any time the deployment URL changes.

## 7. Smoke test

- Send the bot a text note → check `data/state.json` gets a commit with a
  `new` entry.
- Send a voice memo → same, but check it got transcribed into `text`
  (`source: "telegram_voice"`).
- Manually hit `/api/cron/triage` once (with the `Authorization: Bearer
  <CRON_SECRET>` header) to triage the seeded backlog instead of waiting for
  5 AM.
- Manually hit `/api/cron/select` the same way to get the first draft
  end-to-end, then try `approve`, `edit: ...`, `regenerate`, and `skip` on it.

## Known trade-offs, on purpose

- **No LinkedIn API integration at all.** She copy-pastes the approved draft
  herself. That's the point — nothing here can auto-publish even if you
  wanted it to.
- **Regenerate/edit run synchronously in the webhook** (up to 60s, search
  grounding included) rather than a queue — simplest thing that works at
  3 drafts/week. She gets an immediate "On it…" ack so it doesn't look stuck.
- **A note only gets drafted once, ever**, even if she never replies to that
  draft — `select.js` excludes any note already referenced by a draft of any
  status. If a draft goes stale, `regenerate` on it rather than waiting for
  a new selection run to reconsider it.
