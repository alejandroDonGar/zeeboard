// @vitest-environment jsdom
// "Stage done" from the iPad: moves once, never past what the iPad saw, never into the hidden delivery stage.
import { beforeEach, expect, test, vi } from "vitest";
import { resetDatabase } from "./support/tauri-sql";

vi.mock("@tauri-apps/plugin-sql", async () => {
  const { loadDatabase } = await import("./support/tauri-sql");
  return { default: { load: async () => loadDatabase() } };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

beforeEach(() => {
  resetDatabase();
  localStorage.clear();
  vi.resetModules();
});

test("a queued commission starts, a stage closes once, and the last visible stage asks to finish instead", async () => {
  const db = await import("../src/lib/database");
  const { advanceFromIpad } = await import("../src/lib/ipad");
  await db.initializeDatabase();
  await db.createTemplate("Three", ["Sketch", "Colour", "Delivery"]);
  const template = (await db.getTemplates()).find((item) => item.name === "Three")!;
  const [sketch, colour] = await db.getTemplateStages(template.id);
  const id = await db.createCommission("Fox", null, "Ana", "", template.id, null, "EUR", null, "", 1);
  const stageOf = async () => (await db.getCommissions()).find((item) => item.id === id)!.current_stage_id;
  await db.updateCommissionStage(id, null); // back to the queue

  await advanceFromIpad({ commissionId: id, from: null });
  expect(await stageOf()).toBe(sketch.id);

  // A second tap with the old stage does nothing
  await expect(advanceFromIpad({ commissionId: id, from: null })).rejects.toThrow();
  expect(await stageOf()).toBe(sketch.id);

  await advanceFromIpad({ commissionId: id, from: sketch.id });
  expect(await stageOf()).toBe(colour.id);

  // Colour is the last visible stage: Delivery is reached only by finishing
  await expect(advanceFromIpad({ commissionId: id, from: colour.id })).rejects.toThrow();
  expect(await stageOf()).toBe(colour.id);
});
