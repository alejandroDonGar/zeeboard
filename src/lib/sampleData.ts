// Example data to try ZeeBoard from an empty install (PLAN-MODERNIZACION M7.2): made-up types, clients, commissions
// and a request, created with the same functions as the app. What it creates is remembered, so it can be removed
// alone later without touching anything typed by hand. Offered only while the app is empty.
import {
  addPayment,
  addRequest,
  createClient,
  createCommission,
  createTemplate,
  deleteClient,
  deleteCommission,
  deleteRequest,
  deleteTemplate,
  finishCommission,
  getRequests,
  getStagesByTemplate,
  getTemplates,
  updateCommissionStage,
} from "./database";
import { isoDay } from "./commissionHelpers";

const KEY = "zeeboard-sample-data";

type SampleIds = { templates: number[]; clients: number[]; commissions: number[]; requests: number[] };

const day = (offset: number) => isoDay(new Date(Date.now() + offset * 86400000));

export function hasSampleData(): boolean {
  return localStorage.getItem(KEY) !== null;
}

export async function loadSampleData(): Promise<void> {
  const ids: SampleIds = { templates: [], clients: [], commissions: [], requests: [] };

  // ponytail: types and requests are found by name after creating them (their create functions return nothing)
  const template = async (name: string, stages: string[]) => {
    await createTemplate(name, stages);
    const id = (await getTemplates()).find((item) => item.name === name)!.id;
    ids.templates.push(id);
    return { id, stages: (await getStagesByTemplate([id]))[id] };
  };
  const sketch = await template("Sketch (example)", ["Sketch", "Delivery"]);
  const flat = await template("Flat colour (example)", ["Sketch", "Lineart", "Flat colour", "Delivery"]);

  const ana = await createClient("Ana (example)", "Bluesky", "@ana_draws", "");
  const leo = await createClient("Leo (example)", "Discord", "leo_art", "");
  ids.clients.push(ana, leo);

  // Halfway, half paid, due in five days
  const half = await createCommission("Fox in a scarf", ana, "Ana (example)", "Bluesky", flat.id, 110, "EUR", day(5), "", 1);
  await updateCommissionStage(half, flat.stages[1].id);
  await addPayment(half, 55, 52.1, day(-6), "Deposit");

  // Late: still on the sketch three days after its date
  const late = await createCommission("Two cats napping", leo, "Leo (example)", "Discord", flat.id, 140, "EUR", day(-3), "", 2);
  await updateCommissionStage(late, flat.stages[0].id);

  // Delivered and paid, so Finished and Statistics have something to show
  const done = await createCommission("Owl portrait", leo, "Leo (example)", "Discord", sketch.id, 60, "EUR", null, "", 1);
  await finishCommission(done, sketch.stages[1].id, { deliveredAt: day(-10), hours: 3, notes: "" });
  await addPayment(done, 60, 57.4, day(-10), "");
  ids.commissions.push(half, late, done);

  await addRequest({
    name: "Mia (example)",
    platform: "Telegram",
    contact: "@mia_oc",
    template_id: sketch.id,
    characters: 1,
    details: "My fox character sitting on a stack of books, warm colours.",
  });
  ids.requests.push((await getRequests()).find((request) => request.name === "Mia (example)")!.id);

  localStorage.setItem(KEY, JSON.stringify(ids));
}

/** Removes only what loadSampleData created (to the trash, like any deletion). */
export async function removeSampleData(): Promise<void> {
  const saved = localStorage.getItem(KEY);
  if (!saved) return;
  const ids: SampleIds = JSON.parse(saved);

  // Commissions before their types and clients, so nothing is still in use; one deleted by hand is simply skipped
  for (const id of ids.commissions) await deleteCommission(id).catch(() => {});
  for (const id of ids.requests) await deleteRequest(id).catch(() => {});
  for (const id of ids.clients) await deleteClient(id).catch(() => {});
  for (const id of ids.templates) await deleteTemplate(id).catch(() => {});
  localStorage.removeItem(KEY);
}
