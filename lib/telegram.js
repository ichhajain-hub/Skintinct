const API = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

// Returns the sent message's message_id, so callers can stash it on a draft
// and match her reply back to it later.
export async function sendMessage(chatId, text, options = {}) {
  const res = await fetch(`${API()}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: options.parseMode || undefined,
      reply_to_message_id: options.replyToMessageId,
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) throw new Error(`Telegram sendMessage failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.result.message_id;
}

// Downloads a voice/audio message's bytes so Gemini can transcribe it.
// Returns { base64, mimeType }.
export async function downloadVoiceFile(fileId) {
  const infoRes = await fetch(`${API()}/getFile?file_id=${fileId}`);
  if (!infoRes.ok) throw new Error(`Telegram getFile failed: ${infoRes.status} ${await infoRes.text()}`);
  const { result } = await infoRes.json();
  const fileRes = await fetch(
    `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${result.file_path}`,
  );
  if (!fileRes.ok) throw new Error(`Telegram file download failed: ${fileRes.status}`);
  const buf = Buffer.from(await fileRes.arrayBuffer());
  // Telegram voice messages are always OGG/Opus.
  return { base64: buf.toString("base64"), mimeType: "audio/ogg" };
}
