// @vitest-environment jsdom
// Example data for an empty install: loaded with the app's own functions, and removed without touching anything else.
import { beforeEach, expect, test, vi } from "vitest";
import { resetDatabase } from "./support/tauri-sql";

vi.mock("@tauri-apps/plugin-sql", async () => {
  const { loadDatabase } = await import("./support/tauri-sql");
  return { default: { load: async () => loadDatabase() } };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/path", () => ({ appDataDir: async () => "", join: async (...parts: string[]) => parts.join("/") }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("../src/lib/images", () => ({ deleteImageFiles: vi.fn(async () => 0), isProcessedImage: () => false, getThumbPath: (path: string) => path }));

let db: typeof import("../src/lib/database");
let sample: typeof import("../src/lib/sampleData");

beforeEach(async () => {
  resetDatabase();
  localStorage.clear();
  vi.resetModules();
  db = await import("../src/lib/database");
  sample = await import("../src/lib/sampleData");
  await db.initializeDatabase();
});

test("loading fills an empty app: types, clients, a halfway, a late and a delivered commission, and a request", async () => {
  expect(sample.hasSampleData()).toBe(false);
  await sample.loadSampleData();

  expect(sample.hasSampleData()).toBe(true);
  expect((await db.getTemplates()).map((template) => template.name)).toEqual(expect.arrayContaining(["Sketch (example)", "Flat colour (example)"]));
  expect(await db.getCommissions()).toHaveLength(3);
  expect((await db.getCommissions()).find((commission) => commission.title === "Owl portrait")?.delivered_at).not.toBeNull();
  expect(await db.getAllPayments()).toHaveLength(2);
  expect((await db.getRequests()).map((request) => request.name)).toEqual(["Mia (example)"]);
});

test("removing takes away only the examples: what was typed by hand stays", async () => {
  await sample.loadSampleData();
  const mine = await db.createClient("My real client", "X", "me", "");

  await sample.removeSampleData();

  expect(sample.hasSampleData()).toBe(false);
  expect(await db.getCommissions()).toEqual([]);
  expect(await db.getRequests()).toEqual([]);
  expect((await db.getTemplates()).filter((template) => template.name.endsWith("(example)"))).toEqual([]);
  expect((await db.getClients()).map((client) => client.id)).toEqual([mine]);
  // A second time does nothing (and nothing breaks if one was already deleted by hand)
  await sample.removeSampleData();
});
