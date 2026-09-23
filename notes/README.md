# notes/

This is where the 60 existing raw fragments live as plain files, for a human
to skim — it is **not** the pipeline's operational store. The pipeline reads
and writes `data/state.json`, not this folder.

Drop the real backlog in here, one fragment per file (`.md` or `.txt`,
any filename), then run:

```bash
npm run seed-notes
```

That copies each fragment into `data/state.json` as a `new` note, dedupes
against anything already seeded, and leaves the files here untouched so you
still have the originals. Commit the updated `data/state.json` afterward.

New fragments from Telegram going forward are appended straight into
`data/state.json` by the webhook — they never need a file in this folder.
