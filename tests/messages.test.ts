// @vitest-environment jsdom
// Messages to clients: the default text until you write yours, with your name and terms link filled in.
import { beforeEach, expect, test, vi } from "vitest";
import { resetDatabase } from "./support/tauri-sql";

vi.mock("@tauri-apps/plugin-sql", async () => {
  const { loadDatabase } = await import("./support/tauri-sql");
  return { default: { load: async () => loadDatabase() } };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));

beforeEach(() => {
  resetDatabase();
  localStorage.clear();
  vi.resetModules();
});

test("a template uses the default text until you write your own, and fills your name and terms link", async () => {
  const db = await import("../src/lib/database");
  const { clientMessage } = await import("../src/lib/commissionHelpers");
  await db.initializeDatabase();

  expect(clientMessage("decline", { client: "Mia" })).toBe("Hi Mia! Thank you for your request. I can't take it right now, sorry.");

  await db.updateSettings({ artist_name: "Zee", tos_url: "zee.art/tos", msg_decline: "Sorry {client}, I'm full. See {tos} — {artist}" });
  expect(clientMessage("decline", { client: "Mia" })).toBe("Sorry Mia, I'm full. See zee.art/tos — Zee");

  // Kept in the database: still there after the app starts again
  await db.loadSettings();
  expect(db.appSettings().msg_decline).toBe("Sorry {client}, I'm full. See {tos} — {artist}");
  // An unknown field stays as typed, so a typo shows instead of vanishing
  expect(clientMessage("payment", { client: "Mia" }, "{client} owes {amount}")).toBe("Mia owes {amount}");
});
