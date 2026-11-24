// The real database.ts against an in-memory SQLite: what the app does with commissions, clients, payments and the trash.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { rawDatabase, resetDatabase, resetStatementCount, statementCount } from "./support/tauri-sql";
import { readFileSync, readdirSync } from "node:fs";
import { TYPE_CATEGORY } from "../src/lib/catalog";

vi.mock("@tauri-apps/plugin-sql", async () => {
  const { loadDatabase } = await import("./support/tauri-sql");
  return { default: { load: async () => loadDatabase() } };
});
// Tauri around the database: Rust commands answer like the real ones (set per test in `rust`), dialogs, paths, events
const tauri = vi.hoisted(() => ({ rust: {} as Record<string, (args: never) => unknown>, appData: "" }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (command: string, args: never) => tauri.rust[command]?.(args)) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(), open: vi.fn() }));
vi.mock("@tauri-apps/api/path", async () => {
  const { join } = await import("node:path");
  return { appDataDir: async () => tauri.appData, join: async (...parts: string[]) => join(...parts) };
});
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-notification", () => ({ sendNotification: vi.fn() }));
// Image files live on disk through Rust; here only the database side matters
vi.mock("../src/lib/images", () => ({
  deleteImageFiles: vi.fn(async () => 0),
  importImageFromDataDir: vi.fn(),
  isProcessedImage: (path: string) => /^images\/[0-9a-f]{24}\.webp$/.test(path),
  getThumbPath: (path: string) => path.replace("images/", "images/thumbs/"),
}));

let db: typeof import("../src/lib/database");
let images: typeof import("../src/lib/images");

/** The app opened again on the same data (a fresh copy of database.ts, same "file") */
async function reopen() {
  vi.resetModules();
  db = await import("../src/lib/database");
  images = await import("../src/lib/images");
  await db.initializeDatabase();
}

