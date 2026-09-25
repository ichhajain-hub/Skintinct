const MODEL = () => process.env.GEMINI_MODEL || "gemini-3.8-flash";
const API = () =>
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL()}:generateContent?key=${process.env.GEMINI_API_KEY}`;

async function call(body) {
  const res = await fetch(API(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini call failed: ${res.status} ${await res.text()}`);
  return res.json();
}

const TRIAGE_SCHEMA = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          score: { type: "integer", description: "0-10, how worth developing into a LinkedIn post" },
          topic: { type: "string" },
          publishable: {
            type: "boolean",
            description: "false only if this could never be published in any edited form (too personal, half-formed with no angle, off-brand, etc.)",
          },
          duplicate_of: {
            type: "array",
            items: { type: "string" },
            description: "ids of other notes in this batch that cover the same ground and could be combined with this one",
          },
          rationale: { type: "string", description: "one sentence, plain language, explaining the verdict" },
        },
        required: ["id", "score", "topic", "publishable", "duplicate_of", "rationale"],
      },
    },
  },
  required: ["verdicts"],
};

// Scores a batch of raw Telegram notes for editorial judgment. Does NOT try
// to sound like her — that's the drafting step's job with the Voice Skill.
export async function triageNotes(notes) {
  const prompt = [
    "You are the editorial gatekeeper for a skincare founder's LinkedIn ghostwriting pipeline.",
    "She voice-notes and jots raw fragments into Telegram all week. Your job is triage, not writing:",
    "decide which fragments are worth someone's time to develop into a real post, which are near-duplicates",
    "that should be combined rather than drafted twice, and which are not publishable in any form so they",
    "should stop resurfacing.",
    "",
    "Score each note 0-10 for how worth-developing it is (a strong opinion, a concrete story, a specific",
    "result or number, a contrarian take — score high; a vague mood, an incomplete thought with no angle,",
    "or something purely personal/off-brand — score low and mark publishable=false).",
    "",
    "Flag duplicate_of whenever two or more notes in this batch are clearly the same idea or could be",
    "woven into one stronger post together.",
    "",
    "Notes:",
    JSON.stringify(notes.map((n) => ({ id: n.id, text: n.text })), null, 2),
  ].join("\n");

  const json = await call({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: TRIAGE_SCHEMA,
    },
  });

  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "{}";
  const parsed = JSON.parse(text);
  return parsed.verdicts || [];
}

// Generates (or regenerates) a LinkedIn draft in her voice, grounded with a
// real current search result pulled in at generation time (not bolted on after).
// `voiceSkill` is the full text of voice-skill.md, used as system context.
export async function generateDraft({ voiceSkill, notes, previousDraft, feedback }) {
  const noteText = notes.map((n) => `- ${n.text}`).join("\n");

  const parts = [
    "Write one LinkedIn post in my voice, based on the raw note(s) below.",
    "",
    "Raw note(s) this is built from:",
    noteText,
    "",
    "Use search to find one real, current news item, stat, or data point relevant to this note, and weave",
    "it into the post itself as part of the argument — don't tack a link on at the end for its own sake.",
    "Write only the finished post text, ready to publish as-is. No preamble, no markdown headers, no",
    "explanation of what you did — just the post.",
  ];

  if (previousDraft) {
    parts.push(
      "",
      "This is a revision of a previous draft. Previous draft:",
      previousDraft,
    );
  }
  if (feedback) {
    parts.push("", "Feedback to incorporate this time:", feedback);
  } else if (previousDraft) {
    parts.push("", "She asked for a fresh alternative take on the same note(s) — same voice, different angle.");
  }

  const json = await call({
    system_instruction: { parts: [{ text: voiceSkill }] },
    contents: [{ role: "user", parts: [{ text: parts.join("\n") }] }],
    tools: [{ google_search: {} }],
  });

  const candidate = json.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text).join("").trim() || "";

  const chunks = candidate?.groundingMetadata?.groundingChunks || [];
  const citation = chunks
    .map((c) => c.web && { title: c.web.title, uri: c.web.uri })
    .find(Boolean);

  return { text, citation };
}

// Transcribes a Telegram voice message. Plain transcript only — triage and
// drafting treat it exactly like a typed fragment from there on.
export async function transcribeAudio({ base64, mimeType }) {
  const json = await call({
    contents: [
      {
        role: "user",
        parts: [
          { text: "Transcribe this voice memo verbatim. Output only the transcript, no commentary." },
          { inline_data: { mime_type: mimeType, data: base64 } },
        ],
      },
    ],
  });
  return (json.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "").trim();
}
