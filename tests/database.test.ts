// The real database.ts against an in-memory SQLite: what the app does with commissions, clients, payments and the trash.
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@tauri-apps/plugin-sql", async () => {
  const { memoryDatabase } = await import("./support/tauri-sql");
  return { default: { load: async () => memoryDatabase() } };
});
// Image files live on disk through Rust; here only the database side matters
vi.mock("../src/lib/images", () => ({
  deleteImageFiles: vi.fn(async () => 0),
  importImageFromDataDir: vi.fn(),
  isProcessedImage: (path: string) => /^images\/[0-9a-f]{24}\.webp$/.test(path),
}));

let db: typeof import("../src/lib/database");

// A new, empty database for every test
beforeEach(async () => {
  vi.resetModules();
  db = await import("../src/lib/database");
  await db.initializeDatabase();
});

async function template(name: string, stages: string[]) {
  await db.createTemplate(name, stages);
  const created = (await db.getTemplates()).find((item) => item.name === name)!;
  return { id: created.id, stages: await db.getTemplateStages(created.id) };
}

const newCommission = (title: string, clientId: number | null, templateId: number | null) =>
  db.createCommission(title, clientId, "Ana", "X", templateId, 60, "EUR", null, "", 1);

const commission = async (id: number) => (await db.getCommissions()).find((item) => item.id === id);

describe("database", () => {
  test("opening the app twice on the same data changes nothing", async () => {
    const before = await db.getTemplates();
    await db.initializeDatabase();
    expect(await db.getTemplates()).toEqual(before);
  });

  test("a template keeps its stages in the order they were written", async () => {
    const { stages } = await template("Bust", ["Sketch", "Lineart", "Colour"]);
    expect(stages.map((stage) => stage.name)).toEqual(["Sketch", "Lineart", "Colour"]);
  });

  test("names are required and trimmed", async () => {
    await expect(db.createClient("   ", "X", "", "")).rejects.toThrow();
    await expect(newCommission("  ", null, null)).rejects.toThrow();

    const id = await db.createClient("  Ana  ", "X", "ana", "");
    expect((await db.getClients()).find((client) => client.id === id)?.name).toBe("Ana");
  });

  test("a new commission starts at the first stage of its template and moves on", async () => {
    const { id: templateId, stages } = await template("Bust", ["Sketch", "Colour", "Delivery"]);
    const id = await newCommission("Ana's bust", null, templateId);
    expect((await commission(id))?.current_stage_id).toBe(stages[0].id);

    await db.updateCommissionStage(id, stages[1].id);
    expect((await commission(id))?.current_stage_id).toBe(stages[1].id);
  });

  test("finishing records the delivery, the hours and the final notes", async () => {
    const { id: templateId, stages } = await template("Bust", ["Sketch", "Delivery"]);
    const id = await newCommission("Ana's bust", null, templateId);

    await db.finishCommission(id, stages[1].id, { deliveredAt: "2026-11-20", hours: 7.5, notes: "Posted" });

    expect(await commission(id)).toMatchObject({ current_stage_id: stages[1].id, delivered_at: "2026-11-20", hours: 7.5, final_notes: "Posted" });
  });

  test("payments and tips are kept apart", async () => {
    const id = await newCommission("Ana's bust", null, null);
    await db.addPayment(id, 60, 57.5, "2026-11-01", " deposit ");
    await db.addPayment(id, 5, 5, "2026-11-02", "", true);

    const payments = (await db.getAllPayments()).filter((payment) => payment.commission_id === id);
    expect(payments.map(({ amount, received, note, tip }) => ({ amount, received, note, tip: Boolean(tip) }))).toEqual([
      { amount: 60, received: 57.5, note: "deposit", tip: false },
      { amount: 5, received: 5, note: null, tip: true },
    ]);
  });

  test("a deleted commission goes to the trash with its payments, and comes back whole", async () => {
    const id = await newCommission("Ana's bust", null, null);
    await db.addPayment(id, 60, 57.5, "2026-11-01", "");

    const trashId = await db.deleteCommission(id);
    expect(await commission(id)).toBeUndefined();
    expect(await db.getAllPayments()).toEqual([]);
    expect((await db.getTrash()).map((entry) => entry.id)).toEqual([trashId]);

    expect(await db.restoreTrash(trashId)).toBe("Ana's bust");
    expect((await commission(id))?.title).toBe("Ana's bust");
    expect((await db.getAllPayments()).map((payment) => payment.amount)).toEqual([60]);
    expect(await db.getTrash()).toEqual([]);
  });

  test("restoring something that is no longer in the trash does nothing", async () => {
    expect(await db.restoreTrash(999)).toBeNull();
  });

  test("a deleted client comes back from the trash with their characters", async () => {
    const clientId = await db.createClient("Ana", "X", "ana", "");
    await db.createClientCharacter(clientId, "Luna", "");

    const trashId = await db.deleteClient(clientId);
    expect(await db.getClients()).toEqual([]);

    await db.restoreTrash(trashId);
    expect((await db.getClients()).map((client) => client.name)).toEqual(["Ana"]);
    expect((await db.getClientCharacters(clientId)).map((character) => character.name)).toEqual(["Luna"]);
  });

  test("tags on a commission are replaced, not added up, and counted", async () => {
    await db.createTag("Rush", "#ff0000", "Extras");
    await db.createTag("Commercial", "#00ff00", "Extras");
    const tags = await db.getTags();
    const rush = tags.find((tag) => tag.name === "Rush")!;
    const commercial = tags.find((tag) => tag.name === "Commercial")!;
    const id = await newCommission("Ana's bust", null, null);

    await db.replaceCommissionTags(id, [rush.id, commercial.id]);
    await db.replaceCommissionTags(id, [commercial.id]);

    expect((await db.getCommissionTags(id)).map((tag) => tag.name)).toEqual(["Commercial"]);
    expect(await db.getTagUsageCounts()).toMatchObject({ [commercial.id]: 1 });
    expect((await db.getTagUsageCounts())[rush.id] ?? 0).toBe(0);
  });
});