// A new, empty database for every test
beforeEach(async () => {
  vi.clearAllMocks(); // the image mocks keep their calls between tests otherwise
  for (const command of Object.keys(tauri.rust)) delete tauri.rust[command];
  resetDatabase();
  await reopen();
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

const client = async (id: number) => (await db.getClients()).find((item) => item.id === id);
const deletedFiles = () => vi.mocked(images.deleteImageFiles).mock.calls.flatMap(([paths]) => paths);

describe("settings", () => {
  test("survive closing and opening the app", async () => {
    await db.updateSettings({ slots_total: 8, slots_open: true, default_currency: "USD" });
    await db.closeDatabase();
    await reopen();
    expect(db.appSettings()).toMatchObject({ slots_total: 8, slots_open: true, default_currency: "USD", stalled_days: 21 });
  });
});

describe("templates", () => {
  test("name, price, revisions and colour are saved; an empty name is refused", async () => {
    const { id } = await template("Bust", ["Sketch"]);
    await db.updateTemplateName(id, " Half body ");
    await db.updateTemplateBasePrice(id, 40);
    await db.updateTemplateRevisions(id, 2);
    await db.updateTemplateColor(id, "#123456");

    expect((await db.getTemplates()).find((item) => item.id === id)).toMatchObject({
      name: "Half body", base_price: 40, revisions_included: 2, color: "#123456",
    });
    await expect(db.updateTemplateName(id, "  ")).rejects.toThrow();
    await expect(db.createTemplate(" ", ["Sketch"])).rejects.toThrow();
  });

  test("a duplicate is a separate template with the same stages", async () => {
    const { id, stages } = await template("Bust", ["Sketch", "Colour"]);
    await db.duplicateTemplate(id);

    const copy = (await db.getTemplates()).find((item) => item.name === "Bust Copy")!;
    const copyStages = await db.getTemplateStages(copy.id);
    expect(copy.id).not.toBe(id);
    expect(copyStages.map((stage) => stage.name)).toEqual(["Sketch", "Colour"]);
    expect(copyStages.map((stage) => stage.id)).not.toEqual(stages.map((stage) => stage.id));
    await expect(db.duplicateTemplate(999)).rejects.toThrow();
  });

  test("saving stages keeps their ids when renamed or reordered, adds new ones and drops removed ones", async () => {
    const { id, stages: [sketch, , colour] } = await template("Bust", ["Sketch", "Lineart", "Colour"]);

    await db.saveTemplateStages(id, [
      { id: colour.id, name: "Colour" },
      { id: sketch.id, name: " Rough " },
      { id: null, name: "Delivery" },
      { id: null, name: "   " },
    ]);

    const saved = await db.getTemplateStages(id);
    expect(saved.map((stage) => stage.name)).toEqual(["Colour", "Rough", "Delivery"]);
    expect(saved.slice(0, 2).map((stage) => stage.id)).toEqual([colour.id, sketch.id]);
  });

  test("a stage a commission is on can't be removed", async () => {
    const { id, stages: [sketch, colour] } = await template("Bust", ["Sketch", "Colour"]);
    await newCommission("Ana's bust", null, id);

    await expect(db.saveTemplateStages(id, [{ id: colour.id, name: "Colour" }])).rejects.toThrow("Sketch");
    expect((await db.getTemplateStages(id)).map((stage) => stage.id)).toEqual([sketch.id, colour.id]);
  });

  test("a template in use can't be deleted; an unused one goes to the trash and comes back with its stages", async () => {
    const used = await template("Bust", ["Sketch"]);
    await newCommission("Ana's bust", null, used.id);
    await expect(db.deleteTemplate(used.id)).rejects.toThrow();

    const unused = await template("Sticker", ["Sketch", "Colour"]);
    const trashId = await db.deleteTemplate(unused.id);
    expect((await db.getTemplates()).some((item) => item.id === unused.id)).toBe(false);

    await db.restoreTrash(trashId);
    expect((await db.getTemplateStages(unused.id)).map((stage) => stage.name)).toEqual(["Sketch", "Colour"]);
  });
});

describe("commissions", () => {
  test("editing changes the details and trims the texts; the title is required", async () => {
    const id = await newCommission("Ana's bust", null, null);
    await db.updateCommission(id, "  Full body ", null, " Bea ", "IG", 80, "USD", "2026-12-01", " rush ", 2);

    expect(await commission(id)).toMatchObject({
      title: "Full body", client_name: "Bea", platform: "IG", price: 80, currency: "USD",
      deadline: "2026-12-01", notes: "rush", character_count: 2,
    });
    await expect(db.updateCommission(id, " ", null, "", "", null, "EUR", null, "", 1)).rejects.toThrow();
  });

  test("a duplicate keeps the client and gets a numbered title", async () => {
    const clientId = await db.createClient("Ana", "X", "ana", "");
    const id = await newCommission("Bust", clientId, null);

    const first = await db.duplicateCommission(id);
    const second = await db.duplicateCommission(id);

    expect(await commission(first)).toMatchObject({ title: "Bust Copy 1", client_id: clientId, price: 60 });
    expect(await commission(second)).toMatchObject({ title: "Bust Copy 2", client_id: clientId });
    expect(new Set([id, first, second]).size).toBe(3);
    await expect(db.duplicateCommission(999)).rejects.toThrow();
  });

  test("the characters linked to a commission are replaced", async () => {
    const clientId = await db.createClient("Ana", "X", "ana", "");
    await db.createClientCharacter(clientId, "Luna", "");
    await db.createClientCharacter(clientId, "Sol", "");
    const [luna, sol] = await db.getClientCharacters(clientId);
    const id = await newCommission("Bust", clientId, null);

    await db.replaceCommissionCharacters(id, [luna.id, sol.id]);
    await db.replaceCommissionCharacters(id, [sol.id]);

    expect(await db.getCommissionCharacterIds(id)).toEqual([sol.id]);
  });
});

describe("clients and characters", () => {
  test("editing a client trims the texts and clears empty ones; the name is required", async () => {
    const id = await db.createClient("Ana", "X", "ana", "likes cats");
    await db.updateClient(id, " Bea ", "", "  ", " ");

    expect(await client(id)).toMatchObject({ name: "Bea", platform: null, handle: null, notes: null });
    await expect(db.updateClient(id, " ", "", "", "")).rejects.toThrow();
  });

  test("avatar, email and whom to tag when posting", async () => {
    const id = await db.createClient("Ana", "X", "ana", "");
    await db.updateClientAvatar(id, "images/avatar.webp");
    await db.saveClientEmail(id, " ana@example.com ");
    await db.setClientEmail(id, "other@example.com"); // only fills an empty email
    await db.setClientTag(id, "X", "ana");
    expect(await client(id)).toMatchObject({ avatar_url: "images/avatar.webp", email: "ana@example.com", tag_platform: "X", tag_handle: "ana" });

    await db.saveClientEmail(id, "");
    await db.setClientEmail(id, "new@example.com");
    expect((await client(id))?.email).toBe("new@example.com");
  });

  test("a character can be renamed, and deleted to the trash", async () => {
    const clientId = await db.createClient("Ana", "X", "ana", "");
    await expect(db.createClientCharacter(clientId, " ", "")).rejects.toThrow();
    await db.createClientCharacter(clientId, "Luna", "blue eyes");
    const [luna] = await db.getClientCharacters(clientId);

    await db.updateClientCharacter(luna.id, " Sol ", "  ");
    expect(await db.getClientCharacters(clientId)).toMatchObject([{ name: "Sol", notes: null }]);
    await expect(db.updateClientCharacter(luna.id, " ", "")).rejects.toThrow();

    await db.deleteClientCharacter(luna.id);
    expect(await db.getClientCharacters(clientId)).toEqual([]);
    expect(await db.restoreLastTrash()).toBe("Sol");
    expect((await db.getClientCharacters(clientId)).map((character) => character.name)).toEqual(["Sol"]);
  });

  test("the iPad gets the references of the client's characters and of linked collaborators, numbered", async () => {
    const ana = await db.createClient("Ana", "X", "ana", "");
    const bea = await db.createClient("Bea", "X", "bea", "");
    await db.createClientCharacter(ana, "Luna", "");
    await db.createClientCharacter(bea, "Sol", "");
    const [luna] = await db.getClientCharacters(ana);
    const [sol] = await db.getClientCharacters(bea);
    await db.createCharacterReference(luna.id, "images/luna1.webp");
    await db.createCharacterReference(luna.id, "images/luna2.webp");
    await db.createCharacterReference(sol.id, "images/sol1.webp");
    const id = await newCommission("Collab", ana, null);
    await db.replaceCommissionCharacters(id, [sol.id]);

    expect(await db.getCommissionReferences(id)).toEqual([
      { character: "Luna", label: "Reference 1", image_data_url: "images/luna1.webp" },
      { character: "Luna", label: "Reference 2", image_data_url: "images/luna2.webp" },
      { character: "Sol", label: "Reference 1", image_data_url: "images/sol1.webp" },
    ]);

    const [first] = await db.getCharacterReferences(luna.id);
    await db.deleteCharacterReference(first.id);
    expect((await db.getCharacterReferences(luna.id)).map((reference) => reference.image_data_url)).toEqual(["images/luna2.webp"]);
    expect(deletedFiles()).toEqual(["images/luna1.webp"]);
  });

  test("a new reference never repeats the number of one already there, even after deleting", async () => {
    const ana = await db.createClient("Ana", "X", "ana", "");
    await db.createClientCharacter(ana, "Luna", "");
    const [luna] = await db.getClientCharacters(ana);
    await db.createCharacterReference(luna.id, "images/1.webp");
    await db.createCharacterReference(luna.id, "images/2.webp");

    await db.deleteCharacterReference((await db.getCharacterReferences(luna.id))[0].id);
    await db.createCharacterReference(luna.id, "images/3.webp");

    expect((await db.getCharacterReferences(luna.id)).map((reference) => reference.label)).toEqual(["Reference 2", "Reference 3"]);
  });

  test("deleting a client keeps their commissions unlinked; restoring links them again", async () => {
    const clientId = await db.createClient("Ana", "X", "ana", "");
    const id = await newCommission("Bust", clientId, null);

    const trashId = await db.deleteClient(clientId);
    expect((await commission(id))?.client_id).toBeNull();

    await db.restoreTrash(trashId);
    expect((await commission(id))?.client_id).toBe(clientId);
  });
});

describe("stage images and corrections", () => {
  async function stage() {
    const { id: templateId, stages } = await template("Bust", ["Sketch", "Colour"]);
    return { commissionId: await newCommission("Bust", null, templateId), stageId: stages[0].id };
  }

  test("new images are new alternatives; a retouch is the next version of the same alternative", async () => {
    const { commissionId, stageId } = await stage();
    await db.createCommissionStageImage(commissionId, stageId, "images/1.webp");
    await db.createCommissionStageImage(commissionId, stageId, "images/2.webp");
    const [first] = await db.getCommissionStageImages(commissionId);
    await db.createImageVersion(first.id, "images/1b.webp");

    expect((await db.getCommissionStageImages(commissionId)).map(({ alt, version, label }) => [alt, version, label])).toEqual([
      [1, 1, "Alt 1"],
      [1, 2, "Alt 1"],
      [2, 1, "Alt 2"],
    ]);
    await expect(db.createImageVersion(999, "images/x.webp")).rejects.toThrow();
  });

  test("deleting an image keeps its pins as plain corrections and deletes the file nobody else uses", async () => {
    const { commissionId, stageId } = await stage();
    await db.createCommissionStageImage(commissionId, stageId, "images/1.webp");
    await db.createCommissionStageImage(commissionId, stageId, "images/shared.webp");
    await db.createCommissionStageImage(commissionId, stageId, "images/shared.webp");
    const [image, shared] = await db.getCommissionStageImages(commissionId);
    await db.addCorrection(commissionId, stageId, " Bigger nose ", { imageId: image.id, x: 0.5, y: 0.25 });

    await db.deleteCommissionStageImage(image.id);
    await db.deleteCommissionStageImage(shared.id);

    expect(await db.getAllCorrections()).toMatchObject([{ text: "Bigger nose", image_id: null, x: null, y: null }]);
    expect(deletedFiles()).toEqual(["images/1.webp"]);
  });

  test("corrections need text, are marked done and pending again, and go to the trash", async () => {
    const { commissionId, stageId } = await stage();
    await expect(db.addCorrection(commissionId, stageId, "  ")).rejects.toThrow();
    await db.addCorrection(commissionId, stageId, "Smaller ears");
    const [correction] = await db.getAllCorrections();

    await db.setCorrectionDone(correction.id, true);
    expect((await db.getAllCorrections())[0].done_at).not.toBeNull();
    await db.setCorrectionDone(correction.id, false);
    expect((await db.getAllCorrections())[0].done_at).toBeNull();

    await db.deleteCorrection(correction.id);
    expect(await db.getAllCorrections()).toEqual([]);
  });

  test("images in use: references, stage images, local avatars and the trash; not web avatars", async () => {
    const { commissionId, stageId } = await stage();
    const ana = await db.createClient("Ana", "X", "ana", "");
    const bea = await db.createClient("Bea", "X", "bea", "");
    await db.updateClientAvatar(ana, "images/avatar.webp");
    await db.updateClientAvatar(bea, "https://example.com/bea.png");
    await db.createClientCharacter(ana, "Luna", "");
    const [luna] = await db.getClientCharacters(ana);
    await db.createCharacterReference(luna.id, "images/ref.webp");
    await db.createCommissionStageImage(commissionId, stageId, "images/stage.webp");
    await db.createClientCharacter(bea, "Sol", "");
    const [sol] = await db.getClientCharacters(bea);
    await db.createCharacterReference(sol.id, "images/trashed.webp");
    await db.deleteClientCharacter(sol.id);

    expect((await db.getAllUsedImagePaths()).sort()).toEqual(["images/avatar.webp", "images/ref.webp", "images/stage.webp", "images/trashed.webp"]);
  });
});

describe("payments", () => {
  test("PayPal imports remember the last day; the received amount can be fixed; a payment goes to the trash", async () => {
    const id = await newCommission("Bust", null, null);
    expect(await db.getLastImportedPaymentDate()).toBeNull();
    await db.addPayment(id, 10, 10, "2026-12-31", "by hand"); // not imported: doesn't count

    await db.importPayments([
      { commissionId: id, amount: 30, received: 28.5, paidAt: "2026-11-01", externalId: "TX1" },
      { commissionId: id, amount: 30, received: 28.5, paidAt: "2026-11-15", externalId: "TX2" },
    ]);
    expect(await db.getLastImportedPaymentDate()).toBe("2026-11-15");

    const imported = (await db.getAllPayments()).find((payment) => payment.external_id === "TX1")!;
    await db.updatePaymentReceived(imported.id, 29);
    expect((await db.getAllPayments()).find((payment) => payment.id === imported.id)).toMatchObject({ received: 29, note: "PayPal", external_id: "TX1" });

    await db.deletePayment(imported.id);
    expect((await db.getAllPayments()).some((payment) => payment.id === imported.id)).toBe(false);
  });

  test("old Paid tags become one payment per commission, then the payment tags disappear", async () => {
    await db.createTag("Paid", "#00ff00", "Payment");
    await db.createTag("Not paid", "#ff0000", "Payment");
    const paid = (await db.getTags()).find((tag) => tag.name === "Paid")!;
    const id = await newCommission("Bust", null, null);
    await db.replaceCommissionTags(id, [paid.id]);

    await db.migratePaymentTags();
    await db.migratePaymentTags(); // a second run changes nothing

    expect((await db.getAllPayments()).map(({ amount, note }) => ({ amount, note }))).toEqual([{ amount: 60, note: "Imported from Paid tag" }]);
    expect((await db.getTags()).filter((tag) => tag.category === "Payment")).toEqual([]);
  });

  test("payment platforms are saved as a whole list, without empty names", async () => {
    await db.savePaymentPlatforms([
      { name: " PayPal ", percent: 3.4, fixed: 0.35 },
      { name: "  ", percent: 1, fixed: 0 },
      { name: "Ko-fi", percent: 0, fixed: 0 },
    ]);
    await db.savePaymentPlatforms([{ name: "PayPal", percent: 2.9, fixed: 0.3 }]);

    expect((await db.getPaymentPlatforms()).map(({ name, percent, fixed }) => ({ name, percent, fixed }))).toEqual([
      { name: "PayPal", percent: 2.9, fixed: 0.3 },
    ]);
  });
});

describe("requests", () => {
  const response = (externalId: string) => ({
    externalId, created_at: "2026-11-01T10:00:00.000Z", name: `Client ${externalId}`, platform: "X", contact: "@c",
    template_id: null, characters: 1, email: null, tag_platform: null, tag_handle: null, details: null,
  });

  test("a request needs a name, starts as new and asks for at least one character", async () => {
    await expect(db.addRequest({ name: " ", platform: "X", contact: "", template_id: null, characters: 1, details: "" })).rejects.toThrow();
    await db.addRequest({ name: " Bea ", platform: "X", contact: " @bea ", template_id: null, characters: 0, details: "  " });

    expect(await db.getRequests()).toMatchObject([{ name: "Bea", contact: "@bea", characters: 1, details: null, status: "new" }]);
  });

  test("its status, type and the commission it became are saved", async () => {
    const { id: templateId } = await template("Bust", ["Sketch"]);
    await db.addRequest({ name: "Bea", platform: "X", contact: "", template_id: null, characters: 1, details: "" });
    const [request] = await db.getRequests();
    const commissionId = await newCommission("Bea's bust", null, templateId);

    await db.setRequestTemplate(request.id, templateId);
    await db.setRequestStatus(request.id, "accepted", commissionId);

    expect(await db.getRequests()).toMatchObject([{ template_id: templateId, status: "accepted", commission_id: commissionId }]);
  });

  test("form responses are imported once, and a deleted one never comes back, even after emptying the trash", async () => {
    expect(await db.importRequests([response("a"), response("b"), response("a")])).toEqual({ added: 2, skipped: 1 });
    expect(await db.importRequests([response("a"), response("b")])).toEqual({ added: 0, skipped: 2 });

    const a = (await db.getRequests()).find((request) => request.external_id === "a")!;
    await db.deleteRequest(a.id);
    await db.emptyTrash();

    expect(await db.importRequests([response("a")])).toEqual({ added: 0, skipped: 1 });
  });
});

describe("trash", () => {
  test("Ctrl+Z brings back the last deleted thing, and does nothing with an empty trash", async () => {
    expect(await db.restoreLastTrash()).toBeNull();
    await db.createTag("Rush", "#ff0000", "Extras");
    await db.deleteTag((await db.getTags())[0].id);
    await db.deleteClient(await db.createClient("Ana", "X", "ana", ""));

    expect(await db.restoreLastTrash()).toBe("Ana");
    expect(await db.restoreLastTrash()).toBe("Rush");
  });

  test("a deleted tag leaves its commissions and comes back with them; it can be renamed", async () => {
    await db.createTag("Rush", "#ff0000", "Extras");
    const [rush] = await db.getTags();
    await expect(db.updateTag(rush.id, " ", "#000000")).rejects.toThrow();
    await db.updateTag(rush.id, " Urgent ", "#00ff00");
    const id = await newCommission("Bust", null, null);
    await db.replaceCommissionTags(id, [rush.id]);

    const trashId = await db.deleteTag(rush.id);
    expect(await db.getCommissionTags(id)).toEqual([]);

    await db.restoreTrash(trashId);
    expect(await db.getCommissionTags(id)).toMatchObject([{ name: "Urgent", color: "#00ff00" }]);
  });

  test("an image stays on disk while its item is in the trash, and goes when the trash is emptied", async () => {
    const ana = await db.createClient("Ana", "X", "ana", "");
    await db.createClientCharacter(ana, "Luna", "");
    const [luna] = await db.getClientCharacters(ana);
    await db.createCharacterReference(luna.id, "images/luna.webp");

    await db.deleteClientCharacter(luna.id);
    expect(deletedFiles()).toEqual([]);

    expect(await db.emptyTrash()).toBe(1);
    expect(deletedFiles()).toEqual(["images/luna.webp"]);
    expect(await db.getTrash()).toEqual([]);
  });

  test("one entry can be deleted for good, and entries older than 30 days go on their own", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-01-01T10:00:00Z"));
      await db.deleteClient(await db.createClient("Old", "X", "old", ""));
      vi.setSystemTime(new Date("2026-03-01T10:00:00Z"));
      const keep = await db.deleteClient(await db.createClient("Recent", "X", "recent", ""));
      const drop = await db.deleteClient(await db.createClient("Drop", "X", "drop", ""));

      expect(await db.purgeTrashEntry(drop)).toBe(1);
      expect(await db.purgeOldTrash()).toBe(1);
      expect((await db.getTrash()).map((entry) => entry.id)).toEqual([keep]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("helpers that read the database", () => {
  test("open commissions are the ones not at the last stage of their template, or without one", async () => {
    const helpers = await import("../src/lib/commissionHelpers");
    const { id: templateId, stages } = await template("Bust", ["Sketch", "Delivery"]);
    const open = await newCommission("Open", null, templateId);
    const done = await newCommission("Done", null, templateId);
    const loose = await newCommission("Without template", null, null);
    await db.updateCommissionStage(done, stages[1].id);

    expect((await helpers.loadOpenCommissions()).map((item) => item.id).sort()).toEqual([open, loose].sort());
  });

  test("stage images are loaded for each commission", async () => {
    const helpers = await import("../src/lib/commissionHelpers");
    const { id: templateId, stages } = await template("Bust", ["Sketch"]);
    const withImage = await newCommission("With image", null, templateId);
    const without = await newCommission("Without", null, templateId);
    await db.createCommissionStageImage(withImage, stages[0].id, "images/1.webp");

    const loaded = await helpers.loadStageImagesForCommissions(await db.getCommissions());
    expect(loaded[withImage].map((image) => image.image_data_url)).toEqual(["images/1.webp"]);
    expect(loaded[without]).toEqual([]);
  });
});

describe("CSV export to a file", () => {
  test("each export asks where to save and writes the CSV with a BOM for Excel", async () => {
    const { exportCsv } = await import("../src/lib/export");
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { invoke } = await import("@tauri-apps/api/core");
    await newCommission("Bust", null, null);
    vi.mocked(save).mockResolvedValue("C:/exports/out.csv");

    for (const [kind, header] of [["commissions", "Title;"], ["payments", "Date;"], ["quarterly", "Quarter;"]] as const) {
      expect(await exportCsv(kind)).toBe("C:/exports/out.csv");
      const { path, contents } = vi.mocked(invoke).mock.lastCall![1] as { path: string; contents: string };
      expect(path).toBe("C:/exports/out.csv");
      expect(contents.startsWith(`\uFEFF${header}`)).toBe(true);
    }
  });

  test("closing the save dialog writes nothing", async () => {
    const { exportCsv } = await import("../src/lib/export");
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(save).mockResolvedValue(null);

    expect(await exportCsv("payments")).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("what needs attention", () => {
  test("late, unpaid after the sketch and stalled commissions are found in the database", async () => {
    const { loadAttention } = await import("../src/lib/reminders");
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await db.updateSettings({ promise_max_days: 365 });
      const { id: templateId, stages } = await template("Bust", ["Sketch", "Lineart", "Colour"]);
      vi.setSystemTime(new Date("2026-01-01T10:00:00"));
      await newCommission("Stalled", null, templateId);
      vi.setSystemTime(new Date("2026-03-01T10:00:00"));
      await db.createCommission("Late", null, "Ana", "X", templateId, 60, "EUR", "2026-02-20", "", 1);
      const unpaid = await newCommission("Unpaid", null, templateId);
      await db.updateCommissionStage(unpaid, stages[1].id);

      const kinds = Object.fromEntries((await loadAttention(new Date("2026-03-01T12:00:00"))).map((item) => [item.commission.title, item.kind]));
      expect(kinds).toEqual({ Late: "overdue", Unpaid: "payment", Stalled: "stalled" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("around the data: undo, form sync, backups and the iPad", () => {
  const page = () => window as unknown as { dispatchEvent: ReturnType<typeof vi.fn>; location: { reload: ReturnType<typeof vi.fn> } };
  const sentEvents = () => page().dispatchEvent.mock.calls.map(([event]) => (event as Event).type);
  let folder = "";

  beforeEach(async () => {
    const { mkdtempSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    folder = mkdtempSync(join(tmpdir(), "zeeboard-test-"));
    tauri.appData = folder;
    const data: Record<string, string> = {};
    vi.stubGlobal("window", { dispatchEvent: vi.fn(), location: { reload: vi.fn() } });
    vi.stubGlobal("localStorage", { getItem: (key: string) => data[key] ?? null, setItem: (key: string, value: string) => void (data[key] = value) });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    (await import("node:fs")).rmSync(folder, { recursive: true, force: true });
  });

  describe("undo", () => {
    test("the Undo button of the deleted toast brings it back and tells the screens; a second click does nothing", async () => {
      const { undoToast, DATA_RESTORED } = await import("../src/lib/undo");
      const trashId = await db.deleteClient(await db.createClient("Ana", "X", "ana", ""));
      const toasts: unknown[][] = [];
      undoToast((...toast) => void toasts.push(toast), "Client deleted.", trashId);
      const { label, onClick } = toasts[0][2] as { label: string; onClick: () => void };
      expect(label).toBe("Undo");

      onClick();
      await vi.waitFor(() => expect(toasts).toHaveLength(2));
      expect(toasts[1]).toEqual(["Restored “Ana”.", "success"]);
      expect(sentEvents()).toEqual([DATA_RESTORED]);
      expect((await db.getClients()).map((client) => client.name)).toEqual(["Ana"]);

      onClick();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(toasts).toHaveLength(2);
    });

    test("if undoing fails, it says so", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { undoToast } = await import("../src/lib/undo");
      const toasts: unknown[][] = [];
      undoToast((...toast) => void toasts.push(toast), "Deleted.", 1);
      rawDatabase().close();

      (toasts[0][2] as { onClick: () => void }).onClick();
      await vi.waitFor(() => expect(toasts[1]).toEqual(["Could not undo.", "error"]));
    });
  });

  describe("form responses from Drive", () => {
    const csv = (...handles: string[]) =>
      ["Timestamp,Handle,Type of commission", ...handles.map((handle, index) => `2026/10/0${index + 1} 4:59:22 p. m. CET,Telegram @${handle},Bust`)].join("\n");

    test("with no file chosen there is nothing to read", async () => {
      expect(await (await import("../src/lib/formSync")).syncFormResponses()).toBeNull();
    });

    test("new responses are saved, notified once and announced; the check date is kept", async () => {
      const { syncFormResponses, REQUESTS_CHANGED } = await import("../src/lib/formSync");
      const { sendNotification } = await import("@tauri-apps/plugin-notification");
      await db.updateSettings({ responses_file: "C:/Drive/responses.csv" });
      tauri.rust.read_text_file = () => csv("fox_one", "fox_two");

      expect(await syncFormResponses()).toEqual({ added: 2, skipped: 0 });
      expect(sendNotification).toHaveBeenCalledWith({ title: "ZeeBoard", body: "2 new commission requests" });
      expect(db.appSettings().last_form_sync).not.toBeNull();

      expect(await syncFormResponses()).toEqual({ added: 0, skipped: 2 });
      expect(sendNotification).toHaveBeenCalledOnce();
      expect(sentEvents()).toEqual([REQUESTS_CHANGED, REQUESTS_CHANGED]);

      tauri.rust.read_text_file = () => csv("fox_one", "fox_two", "fox_three");
      await syncFormResponses();
      expect(sendNotification).toHaveBeenLastCalledWith({ title: "ZeeBoard", body: "1 new commission request" });
    });

    test("a file that isn't the form fails with the reason", async () => {
      await db.updateSettings({ responses_file: "C:/Drive/other.csv" });
      tauri.rust.read_text_file = () => "a,b\n1,2";
      await expect((await import("../src/lib/formSync")).syncFormResponses()).rejects.toThrow();
    });
  });

  describe("backups", () => {
    beforeEach(async () => {
      const { mkdirSync } = await import("node:fs");
      tauri.rust.prepare_backup = ({ dir }: { dir: string }) => void mkdirSync(dir, { recursive: true });
      tauri.rust.finish_backup = () => 1;
    });
    const finishCalls = async () => vi.mocked((await import("@tauri-apps/api/core")).invoke).mock.calls.filter(([command]) => command === "finish_backup").map(([, args]) => args);

    test("exporting copies the database into a dated folder where you choose", async () => {
      const backup = await import("../src/lib/backup");
      const { open } = await import("@tauri-apps/plugin-dialog");
      const { join } = await import("node:path");
      await newCommission("Bust", null, null);
      vi.mocked(open).mockResolvedValue(folder);

      const path = (await backup.exportBackup())!;
      expect(path).toMatch(/zeeboard-backup-\d{4}-\d{2}-\d{2}-\d{6}$/);
      const copy = new DatabaseSync(join(path, "zeeboard.db"));
      expect(copy.prepare("SELECT title FROM commissions").all()).toEqual([{ title: "Bust" }]);
      copy.close();
      expect(await finishCalls()).toEqual([{ dir: path, keep: null }]);
    });

    test("closing the folder picker, or a picker that returns several, makes no backup", async () => {
      const backup = await import("../src/lib/backup");
      const { open } = await import("@tauri-apps/plugin-dialog");
      vi.mocked(open).mockResolvedValueOnce(null).mockResolvedValueOnce(["a", "b"]).mockResolvedValueOnce("C:/Backups/old");

      expect(await backup.exportBackup()).toBeNull();
      expect(await backup.exportBackup()).toBeNull();
      expect(await backup.pickBackupFolder()).toBe("C:/Backups/old");
    });

    test("automatic backups: once a day, when enabled and with a folder; forcing runs it anyway", async () => {
      const backup = await import("../src/lib/backup");
      expect(await backup.runAutoBackup()).toBeNull();
      await expect(backup.runAutoBackup(true)).rejects.toThrow();

      await db.updateSettings({ auto_backup_folder: folder });
      expect(await backup.runAutoBackup()).toBeNull(); // not enabled

      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(new Date("2026-11-20T09:00:00"));
        await db.updateSettings({ auto_backup_enabled: true });
        expect(await backup.runAutoBackup()).toContain(folder);
        expect(db.appSettings().last_auto_backup).not.toBeNull();
        expect(await backup.runAutoBackup()).toBeNull(); // already done today
        vi.setSystemTime(new Date("2026-11-20T09:00:30")); // "Back up now" half a minute later: its own folder
        expect(await backup.runAutoBackup(true)).toContain(folder);
        expect((await finishCalls()).map((args) => (args as { keep: number }).keep)).toEqual([7, 7]);
      } finally {
        vi.useRealTimers();
      }
    });

    test("if the database copy fails, the half-made folder is cleaned up and the error is reported", async () => {
      const backup = await import("../src/lib/backup");
      const { open } = await import("@tauri-apps/plugin-dialog");
      tauri.rust.prepare_backup = () => undefined; // no folder: VACUUM INTO can't write
      vi.mocked(open).mockResolvedValue(folder);

      await expect(backup.exportBackup()).rejects.toThrow();
      expect((await finishCalls()).map((args) => (args as { keep: null }).keep)).toEqual([null]);
    });

    test("before cleaning up images, a backup goes to the app folder, keeping the last two", async () => {
      await (await import("../src/lib/backup")).backupBeforeCleanup();
      const [args] = (await finishCalls()) as { dir: string; keep: number }[];
      expect(args.dir).toContain("before-cleanup");
      expect(args.keep).toBe(2);
    });

    test("restoring closes the database, asks Rust to swap the data and reloads the app", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      tauri.rust.restore_backup = () => "safety-copy";
      await (await import("../src/lib/backup")).restoreBackup("C:/Backups/old");

      expect(invoke).toHaveBeenCalledWith("restore_backup", { backupDir: "C:/Backups/old", stamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}-\d{6}$/) });
      expect(page().location.reload).toHaveBeenCalledOnce();
    });
  });

  describe("iPad", () => {
    const PROCESSED = (n: number) => `images/${String(n).padStart(24, "0")}.webp`;
    const snapshot = async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const [, args] = vi.mocked(invoke).mock.calls.filter(([command]) => command === "ipad_set_snapshot").at(-1)!;
      return JSON.parse((args as { json: string }).json);
    };

    test("a secret key is created once and remembered", async () => {
      const ipad = await import("../src/lib/ipad");
      const first = ipad.ipadSettings();
      expect(first).toMatchObject({ enabled: false, port: 8787 });
      expect(first.token).toMatch(/^[0-9a-f]{32}$/);
      expect(ipad.ipadSettings().token).toBe(first.token);

      ipad.saveIpadSettings({ enabled: true, port: 9000, token: "abc" });
      expect(ipad.ipadSettings()).toEqual({ enabled: true, port: 9000, token: "abc" });
    });

    test("without storage the iPad still gets settings, with a new key each time", async () => {
      const fail = () => {
        throw new Error("storage disabled");
      };
      vi.stubGlobal("localStorage", { getItem: fail, setItem: fail });
      const ipad = await import("../src/lib/ipad");
      expect(ipad.ipadSettings().token).not.toBe(ipad.ipadSettings().token);
    });

    test("the list shows open commissions, their stages without the hidden delivery one, the newest version of each alternative and processed references", async () => {
      const ipad = await import("../src/lib/ipad");
      const ana = await db.createClient("Ana", "X", "ana", "");
      await db.createClientCharacter(ana, "Luna", "");
      const [luna] = await db.getClientCharacters(ana);
      await db.createCharacterReference(luna.id, PROCESSED(1));
      await db.createCharacterReference(luna.id, "old/luna.png"); // not served: only processed images
      const { id: templateId, stages: [sketch, colour, delivery] } = await template("Bust", ["Sketch", "Colour", "Delivery"]);
      const open = await newCommission("Open", ana, templateId);
      await db.createCommissionStageImage(open, sketch.id, PROCESSED(2));
      await db.createCommissionStageImage(open, sketch.id, "old/alt2.png");
      await db.createImageVersion((await db.getCommissionStageImages(open))[0].id, PROCESSED(3));
      const finished = await newCommission("Finished", ana, templateId);
      await db.updateCommissionStage(finished, delivery.id);
      await newCommission("Without template", ana, null);
      await newCommission("Open too", ana, templateId); // same template: its stages are read once
      const { id: noStages } = await template("Sticker", []);
      await db.createCommission("No stages", null, "", "X", noStages, null, "EUR", null, "", 1); // and no client name

      await ipad.pushSnapshot();

      const { commissions } = await snapshot();
      const listed = (title: string) => commissions.find((item: { title: string }) => item.title === title);
      expect(commissions.map((item: { title: string }) => item.title).sort()).toEqual(["No stages", "Open", "Open too"]);
      expect(listed("Open")).toEqual({
        id: open, title: "Open", client: "Ana", currentStageId: sketch.id, lastStageId: delivery.id,
        refs: [{ character: "Luna", label: "Reference 1", image: PROCESSED(1), thumb: PROCESSED(1).replace("images/", "images/thumbs/") }],
        stages: [
          { id: sketch.id, name: "Sketch", alts: [
            { alt: 1, label: "Alt 1", version: 2, thumb: PROCESSED(3).replace("images/", "images/thumbs/") },
            { alt: 2, label: "Alt 2", version: 1, thumb: null },
          ] },
          { id: colour.id, name: "Colour", alts: [] },
        ],
      });
      expect(listed("No stages")).toMatchObject({ client: "", lastStageId: null, stages: [], refs: [] });
      expect(listed("Open too").stages.map((stage: { name: string }) => stage.name)).toEqual(["Sketch", "Colour"]);
    });

    test("starting sends the port and key, then the list; stopping and the addresses go to Rust", async () => {
      const ipad = await import("../src/lib/ipad");
      const { invoke } = await import("@tauri-apps/api/core");
      ipad.saveIpadSettings({ enabled: true, port: 9000, token: "abc" });
      tauri.rust.ipad_addresses = () => ["192.168.1.20"];

      await ipad.startIpad();
      await ipad.stopIpad();
      expect(await ipad.ipadAddresses()).toEqual(["192.168.1.20"]);
      expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual(["ipad_start", "ipad_set_snapshot", "ipad_stop", "ipad_addresses"]);
      expect(invoke).toHaveBeenCalledWith("ipad_start", { port: 9000, token: "abc" });
    });

    test("an image from the iPad is a new alternative, the next version of the chosen one, or a new one if that is gone", async () => {
      const ipad = await import("../src/lib/ipad");
      const { id: templateId, stages: [sketch] } = await template("Bust", ["Sketch", "Delivery"]);
      const id = await newCommission("Bust", null, templateId);
      const send = (alt: number | null, n: number) => ipad.saveIpadImage({ commissionId: id, stageId: sketch.id, alt, stored: { path: PROCESSED(n) } });

      expect(await send(null, 1)).toBe(true);
      expect(await send(1, 2)).toBe(true);
      expect(await send(9, 3)).toBe(false);

      expect((await db.getCommissionStageImages(id)).map(({ alt, version }) => [alt, version])).toEqual([[1, 1], [1, 2], [2, 1]]);
      expect(sentEvents()).toEqual([ipad.IPAD_IMAGE_ADDED, ipad.IPAD_IMAGE_ADDED, ipad.IPAD_IMAGE_ADDED]);
    });

    test("finishing from the iPad uses the last stage, and fails if the commission or its stages are gone", async () => {
      const ipad = await import("../src/lib/ipad");
      const { id: templateId, stages } = await template("Bust", ["Sketch", "Delivery"]);
      const id = await newCommission("Bust", null, templateId);
      const finish = (commissionId: number) => ipad.finishFromIpad({ commissionId, deliveredAt: "2026-11-20", hours: 3, notes: "Posted" });

      await finish(id);
      expect(await commission(id)).toMatchObject({ current_stage_id: stages[1].id, delivered_at: "2026-11-20", hours: 3 });
      expect(sentEvents()).toEqual([ipad.IPAD_IMAGE_ADDED]);

      await expect(finish(999)).rejects.toThrow();
      await expect(finish(await newCommission("Loose", null, null))).rejects.toThrow();
      const { id: empty } = await template("Empty", []);
      await expect(finish(await newCommission("Empty", null, empty))).rejects.toThrow("no stages");
    });

    test("images and finishes announced by Rust reach their listeners", async () => {
      const ipad = await import("../src/lib/ipad");
      const { listen } = await import("@tauri-apps/api/event");
      const onImage = vi.fn();
      const onFinish = vi.fn();
      await ipad.listenIpadImages(onImage);
      await ipad.listenIpadFinish(onFinish);

      const handler = (name: string) => vi.mocked(listen).mock.calls.find(([event]) => event === name)![1] as (event: { payload: unknown }) => void;
      handler("ipad-image")({ payload: { commissionId: 1 } });
      handler("ipad-finish")({ payload: { commissionId: 2 } });
      expect(onImage).toHaveBeenCalledWith({ commissionId: 1 });
      expect(onFinish).toHaveBeenCalledWith({ commissionId: 2 });
    });
  });
});

describe("schema versions", () => {
  const version = () => (rawDatabase().prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  const columns = (table: string) => (rawDatabase().prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((column) => column.name);

  test("a new database ends at the latest version", () => {
    expect(db.SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
    expect(version()).toBe(db.SCHEMA_VERSION);
  });

  test("opening the app again runs no migration: only reading the version and the settings", async () => {
    resetStatementCount();
    await reopen();
    expect(statementCount()).toBeLessThanOrEqual(3);
  });

  test("a database from before versions keeps its data and gets every new column, once", async () => {
    resetDatabase();
    rawDatabase().exec(`
      CREATE TABLE settings (id INTEGER PRIMARY KEY, language TEXT NOT NULL DEFAULT 'en', theme TEXT NOT NULL DEFAULT 'zebra-light');
      INSERT INTO settings (id) VALUES (1);
      CREATE TABLE templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
      INSERT INTO templates (name) VALUES ('Bust');
      CREATE TABLE commissions (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, client_id INTEGER, template_id INTEGER,
        current_stage_id INTEGER, price REAL, deadline TEXT, notes TEXT, created_at TEXT NOT NULL);
      INSERT INTO commissions (title, template_id, price, created_at) VALUES ('Old bust', 1, 60, '2025-05-01T10:00:00.000Z');
      CREATE TABLE commission_stage_images (id INTEGER PRIMARY KEY AUTOINCREMENT, commission_id INTEGER NOT NULL, stage_id INTEGER NOT NULL,
        label TEXT NOT NULL DEFAULT 'Alt 1', image_data_url TEXT NOT NULL, created_at TEXT NOT NULL);
      INSERT INTO commission_stage_images (commission_id, stage_id, image_data_url, created_at) VALUES (1, 5, 'a.png', 'x'), (1, 5, 'b.png', 'y');
    `);

    await reopen();

    expect(version()).toBe(db.SCHEMA_VERSION);
    expect(await db.getCommissions()).toMatchObject([{ title: "Old bust", price: 60, currency: "EUR", character_count: 1 }]);
    expect((await db.getTemplates())[0].color).toMatch(/^#[0-9a-f]{6}$/i);
    expect((await db.getCommissionStageImages(1)).map(({ alt, version: v }) => [alt, v])).toEqual([[1, 1], [2, 1]]);
    expect(columns("commissions")).toEqual(expect.arrayContaining(["delivered_at", "hours", "final_notes", "stage_changed_at"]));
  });

  test("a database that can't be brought up to date stops the start with its error, and keeps its version", async () => {
    resetDatabase();
    rawDatabase().exec("CREATE VIEW commissions AS SELECT 1 AS id"); // a column can't be added to a view

    await expect(reopen()).rejects.toThrow("view");
    expect(version()).toBe(0);
  });

  test("every column the code writes exists in a new database", () => {
    const files = readdirSync(new URL("../src/lib/", import.meta.url)).filter((name) => name.endsWith(".ts"));
    const missing: string[] = [];
    let checked = 0;

    for (const name of files) {
      const text = readFileSync(new URL(`../src/lib/${name}`, import.meta.url), "utf8");
      const writes = [
        ...[...text.matchAll(/INSERT(?: OR \w+)? INTO (\w+)\s*\(([^)]*)\)/g)].map(([, table, list]) => [table, list.split(",").map((c) => c.trim())] as const),
        ...[...text.matchAll(/UPDATE (\w+)\s+SET\s+([^;`]*?)\s+WHERE/gs)].map(([, table, sets]) => [table, [...sets.matchAll(/(\w+)\s*=/g)].map((m) => m[1])] as const),
      ];
      for (const [table, written] of writes) {
        const have = columns(table);
        if (have.length === 0) continue; // a word in a comment, not a table
        for (const column of written) {
          checked += 1;
          if (!have.includes(column)) missing.push(`${name}: ${table}.${column}`);
        }
      }
    }

    expect(missing).toEqual([]);
    expect(checked).toBeGreaterThan(100); // the pattern still finds the statements
  });
});

describe("data left by older versions, and empty fields", () => {
  test("templates from before colours get the colour of their old type tag, or one from the palette", async () => {
    resetDatabase(); // a database from the version where the type was a tag and templates had no colour
    rawDatabase().exec(`
      CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, color TEXT NOT NULL, category TEXT DEFAULT 'General');
      INSERT INTO tags (name, color, category) VALUES ('Bust', '#abcdef', '${TYPE_CATEGORY}');
      CREATE TABLE templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
      INSERT INTO templates (name) VALUES ('Bust'), ('Sticker');
    `);

    await reopen();

    const colours = Object.fromEntries((await db.getTemplates()).map((item) => [item.name, item.color]));
    expect(colours.Bust).toBe("#abcdef");
    expect(colours.Sticker).toMatch(/^#[0-9a-f]{6}$/i);
  });

  test("requests deleted before they were remembered for good still don't come back from the form", async () => {
    await db.importRequests([{
      externalId: "a", created_at: "2026-11-01T10:00:00.000Z", name: "Bea", platform: "X", contact: "", template_id: null,
      characters: 1, email: null, tag_platform: null, tag_handle: null, details: null,
    }]);
    await db.deleteRequest((await db.getRequests())[0].id);
    rawDatabase().exec(`DELETE FROM ignored_requests;`); // as an older version left it: only in the trash

    const again = await db.importRequests([{
      externalId: "a", created_at: "2026-11-01T10:00:00.000Z", name: "Bea", platform: "X", contact: "", template_id: null,
      characters: 1, email: null, tag_platform: null, tag_handle: null, details: null,
    }]);
    expect(again).toEqual({ added: 0, skipped: 1 });
  });

  test("deleting something that doesn't exist fails without touching the trash", async () => {
    await expect(db.deleteCommission(999)).rejects.toThrow();
    expect(await db.getTrash()).toEqual([]);
  });

  test("a tag needs a name", async () => {
    await expect(db.createTag("  ", "#ff0000", "Extras")).rejects.toThrow();
  });

  test("empty texts are saved as empty, not as blank strings", async () => {
    const { id: templateId, stages } = await template("Empty", []);
    expect(stages).toEqual([]);
    const id = await db.createCommission("Bust", null, "  ", "X", templateId, null, "EUR", null, "", 1);
    expect(await commission(id)).toMatchObject({ client_name: null, current_stage_id: null, notes: null });

    await db.updateCommission(id, "Bust", null, " ", "X", null, "EUR", null, " ", 1);
    await db.finishCommission(id, 0, { deliveredAt: "2026-11-20", hours: null, notes: "" });
    expect(await commission(id)).toMatchObject({ client_name: null, notes: null, final_notes: null });

    const clientId = await db.createClient("Ana", "", "  ", "");
    expect(await client(clientId)).toMatchObject({ platform: null, handle: null, notes: null });
  });

  test("every on/off setting is saved both ways", async () => {
    const all = { auto_backup_enabled: true, reminders_enabled: true, stalled_enabled: true, slots_open: true };
    await db.updateSettings(all);
    await reopen();
    expect(db.appSettings()).toMatchObject(all);

    const none = { auto_backup_enabled: false, reminders_enabled: false, stalled_enabled: false, slots_open: false };
    await db.updateSettings(none);
    await reopen();
    expect(db.appSettings()).toMatchObject(none);
  });
});

describe("images from older versions", () => {
  test("full-size images are converted to the new format; the ones that fail are counted and kept", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(images.importImageFromDataDir).mockImplementation(async (path: string) => {
      if (path === "old/bad.png") throw new Error("unreadable");
      return { path: "images/0123456789abcdef01234567.webp" } as Awaited<ReturnType<typeof images.importImageFromDataDir>>;
    });
    const ana = await db.createClient("Ana", "X", "ana", "");
    await db.createClientCharacter(ana, "Luna", "");
    const [luna] = await db.getClientCharacters(ana);
    await db.createCharacterReference(luna.id, "old/luna.png");
    await db.createCharacterReference(luna.id, "old/bad.png");
    await db.createCharacterReference(luna.id, "images/abcdefabcdefabcdefabcdef.webp"); // already converted
    const progress: [number, number][] = [];

    expect(await db.migrateLegacyImages((done, total) => progress.push([done, total]))).toEqual({ migrated: 1, failed: 1 });
    expect((await db.getCharacterReferences(luna.id)).map((reference) => reference.image_data_url)).toEqual([
      "images/0123456789abcdef01234567.webp",
      "old/bad.png",
      "images/abcdefabcdefabcdefabcdef.webp",
    ]);
    expect(progress).toEqual([[0, 2], [1, 2], [2, 2]]);
  });

  test("the conversion also works without anyone watching its progress", async () => {
    vi.mocked(images.importImageFromDataDir).mockResolvedValue(
      { path: "images/0123456789abcdef01234567.webp" } as Awaited<ReturnType<typeof images.importImageFromDataDir>>,
    );
    const ana = await db.createClient("Ana", "X", "ana", "");
    await db.createClientCharacter(ana, "Luna", "");
    const [luna] = await db.getClientCharacters(ana);
    await db.createCharacterReference(luna.id, "old/luna.png");

    expect(await db.migrateLegacyImages()).toEqual({ migrated: 1, failed: 0 });
  });
});
