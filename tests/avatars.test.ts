// Quick check of the profile-photo logic: npx tsx scripts/check-avatars.ts
import assert from "node:assert";
import { blueskyActor, telegramImageFromHtml, telegramUser } from "../src/lib/avatars";

// Bluesky: with or without @ and domain, and nothing odd ending up in an address
assert.strictEqual(blueskyActor("@Demo.bsky.social"), "demo.bsky.social");
assert.strictEqual(blueskyActor("demo"), "demo.bsky.social");
assert.strictEqual(blueskyActor("demo.example.com"), "demo.example.com");
for (const bad of ["", "a b", "demo/../x", "demo?x=1", ".demo", "demo-", "dém.o"]) {
  assert.strictEqual(blueskyActor(bad), null, bad);
}

// Telegram: 5 to 32 characters
assert.strictEqual(telegramUser("@demo_user"), "demo_user");
for (const bad of ["abcd", "has space", "demo/x", "a".repeat(33), ""]) {
  assert.strictEqual(telegramUser(bad), null, bad);
}

// The public page's photo: only Telegram's CDN counts (without a photo, Telegram shows its logo)
const page = (image: string) => `<html><head><meta property="og:title" content="Demo"><meta property="og:image" content="${image}"></head></html>`;
assert.strictEqual(telegramImageFromHtml(page("https://cdn4.cdn-telegram.org/file/abc.jpg?x=1&amp;y=2")), "https://cdn4.cdn-telegram.org/file/abc.jpg?x=1&y=2");
assert.strictEqual(telegramImageFromHtml(page("https://cdn5.telesco.pe/file/abc.jpg")), "https://cdn5.telesco.pe/file/abc.jpg");
assert.strictEqual(telegramImageFromHtml(page("https://telegram.org/img/t_logo.png")), null);
assert.strictEqual(telegramImageFromHtml(page("https://evil.com/cdn-telegram.org/x.jpg")), null);
assert.strictEqual(telegramImageFromHtml("<html>sin meta</html>"), null);

console.log("avatars ok");
