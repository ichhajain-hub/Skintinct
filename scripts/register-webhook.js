// Points the Telegram bot's webhook at the deployed Vercel URL.
// Run locally, once, after each deploy where the URL changes:
//   TELEGRAM_BOT_TOKEN=xxx TELEGRAM_WEBHOOK_SECRET=yyy \
//     node scripts/register-webhook.js https://your-app.vercel.app

const url = process.argv[2];
if (!url) {
  console.error("Usage: node scripts/register-webhook.js https://your-app.vercel.app");
  process.exit(1);
}

const { TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET } = process.env;
if (!TELEGRAM_BOT_TOKEN) {
  console.error("Missing TELEGRAM_BOT_TOKEN env var");
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: `${url.replace(/\/$/, "")}/api/telegram/webhook`,
    secret_token: TELEGRAM_WEBHOOK_SECRET || undefined,
  }),
});
const json = await res.json();
console.log(json);
