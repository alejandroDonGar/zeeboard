import { t } from "./i18n";
import Database from "@tauri-apps/plugin-sql";
import { newResponses, type ImportedRequest } from "./formImport";
import { PALETTE } from "./catalog";
import {
  imagePathsOf,
  insertStatement,
  KINDS,
  planRestore,
  REFERENCED_TABLES,
  TRASH_DAYS,
  type Existing,
  type Snapshot,
  type TrashKind,
} from "./trash";
import {
  deleteImageFiles,
  importImageFromDataDir,
  isProcessedImage,
} from "./images";

export type ZeeDatabase = Awaited<ReturnType<typeof Database.load>>;

let db: ZeeDatabase | null = null;
let transactionQueue: Promise<unknown> = Promise.resolve();

async function runSerialized<T>(
  work: (database: ZeeDatabase) => Promise<T>,
): Promise<T> {
  const database = await getDatabase();

  const run = () => work(database);

  const resultPromise = transactionQueue.then(run, run);

  transactionQueue = resultPromise.then(
    () => undefined,
    () => undefined,
  );

  return resultPromise;
}

export type Template = {
  id: number;
  name: string;
  /** Price for one character; each extra character adds a percentage (see calculateCommissionPrice) */
  base_price: number | null;
  /** Corrections included in the price; null = unlimited (no counter shown) */
  revisions_included: number | null;
  /** Colour of the commission type: the bar and chip of every commission with this template */
  color: string;
};

export type TemplateStage = {
  id: number;
  template_id: number;
  name: string;
  stage_order: number;
};

export async function getDatabase(): Promise<ZeeDatabase> {
  if (db) return db;

  db = await Database.load("sqlite:zeeboard.db");

  await db.execute("PRAGMA busy_timeout = 5000;");

  return db;
}

/** Closes the connection: needed before replacing the file when restoring a backup */
export async function closeDatabase(): Promise<void> {
  if (db) {
    await db.close();
    db = null;
  }
}

export type AppSettings = {
  default_currency: string;
  /** 0.5 = each extra character adds 50% of the base price */
  extra_character_rate: number;
  auto_backup_enabled: boolean;
  auto_backup_folder: string | null;
  /** How many automatic backups are kept */
  auto_backup_keep: number;
  /** When the last automatic backup ran (ISO) */
  last_auto_backup: string | null;
  /** The longest you promise a client: with no deadline, the limit counts from acceptance */
  promise_max_days: number;
  reminders_enabled: boolean;
  /** Delivery reminders: this many days before and on the day */
  reminder_days_before: number;
  stalled_enabled: boolean;
  /** Stalled-commission alert: days without changes */
  stalled_days: number;
  /** Are you accepting commissions now? (you open and close the external form) */
  slots_open: boolean;
  /** How many open commissions you take at once */
  slots_total: number;
  /** CSV of form responses (kept up to date by the Google script in your Drive) */
  responses_file: string | null;
  last_form_sync: string | null;
  /** Messages to clients: {artist} and {tos} in any template */
  artist_name: string | null;
  tos_url: string | null;
  /** Your own text for each template; null = the default one, in the app's language */
  msg_stage: string | null;
  msg_payment: string | null;
  msg_delivery: string | null;
  msg_decline: string | null;
};

// Loaded once at startup so any screen can read them without await
let settings: AppSettings = {
  default_currency: "EUR",
  extra_character_rate: 0.5,
  auto_backup_enabled: false,
  auto_backup_folder: null,
  auto_backup_keep: 7,
  last_auto_backup: null,
  promise_max_days: 60,
  reminders_enabled: true,
  reminder_days_before: 3,
  stalled_enabled: true,
  stalled_days: 21,
  slots_open: false,
  slots_total: 5,
  responses_file: null,
  last_form_sync: null,
  artist_name: null,
  tos_url: null,
  msg_stage: null,
  msg_payment: null,
  msg_delivery: null,
  msg_decline: null,
};

export function appSettings(): AppSettings {
  return settings;
}

/** Reads the settings into memory; schema.ts calls it after migrating. */
export async function loadSettings(): Promise<void> {
  const database = await getDatabase();
  type Row = Omit<AppSettings, "auto_backup_enabled" | "reminders_enabled" | "stalled_enabled" | "slots_open"> & {
    auto_backup_enabled: number;
    reminders_enabled: number;
    stalled_enabled: number;
    slots_open: number;
  };

  const rows = await database.select<Row[]>(
    `SELECT default_currency, extra_character_rate, auto_backup_enabled, auto_backup_folder, auto_backup_keep,
       last_auto_backup, promise_max_days, reminders_enabled, reminder_days_before, stalled_enabled, stalled_days,
       slots_open, slots_total, responses_file, last_form_sync, artist_name, tos_url, msg_stage, msg_payment, msg_delivery, msg_decline
     FROM settings WHERE id = 1;`,
  );

  if (rows[0]) {
    settings = {
      ...rows[0],
      auto_backup_enabled: Boolean(rows[0].auto_backup_enabled),
      reminders_enabled: Boolean(rows[0].reminders_enabled),
      stalled_enabled: Boolean(rows[0].stalled_enabled),
      slots_open: Boolean(rows[0].slots_open),
    };
  }
}

export async function updateSettings(changes: Partial<AppSettings>): Promise<void> {
  const database = await getDatabase();
  const next = { ...settings, ...changes };

  await database.execute(
    `UPDATE settings SET default_currency = ?, extra_character_rate = ?, auto_backup_enabled = ?,
       auto_backup_folder = ?, auto_backup_keep = ?, last_auto_backup = ?, promise_max_days = ?,
       reminders_enabled = ?, reminder_days_before = ?, stalled_enabled = ?, stalled_days = ?,
       slots_open = ?, slots_total = ?, responses_file = ?, last_form_sync = ?, artist_name = ?, tos_url = ?,
       msg_stage = ?, msg_payment = ?, msg_delivery = ?, msg_decline = ? WHERE id = 1;`,
    [
      next.default_currency,
      next.extra_character_rate,
      next.auto_backup_enabled ? 1 : 0,
      next.auto_backup_folder,
      next.auto_backup_keep,
      next.last_auto_backup,
      next.promise_max_days,
      next.reminders_enabled ? 1 : 0,
      next.reminder_days_before,
      next.stalled_enabled ? 1 : 0,
      next.stalled_days,
      next.slots_open ? 1 : 0,
      next.slots_total,
      next.responses_file,
      next.last_form_sync,
      next.artist_name,
      next.tos_url,
      next.msg_stage,
      next.msg_payment,
      next.msg_delivery,
      next.msg_decline,
    ],
  );
  settings = next;
}

export { initializeDatabase, SCHEMA_VERSION } from "./schema";

export async function getTemplates(): Promise<Template[]> {
  const database = await getDatabase();

  return await database.select<Template[]>(`
    SELECT id, name, base_price, revisions_included, COALESCE(color, '#475569') AS color
    FROM templates
    ORDER BY id DESC;
  `);
}

export async function getTemplateStages(templateId: number): Promise<TemplateStage[]> {
  const database = await getDatabase();

  return await database.select<TemplateStage[]>(
    `
    SELECT id, template_id, name, stage_order
    FROM template_stages
    WHERE template_id = ?
    ORDER BY stage_order ASC;
    `,
    [templateId],
  );
}

export async function createTemplate(name: string, stages: string[]): Promise<void> {
  const templateName = name.trim();
  const templateStages = stages
    .map((stage) => stage.trim())
    .filter(Boolean);

  if (!templateName) {
    throw new Error(t("Template name is required"));
  }

  await runSerialized(async (database) => {
    const [{ count }] = await database.select<{ count: number }[]>(`SELECT COUNT(*) AS count FROM templates;`);
    const result = await database.execute(
      `
      INSERT INTO templates (name, color)
      VALUES (?, ?);
      `,
      [templateName, PALETTE[count % PALETTE.length]],
    );

    const templateId = Number(result.lastInsertId);

    for (let index = 0; index < templateStages.length; index++) {
      await database.execute(
        `
        INSERT INTO template_stages (template_id, name, stage_order)
        VALUES (?, ?, ?);
        `,
        [templateId, templateStages[index], index + 1],
      );
    }
  });
}

export async function deleteTemplate(templateId: number): Promise<number> {
  const database = await getDatabase();

  // Finished ones too: without their stages they'd stop counting as finished and lose their images
  const commissionsUsingTemplate = await database.select<{ count: number }[]>(
    `SELECT COUNT(*) as count FROM commissions WHERE template_id = ?;`,
    [templateId],
  );

  if (commissionsUsingTemplate[0].count > 0) {
    throw new Error(
      t("This template is used by one or more commissions (active or finished), so it can't be deleted. Duplicate it if you want a variation."),
    );
  }

  const trashId = await moveToTrash("template", templateId);

  // Its stages go with it (database trigger)
  await database.execute(
    `DELETE FROM templates WHERE id = ?;`,
    [templateId],
  );

  return trashId;
}

export async function duplicateTemplate(templateId: number): Promise<void> {
  const database = await getDatabase();

  const templates = await database.select<Template[]>(
    `
    SELECT id, name, base_price, revisions_included, color
    FROM templates
    WHERE id = ?;
    `,
    [templateId],
  );

  if (templates.length === 0) {
    throw new Error("Template not found");
  }

  const sourceTemplate = templates[0];
  const stages = await getTemplateStages(templateId);

  const result = await database.execute(
    `
    INSERT INTO templates (name, base_price, revisions_included, color)
    VALUES (?, ?, ?, ?);
    `,
    [`${sourceTemplate.name} Copy`, sourceTemplate.base_price, sourceTemplate.revisions_included, sourceTemplate.color],
  );

  const newTemplateId = Number(result.lastInsertId);

  for (const stage of stages) {
    await database.execute(
      `
      INSERT INTO template_stages (template_id, name, stage_order)
      VALUES (?, ?, ?);
      `,
      [newTemplateId, stage.name, stage.stage_order],
    );
  }
}

export async function updateTemplateColor(templateId: number, color: string): Promise<void> {
  const database = await getDatabase();
  await database.execute(`UPDATE templates SET color = ? WHERE id = ?;`, [color, templateId]);
}

export async function updateTemplateBasePrice(templateId: number, basePrice: number | null): Promise<void> {
  const database = await getDatabase();

  await database.execute(`UPDATE templates SET base_price = ? WHERE id = ?;`, [basePrice, templateId]);
}

export async function updateTemplateRevisions(templateId: number, revisions: number | null): Promise<void> {
  const database = await getDatabase();

  await database.execute(`UPDATE templates SET revisions_included = ? WHERE id = ?;`, [revisions, templateId]);
}

export async function updateTemplateName(
  templateId: number,
  name: string,
): Promise<void> {
  const database = await getDatabase();

  const cleanName = name.trim();

  if (!cleanName) {
    throw new Error(t("Template name is required"));
  }

  await database.execute(
    `
    UPDATE templates
    SET name = ?
    WHERE id = ?;
    `,
    [cleanName, templateId],
  );
}

export type StageDraft = { id: number | null; name: string };

/**
 * Saves a template's stages keeping their ids: commissions store their current stage
 * and images by id, so renaming or reordering must not create new stages.
 * A stage in use by a commission can't be removed.
 */
export async function saveTemplateStages(
  templateId: number,
  stages: StageDraft[],
): Promise<void> {
  const cleanStages = stages
    .map((stage) => ({ ...stage, name: stage.name.trim() }))
    .filter((stage) => stage.name);

  await runSerialized(async (database) => {
    const existing = await database.select<{ id: number; name: string }[]>(
      `SELECT id, name FROM template_stages WHERE template_id = ?;`,
      [templateId],
    );

    const keptIds = new Set(cleanStages.map((stage) => stage.id));
    const removed = existing.filter((stage) => !keptIds.has(stage.id));

    for (const stage of removed) {
      const usage = await database.select<{ count: number }[]>(
        `
        SELECT
          (SELECT COUNT(*) FROM commissions WHERE current_stage_id = ?) +
          (SELECT COUNT(*) FROM commission_stage_images WHERE stage_id = ?) +
          (SELECT COUNT(*) FROM commission_corrections WHERE stage_id = ?) AS count;
        `,
        [stage.id, stage.id, stage.id],
      );

      if (usage[0].count > 0) {
        throw new Error(
          t("\"{name}\" is in use by a commission (current stage, images or corrections), so it can't be removed.", { name: stage.name }),
        );
      }
    }

    for (const stage of removed) {
      await database.execute(`DELETE FROM template_stages WHERE id = ?;`, [stage.id]);
    }

    for (let index = 0; index < cleanStages.length; index++) {
      const stage = cleanStages[index];

      if (stage.id !== null) {
        await database.execute(
          `UPDATE template_stages SET name = ?, stage_order = ? WHERE id = ? AND template_id = ?;`,
          [stage.name, index + 1, stage.id, templateId],
        );
      } else {
        await database.execute(
          `INSERT INTO template_stages (template_id, name, stage_order) VALUES (?, ?, ?);`,
          [templateId, stage.name, index + 1],
        );
      }
    }
  });
}

export type Commission = {
  id: number;
  title: string;
  client_id: number | null;
  client_name: string | null;
  platform: string | null;
  template_id: number | null;
  current_stage_id: number | null;
  price: number | null;
  currency: string | null;
  deadline: string | null;
  notes: string | null;
  created_at: string;
  /** When it last changed stage (ISO); older finished commissions use it as their delivery day */
  stage_changed_at: string | null;
  /** Set when it is marked as finished: delivery date (YYYY-MM-DD), hours spent and closing notes */
  delivered_at: string | null;
  hours: number | null;
  final_notes: string | null;
  /** How many characters the price is for; the linked ones can be fewer (clients without a profile) */
  character_count: number | null;
  /** Set when it was cancelled (ISO): it stops being open but keeps its payments and history */
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  /** Set while it waits for the client (their feedback or payment): no stalled alert meanwhile */
  waiting_since?: string | null;
  /** For another currency: what 1 of it is worth in the default currency, typed by hand (null = not set) */
  exchange_rate?: number | null;
};

export async function getCommissions(): Promise<Commission[]> {
  const database = await getDatabase();

  return await database.select<Commission[]>(`
    SELECT *
    FROM commissions
    ORDER BY id DESC;
  `);
}

export async function createCommission(
  title: string,
  clientId: number | null,
  clientName: string,
  platform: string,
  templateId: number | null,
  price: number | null,
  currency: string,
  deadline: string | null,
  notes: string,
  characterCount: number,
): Promise<number> {
  const database = await getDatabase();

  const cleanTitle = title.trim();

  if (!cleanTitle) {
    throw new Error(t("Commission title is required"));
  }

  let firstStageId: number | null = null;

  if (templateId) {
    const stages = await getTemplateStages(templateId);
    firstStageId = stages.length > 0 ? stages[0].id : null;
  }

  const result = await database.execute(
    `
    INSERT INTO commissions (
      title,
      client_id,
      client_name,
      platform,
      template_id,
      current_stage_id,
      price,
      currency,
      deadline,
      notes,
      character_count,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `,
    [
      cleanTitle,
      clientId,
      clientName.trim() || null,
      platform,
      templateId,
      firstStageId,
      price,
      currency,
      deadline,
      notes.trim() || null,
      characterCount,
      new Date().toISOString(),
    ],
  );

  return Number(result.lastInsertId);
}

/** "Mark as finished": moves it to the template's last stage and saves the closing details. */
export async function finishCommission(
  commissionId: number,
  lastStageId: number,
  details: { deliveredAt: string; hours: number | null; notes: string },
): Promise<void> {
  const database = await getDatabase();

  await database.execute(
    `
    UPDATE commissions
    SET current_stage_id = ?, stage_changed_at = ?, delivered_at = ?, hours = ?, final_notes = ?
    WHERE id = ?;
    `,
    [lastStageId, new Date().toISOString(), details.deliveredAt, details.hours, details.notes || null, commissionId],
  );
}

export async function updateCommissionStage(
  commissionId: number,
  stageId: number | null,
): Promise<void> {
  const database = await getDatabase();

  await database.execute(
    `
    UPDATE commissions
    SET current_stage_id = ?, stage_changed_at = ?, waiting_since = NULL
    WHERE id = ?;
    `,
    [stageId, new Date().toISOString(), commissionId],
  );
}

export async function updateCommission(
  commissionId: number,
  title: string,
  clientId: number | null,
  clientName: string,
  platform: string,
  price: number | null,
  currency: string,
  deadline: string | null,
  notes: string,
  characterCount: number,
): Promise<void> {
  const database = await getDatabase();

  const cleanTitle = title.trim();

  if (!cleanTitle) {
    throw new Error(t("Commission title is required"));
  }

  await database.execute(
    `
    UPDATE commissions
    SET
      title = ?,
      client_id = ?,
      client_name = ?,
      platform = ?,
      price = ?,
      currency = ?,
      deadline = ?,
      notes = ?,
      character_count = ?
    WHERE id = ?;
    `,
    [
      cleanTitle,
      clientId,
      clientName.trim() || null,
      platform,
      price,
      currency,
      deadline,
      notes.trim() || null,
      characterCount,
      commissionId,
    ],
  );
}

export async function duplicateCommission(
  commissionId: number,
): Promise<number> {
  const database = await getDatabase();

  const commissions = await database.select<Commission[]>(
    `
    SELECT *
    FROM commissions
    WHERE id = ?;
    `,
    [commissionId],
  );

  if (commissions.length === 0) {
    throw new Error("Commission not found");
  }

  const commission = commissions[0];

  const similarCopies = await database.select<{ count: number }[]>(
    `
    SELECT COUNT(*) as count
    FROM commissions
    WHERE title LIKE ?;
    `,
    [`${commission.title} Copy%`],
  );

  const copyNumber = similarCopies[0].count + 1;
  const copyTitle = `${commission.title} Copy ${copyNumber}`;

  const result = await database.execute(
    `
    INSERT INTO commissions (
      title,
      client_id,
      client_name,
      platform,
      template_id,
      current_stage_id,
      price,
      currency,
      deadline,
      notes,
      character_count,
      exchange_rate,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `,
    [
      copyTitle,
      commission.client_id,
      commission.client_name,
      commission.platform,
      commission.template_id,
      commission.current_stage_id,
      commission.price,
      commission.currency,
      commission.deadline,
      commission.notes,
      commission.character_count,
      commission.exchange_rate ?? null,
      new Date().toISOString(),
    ],
  );

  // From the INSERT itself: a separate SELECT last_insert_rowid() could run on another connection of the pool
  return Number(result.lastInsertId);
}

/**
 * Saves what is about to be deleted (the item and everything hanging from it) in the trash and returns
 * the trash id. Call it BEFORE deleting: image files of trashed items then count as in use and stay on disk.
 */
async function moveToTrash(kind: TrashKind, id: number): Promise<number> {
  const database = await getDatabase();
  const { parts, title } = KINDS[kind];
  const snapshot: Snapshot = {};

  for (const [key, sql] of parts) {
    snapshot[key] = await database.select<Record<string, unknown>[]>(`${sql};`, [id]);
  }

  const [main] = snapshot[parts[0][0]];

  if (!main) {
    throw new Error("Nothing to delete");
  }

  const saved = await database.execute(
    `INSERT INTO trash (kind, label, payload, deleted_at) VALUES (?, ?, ?, ?);`,
    [kind, title(main), JSON.stringify(snapshot), new Date().toISOString()],
  );

  return Number(saved.lastInsertId);
}

/** Moves a commission to the trash and returns the trash id (to undo). */
export async function deleteCommission(
  commissionId: number,
): Promise<number> {
  const trashId = await moveToTrash("commission", commissionId);
  const database = await getDatabase();

  // Tags, payments, corrections, images and characters go with it, in the same statement (database triggers)
  await database.execute(`DELETE FROM commissions WHERE id = ?;`, [commissionId]);

  return trashId;
}

async function existingIds(table: string): Promise<Set<number>> {
  const database = await getDatabase();
  const rows = await database.select<{ id: number }[]>(`SELECT id FROM ${table};`);

  return new Set(rows.map((row) => row.id));
}

/** Puts a trashed item back; null when that entry no longer exists (already restored). */
export async function restoreTrash(trashId: number): Promise<string | null> {
  const database = await getDatabase();

  const [entry] = await database.select<{ kind: TrashKind; label: string; payload: string }[]>(
    `SELECT kind, label, payload FROM trash WHERE id = ?;`,
    [trashId],
  );

  if (!entry) {
    return null;
  }

  const existing = {} as Existing;

  for (const table of REFERENCED_TABLES) {
    existing[table] = await existingIds(table);
  }

  for (const [table, row] of planRestore(entry.kind, JSON.parse(entry.payload) as Snapshot, existing)) {
    const [sql, params] = insertStatement(table, row);
    await database.execute(sql, params);
  }

  await database.execute(`DELETE FROM trash WHERE id = ?;`, [trashId]);

  return entry.label;
}

export type TrashEntry = { id: number; kind: string; label: string; deleted_at: string };

export async function getTrash(): Promise<TrashEntry[]> {
  const database = await getDatabase();

  return database.select<TrashEntry[]>(`SELECT id, kind, label, deleted_at FROM trash ORDER BY id DESC;`);
}

/**
 * Removes trash entries for good, then the image files nobody else uses.
 * The rows go first, so their images no longer count as in use.
 */
async function purgeTrashWhere(where: string, params: unknown[] = []): Promise<number> {
  const database = await getDatabase();
  const entries = await database.select<{ payload: string }[]>(`SELECT payload FROM trash WHERE ${where};`, params);

  await database.execute(`DELETE FROM trash WHERE ${where};`, params);

  const used = new Set(await getAllUsedImagePaths());
  const unused = [...new Set(entries.flatMap((entry) => imagePathsOf(JSON.parse(entry.payload) as Snapshot)))].filter(
    (path) => !used.has(path),
  );

  await deleteImageFiles(unused);

  return entries.length;
}

export const purgeTrashEntry = (trashId: number) => purgeTrashWhere("id = ?", [trashId]);
export const emptyTrash = () => purgeTrashWhere("1 = 1");

/** On startup: what has been in the trash longer than TRASH_DAYS goes for good. */
export function purgeOldTrash(): Promise<number> {
  const limit = new Date(Date.now() - TRASH_DAYS * 86400000).toISOString();

  return purgeTrashWhere("deleted_at < ?", [limit]);
}

/** Ctrl+Z: restores the most recently deleted item; null when the trash is empty. */
export async function restoreLastTrash(): Promise<string | null> {
  const database = await getDatabase();
  const [last] = await database.select<{ id: number }[]>(`SELECT id FROM trash ORDER BY id DESC LIMIT 1;`);

  return last ? restoreTrash(last.id) : null;
}

export type Tag = {
  id: number;
  name: string;
  color: string;
  category: string;
};

export async function getTags(): Promise<Tag[]> {
  const database = await getDatabase();

  return await database.select<Tag[]>(`
    SELECT id, name, color, category
    FROM tags
    ORDER BY id DESC;
  `);
}

export async function createTag(
  name: string,
  color: string,
  category: string,
): Promise<void> {
  const database = await getDatabase();

  const cleanName = name.trim();

  if (!cleanName) {
    throw new Error(t("Tag name is required"));
  }

  await database.execute(
    `
    INSERT INTO tags (name, color, category)
    VALUES (?, ?, ?);
    `,
    [cleanName, color, category],
  );
}

export async function deleteTag(tagId: number): Promise<number> {
  return runSerialized(async (database) => {
    const trashId = await moveToTrash("tag", tagId);

    // Also removed from the commissions that had it (database trigger)
    await database.execute(`DELETE FROM tags WHERE id = ?;`, [tagId]);

    return trashId;
  });
}

export async function updateTag(tagId: number, name: string, color: string): Promise<void> {
  const database = await getDatabase();
  const cleanName = name.trim();

  if (!cleanName) {
    throw new Error(t("Tag name is required"));
  }

  await database.execute(`UPDATE tags SET name = ?, color = ? WHERE id = ?;`, [
    cleanName,
    color,
    tagId,
  ]);
}

/** How many commissions use each tag: { tagId: count } */
export async function getTagUsageCounts(): Promise<Record<number, number>> {
  const database = await getDatabase();
  const rows = await database.select<{ tag_id: number; count: number }[]>(
    `SELECT tag_id, COUNT(*) AS count FROM commission_tags GROUP BY tag_id;`,
  );

  return Object.fromEntries(rows.map((row) => [row.tag_id, row.count]));
}

export async function getCommissionTags(
  commissionId: number,
): Promise<Tag[]> {
  const database = await getDatabase();

  return await database.select<Tag[]>(
    `
    SELECT tags.id, tags.name, tags.color, tags.category
    FROM tags
    INNER JOIN commission_tags
      ON commission_tags.tag_id = tags.id
    WHERE commission_tags.commission_id = ?
    ORDER BY tags.name ASC;
    `,
    [commissionId],
  );
}

export async function replaceCommissionTags(
  commissionId: number,
  tagIds: number[],
): Promise<void> {
  await runSerialized(async (database) => {
    await database.execute(
      `
      DELETE FROM commission_tags
      WHERE commission_id = ?;
      `,
      [commissionId],
    );

    for (const tagId of tagIds) {
      await database.execute(
        `
        INSERT INTO commission_tags (commission_id, tag_id)
        VALUES (?, ?);
        `,
        [commissionId, tagId],
      );
    }
  });
}

export type Client = {
  id: number;
  name: string;
  platform: string | null;
  handle: string | null;
  avatar_url: string | null;
  notes: string | null;
  created_at: string;
  /** The account tagged when posting their commissions (may differ from the contact account) */
  tag_platform: string | null;
  tag_handle: string | null;
  /** The email they pay with (PayPal): used to match their payments on CSV import */
  email: string | null;
};

export type ClientCharacter = {
  id: number;
  client_id: number;
  name: string;
  notes: string | null;
  created_at: string;
};

export type CharacterReference = {
  id: number;
  character_id: number;
  label: string;
  image_data_url: string;
  created_at: string;
};

export async function getClients(): Promise<Client[]> {
  const database = await getDatabase();

  return await database.select<Client[]>(`
    SELECT
      id,
      name,
      platform,
      handle,
      avatar_url,
      notes,
      created_at,
      tag_platform,
      tag_handle,
      email
    FROM clients
    ORDER BY name ASC;
  `);
}

export async function createClient(
  name: string,
  platform: string,
  handle: string,
  notes: string,
): Promise<number> {
  const database = await getDatabase();

  const cleanName = name.trim();

  if (!cleanName) {
    throw new Error(t("Client name is required"));
  }

  const result = await database.execute(
    `
    INSERT INTO clients (
      name,
      platform,
      handle,
      notes,
      created_at
    )
    VALUES (?, ?, ?, ?, ?);
    `,
    [
      cleanName,
      platform || null,
      handle.trim() || null,
      notes.trim() || null,
      new Date().toISOString(),
    ],
  );

  return Number(result.lastInsertId);
}

export async function deleteClient(clientId: number): Promise<number> {
  const trashId = await moveToTrash("client", clientId);
  const database = await getDatabase();

  // Their commissions stay, unlinked; their characters go with their references (database triggers)
  await database.execute(`DELETE FROM clients WHERE id = ?;`, [clientId]);

  return trashId;
}

export async function updateClient(
  clientId: number,
  name: string,
  platform: string,
  handle: string,
  notes: string,
): Promise<void> {
  const database = await getDatabase();

  const cleanName = name.trim();

  if (!cleanName) {
    throw new Error(t("Client name is required"));
  }

  await database.execute(
    `
    UPDATE clients
    SET
      name = ?,
      platform = ?,
      handle = ?,
      notes = ?
    WHERE id = ?;
    `,
    [
      cleanName,
      platform || null,
      handle.trim() || null,
      notes.trim() || null,
      clientId,
    ],
  );
}

export async function updateClientAvatar(
  clientId: number,
  avatarUrl: string | null,
): Promise<void> {
  const database = await getDatabase();

  await database.execute(
    `
    UPDATE clients
    SET avatar_url = ?
    WHERE id = ?;
    `,
    [avatarUrl, clientId],
  );
}

export async function getClientCharacters(
  clientId: number,
): Promise<ClientCharacter[]> {
  const database = await getDatabase();

  return await database.select<ClientCharacter[]>(
    `
    SELECT id, client_id, name, notes, created_at
    FROM client_characters
    WHERE client_id = ?
    ORDER BY name ASC;
    `,
    [clientId],
  );
}

export async function createClientCharacter(
  clientId: number,
  name: string,
  notes: string,
): Promise<void> {
  const database = await getDatabase();

  const cleanName = name.trim();

  if (!cleanName) {
    throw new Error(t("Character name is required"));
  }

  await database.execute(
    `
    INSERT INTO client_characters (
      client_id,
      name,
      notes,
      created_at
    )
    VALUES (?, ?, ?, ?);
    `,
    [
      clientId,
      cleanName,
      notes.trim() || null,
      new Date().toISOString(),
    ],
  );
}

export async function deleteClientCharacter(
  characterId: number,
): Promise<number> {
  const trashId = await moveToTrash("character", characterId);
  const database = await getDatabase();

  const references = await database.select<{ image_data_url: string }[]>(
    `SELECT image_data_url FROM character_references WHERE character_id = ?;`,
    [characterId],
  );

  // Its references and its links to commissions go with it (database triggers)
  await database.execute(`DELETE FROM client_characters WHERE id = ?;`, [characterId]);

  // Its images are deleted from disk if nobody else uses them (the trash counts as a user)
  for (const reference of references) {
    await deleteImageIfUnused(reference.image_data_url);
  }

  return trashId;
}

export async function updateClientCharacter(
  characterId: number,
  name: string,
  notes: string,
): Promise<void> {
  const database = await getDatabase();
  const cleanName = name.trim();

  if (!cleanName) {
    throw new Error(t("Character name is required"));
  }

  await database.execute(`UPDATE client_characters SET name = ?, notes = ? WHERE id = ?;`, [
    cleanName,
    notes.trim() || null,
    characterId,
  ]);
}

export async function getCharacterReferences(
  characterId: number,
): Promise<CharacterReference[]> {
  const database = await getDatabase();

  return await database.select<CharacterReference[]>(
    `
    SELECT id, character_id, label, image_data_url, created_at
    FROM character_references
    WHERE character_id = ?
    ORDER BY id ASC;
    `,
    [characterId],
  );
}

// Every reference label is written here, as "Reference N"
const REFERENCE_LABEL = "Reference ";

export async function createCharacterReference(
  characterId: number,
  imagePath: string,
): Promise<void> {
  const database = await getDatabase();

  // Next after the highest number, not after the count: after deleting one, the count repeats a number still in use
  const labels = await database.select<{ label: string }[]>(
    `SELECT label FROM character_references WHERE character_id = ?;`,
    [characterId],
  );

  const referenceNumber = Math.max(0, ...labels.map(({ label }) => Number(label.slice(REFERENCE_LABEL.length)))) + 1;

  await database.execute(
    `
    INSERT INTO character_references (
      character_id,
      label,
      image_data_url,
      created_at
    )
    VALUES (?, ?, ?, ?);
    `,
    [
      characterId,
      `${REFERENCE_LABEL}${referenceNumber}`,
      imagePath,
      new Date().toISOString(),
    ],
  );
}

export async function deleteCharacterReference(
  referenceId: number,
): Promise<void> {
  const database = await getDatabase();

  const references = await database.select<{ image_data_url: string }[]>(
    `
    SELECT image_data_url
    FROM character_references
    WHERE id = ?;
    `,
    [referenceId],
  );

  await database.execute(
    `
    DELETE FROM character_references
    WHERE id = ?;
    `,
    [referenceId],
  );

  if (references.length > 0) {
    await deleteImageIfUnused(references[0].image_data_url);
  }
}

/**
 * References for the iPad page: every character of the commission's client, plus the ones linked to it from other
 * clients (collaborations), with the character's name.
 */
export async function getCommissionReferences(
  commissionId: number,
): Promise<{ character: string; label: string; image_data_url: string }[]> {
  const database = await getDatabase();

  return await database.select(
    `
    SELECT client_characters.name AS character, character_references.label, character_references.image_data_url
    FROM client_characters
    JOIN character_references ON character_references.character_id = client_characters.id
    WHERE client_characters.client_id = (SELECT client_id FROM commissions WHERE id = ?)
      OR client_characters.id IN (SELECT character_id FROM commission_characters WHERE commission_id = ?)
    ORDER BY client_characters.name, character_references.id;
    `,
    [commissionId, commissionId],
  );
}

export async function replaceCommissionCharacters(
  commissionId: number,
  characterIds: number[],
): Promise<void> {
  await runSerialized(async (database) => {
    await database.execute(
      `
      DELETE FROM commission_characters
      WHERE commission_id = ?;
      `,
      [commissionId],
    );

    for (const characterId of characterIds) {
      await database.execute(
        `
        INSERT INTO commission_characters (
          commission_id,
          character_id
        )
        VALUES (?, ?);
        `,
        [commissionId, characterId],
      );
    }
  });
}

export type CommissionStageImage = {
  id: number;
  commission_id: number;
  stage_id: number;
  /** Which alternative of the stage (the client picks between alternatives) */
  alt: number;
  /** Which version of that alternative (retouched after corrections): 1, 2, 3… */
  version: number;
  label: string;
  image_data_url: string;
  created_at: string;
};

export async function getCommissionStageImages(
  commissionId: number,
): Promise<CommissionStageImage[]> {
  const database = await getDatabase();

  return await database.select<CommissionStageImage[]>(
    `
    SELECT id, commission_id, stage_id, alt, version, label, image_data_url, created_at
    FROM commission_stage_images
    WHERE commission_id = ?
    ORDER BY stage_id ASC, alt ASC, version ASC, id ASC;
    `,
    [commissionId],
  );
}

export async function createCommissionStageImage(
  commissionId: number,
  stageId: number,
  imagePath: string,
): Promise<void> {
  const database = await getDatabase();

  const existingImages = await database.select<{ last: number }[]>(
    `
    SELECT COALESCE(MAX(alt), 0) as last
    FROM commission_stage_images
    WHERE commission_id = ?
      AND stage_id = ?;
    `,
    [commissionId, stageId],
  );

  const altNumber = existingImages[0].last + 1;
  const label = `Alt ${altNumber}`;

  await database.execute(
    `
    INSERT INTO commission_stage_images (
      commission_id,
      stage_id,
      alt,
      version,
      label,
      image_data_url,
      created_at
    )
    VALUES (?, ?, ?, 1, ?, ?, ?);
    `,
    [
      commissionId,
      stageId,
      altNumber,
      label,
      imagePath,
      new Date().toISOString(),
    ],
  );
}

/** A retouched version of an existing image: same stage and alternative, next version number. Returns its id. */
export async function createImageVersion(imageId: number, imagePath: string): Promise<number> {
  const database = await getDatabase();

  const [source] = await database.select<{ commission_id: number; stage_id: number; alt: number; label: string }[]>(
    `SELECT commission_id, stage_id, alt, label FROM commission_stage_images WHERE id = ?;`,
    [imageId],
  );

  if (!source) {
    throw new Error("Image not found");
  }

  const [latest] = await database.select<{ last: number }[]>(
    `
    SELECT COALESCE(MAX(version), 0) as last
    FROM commission_stage_images
    WHERE commission_id = ? AND stage_id = ? AND alt = ?;
    `,
    [source.commission_id, source.stage_id, source.alt],
  );

  const result = await database.execute(
    `
    INSERT INTO commission_stage_images (commission_id, stage_id, alt, version, label, image_data_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?);
    `,
    [source.commission_id, source.stage_id, source.alt, latest.last + 1, source.label, imagePath, new Date().toISOString()],
  );

  return Number(result.lastInsertId);
}

export async function deleteCommissionStageImage(
  imageId: number,
): Promise<void> {
  const database = await getDatabase();

  const images = await database.select<{ image_data_url: string }[]>(
    `
    SELECT image_data_url
    FROM commission_stage_images
    WHERE id = ?;
    `,
    [imageId],
  );

  await database.execute(
    `
    DELETE FROM commission_stage_images
    WHERE id = ?;
    `,
    [imageId],
  );
  // Its pins stay as plain corrections (database trigger)

  if (images.length > 0) {
    await deleteImageIfUnused(images[0].image_data_url);
  }
}

export async function getAllUsedImagePaths(): Promise<string[]> {
  const database = await getDatabase();

  const characterRefs = await database.select<{ image_data_url: string }[]>(
    `SELECT image_data_url FROM character_references;`,
  );

  const stageImages = await database.select<{ image_data_url: string }[]>(
    `SELECT image_data_url FROM commission_stage_images;`,
  );

  const avatars = await database.select<{ avatar_url: string }[]>(
    `SELECT avatar_url FROM clients WHERE avatar_url IS NOT NULL AND avatar_url NOT LIKE 'http%';`,
  );

  const trashed = await database.select<{ payload: string }[]>(`SELECT payload FROM trash;`);

  return [
    ...characterRefs.map((row) => row.image_data_url),
    ...stageImages.map((row) => row.image_data_url),
    ...avatars.map((row) => row.avatar_url),
    ...trashed.flatMap((row) => imagePathsOf(JSON.parse(row.payload) as Snapshot)),
  ];
}
const IMAGE_TABLES = ["character_references", "commission_stage_images"] as const;

/** One image can be in several rows (same file): only deleted when nobody uses it. */
async function deleteImageIfUnused(imagePath: string): Promise<void> {
  const usedPaths = await getAllUsedImagePaths();

  if (!usedPaths.includes(imagePath)) {
    await deleteImageFiles([imagePath]);
  }
}

/**
 * Converts old images (full-size files) to the new format: light WebP copy + thumbnail.
 * Old files aren't deleted here: they become orphans, cleaned from Settings.
 */
export async function migrateLegacyImages(
  onProgress: (done: number, total: number) => void = () => {},
): Promise<{ migrated: number; failed: number }> {
  const database = await getDatabase();
  let migrated = 0;
  let failed = 0;

  // Collect all pending ones first so progress can show "x of total"
  const pending: { table: string; id: number; image_data_url: string }[] = [];

  for (const table of IMAGE_TABLES) {
    const rows = await database.select<{ id: number; image_data_url: string }[]>(
      `SELECT id, image_data_url FROM ${table};`,
    );

    pending.push(
      ...rows
        .filter((row) => !isProcessedImage(row.image_data_url))
        .map((row) => ({ table, ...row })),
    );
  }

  for (const [index, { table, ...row }] of pending.entries()) {
    onProgress(index, pending.length);

    try {
      const stored = await importImageFromDataDir(row.image_data_url);

      await database.execute(
        `UPDATE ${table} SET image_data_url = ? WHERE id = ?;`,
        [stored.path, row.id],
      );

      migrated += 1;
    } catch (error) {
      console.error("Could not migrate image", table, row.id, error);
      failed += 1;
    }
  }

  if (migrated > 0) {
    onProgress(pending.length, pending.length);
    // Reclaims the space left by base64 images from earlier versions
    await database.execute("VACUUM;");
  }

  return { migrated, failed };
}

export type CommissionPayment = {
  id: number;
  commission_id: number;
  amount: number;
  received: number | null;
  paid_at: string;
  note: string | null;
  external_id: string | null;
  /** 1 = a tip: received money that doesn't count towards the price */
  tip: number;
};

export async function getAllPayments(): Promise<CommissionPayment[]> {
  const database = await getDatabase();

  return await database.select<CommissionPayment[]>(
    `SELECT id, commission_id, amount, received, paid_at, note, external_id, tip FROM commission_payments ORDER BY paid_at ASC, id ASC;`,
  );
}

export async function addPayment(
  commissionId: number,
  amount: number,
  received: number | null,
  paidAt: string,
  note: string,
  tip = false,
): Promise<void> {
  const database = await getDatabase();

  await database.execute(
    `INSERT INTO commission_payments (commission_id, amount, received, paid_at, note, tip) VALUES (?, ?, ?, ?, ?, ?);`,
    [commissionId, amount, received, paidAt, note.trim() || null, tip ? 1 : 0],
  );
}

/**
 * Saves imported PayPal payments. No transaction (the SQLite pool doesn't guarantee one connection):
 * if it fails midway, re-importing skips those already saved by transaction id.
 */
export async function importPayments(
  items: { commissionId: number; amount: number; received: number; paidAt: string; externalId: string }[],
): Promise<void> {
  await runSerialized(async (database) => {
    for (const item of items) {
      await database.execute(
        `INSERT INTO commission_payments (commission_id, amount, received, paid_at, note, external_id) VALUES (?, ?, ?, ?, 'PayPal', ?);`,
        [item.commissionId, item.amount, item.received, item.paidAt, item.externalId],
      );
    }
  });
}

/** Day of the last imported PayPal payment (YYYY-MM-DD), or null if none yet. */
export async function getLastImportedPaymentDate(): Promise<string | null> {
  const database = await getDatabase();
  const rows = await database.select<{ day: string | null }[]>(
    `SELECT MAX(paid_at) AS day FROM commission_payments WHERE external_id IS NOT NULL;`,
  );

  return rows[0]?.day ?? null;
}

export async function updatePaymentReceived(paymentId: number, received: number | null): Promise<void> {
  const database = await getDatabase();

  await database.execute(`UPDATE commission_payments SET received = ? WHERE id = ?;`, [received, paymentId]);
}

export async function deletePayment(paymentId: number): Promise<number> {
  const trashId = await moveToTrash("payment", paymentId);
  const database = await getDatabase();

  await database.execute(`DELETE FROM commission_payments WHERE id = ?;`, [paymentId]);

  return trashId;
}

/**
 * "Paid" / "Not Paid" tags are replaced by payments: each "Paid" commission gets one payment
 * for its price (dated on creation), then the payment tags are deleted.
 * Does nothing once no payment tags remain.
 */
export async function migratePaymentTags(): Promise<void> {
  await runSerialized(async (database) => {
    const paymentTags = await database.select<{ id: number; name: string }[]>(
      `SELECT id, name FROM tags WHERE category = 'Payment';`,
    );

    if (paymentTags.length === 0) {
      return;
    }

    const paidTagIds = paymentTags
      .filter((tag) => tag.name.trim().toLowerCase() === "paid")
      .map((tag) => tag.id);

    for (const tagId of paidTagIds) {
      const paidCommissions = await database.select<{ id: number; price: number | null; created_at: string }[]>(
        `
        SELECT c.id, c.price, c.created_at
        FROM commissions c
        JOIN commission_tags ct ON ct.commission_id = c.id
        WHERE ct.tag_id = ?
          AND c.price IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM commission_payments p WHERE p.commission_id = c.id);
        `,
        [tagId],
      );

      for (const commission of paidCommissions) {
        await database.execute(
          `INSERT INTO commission_payments (commission_id, amount, received, paid_at, note) VALUES (?, ?, NULL, ?, ?);`,
          [commission.id, commission.price, commission.created_at.slice(0, 10), "Imported from Paid tag"],
        );
      }
    }

    for (const tag of paymentTags) {
      await database.execute(`DELETE FROM tags WHERE id = ?;`, [tag.id]);
    }
  });
}

export type CommissionCorrection = {
  id: number;
  commission_id: number;
  stage_id: number;
  text: string;
  created_at: string;
  /** Set when the correction is a pin on an image version; x and y are 0..1 of the image */
  image_id: number | null;
  x: number | null;
  y: number | null;
  /** When it was marked as done (ISO); null while pending */
  done_at: string | null;
};

export async function getAllCorrections(): Promise<CommissionCorrection[]> {
  const database = await getDatabase();

  return await database.select<CommissionCorrection[]>(
    `SELECT id, commission_id, stage_id, text, created_at, image_id, x, y, done_at FROM commission_corrections ORDER BY created_at ASC, id ASC;`,
  );
}

export async function addCorrection(
  commissionId: number,
  stageId: number,
  text: string,
  pin?: { imageId: number; x: number; y: number },
): Promise<void> {
  const database = await getDatabase();
  const cleanText = text.trim();

  if (!cleanText) {
    throw new Error(t("Write what the client asked to change"));
  }

  await database.execute(
    `INSERT INTO commission_corrections (commission_id, stage_id, text, created_at, image_id, x, y) VALUES (?, ?, ?, ?, ?, ?, ?);`,
    [commissionId, stageId, cleanText, new Date().toISOString(), pin?.imageId ?? null, pin?.x ?? null, pin?.y ?? null],
  );
}

export async function setCorrectionDone(correctionId: number, done: boolean): Promise<void> {
  const database = await getDatabase();

  await database.execute(`UPDATE commission_corrections SET done_at = ? WHERE id = ?;`, [
    done ? new Date().toISOString() : null,
    correctionId,
  ]);
}

export async function deleteCorrection(correctionId: number): Promise<number> {
  const trashId = await moveToTrash("correction", correctionId);
  const database = await getDatabase();

  await database.execute(`DELETE FROM commission_corrections WHERE id = ?;`, [correctionId]);

  return trashId;
}

export type PaymentPlatform = {
  id: number;
  name: string;
  /** 3.4 = 3.4% */
  percent: number;
  /** Fixed part per payment, in the payment's currency */
  fixed: number;
};

export async function getPaymentPlatforms(): Promise<PaymentPlatform[]> {
  const database = await getDatabase();

  return await database.select<PaymentPlatform[]>(
    `SELECT id, name, percent, fixed FROM payment_platforms ORDER BY id ASC;`,
  );
}

/** Saves the whole list: no payment points to a platform by id (they use the note) */
export async function savePaymentPlatforms(platforms: Omit<PaymentPlatform, "id">[]): Promise<void> {
  await runSerialized(async (database) => {
    await database.execute(`DELETE FROM payment_platforms;`);

    for (const platform of platforms.filter((item) => item.name.trim())) {
      await database.execute(`INSERT INTO payment_platforms (name, percent, fixed) VALUES (?, ?, ?);`, [
        platform.name.trim(),
        platform.percent,
        platform.fixed,
      ]);
    }
  });
}

export type RequestStatus = "new" | "waitlist" | "accepted" | "declined";

export type CommissionRequest = {
  id: number;
  name: string;
  platform: string | null;
  contact: string | null;
  template_id: number | null;
  characters: number;
  details: string | null;
  status: RequestStatus;
  /** The commission created on acceptance */
  commission_id: number | null;
  created_at: string;
  external_id: string | null;
  email: string | null;
  tag_platform: string | null;
  tag_handle: string | null;
};

export async function getRequests(): Promise<CommissionRequest[]> {
  const database = await getDatabase();

  return await database.select<CommissionRequest[]>(
    `SELECT id, name, platform, contact, template_id, characters, details, status, commission_id, created_at,
       external_id, email, tag_platform, tag_handle
     FROM commission_requests ORDER BY created_at ASC, id ASC;`,
  );
}

export async function addRequest(
  request: Pick<CommissionRequest, "name" | "platform" | "contact" | "template_id" | "characters" | "details">,
): Promise<void> {
  const database = await getDatabase();
  const name = request.name.trim();

  if (!name) {
    throw new Error(t("The request needs a name"));
  }

  await database.execute(
    `INSERT INTO commission_requests (name, platform, contact, template_id, characters, details, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'new', ?);`,
    [
      name,
      request.platform,
      request.contact?.trim() || null,
      request.template_id,
      Math.max(1, request.characters),
      request.details?.trim() || null,
      new Date().toISOString(),
    ],
  );
}

export async function setRequestStatus(
  requestId: number,
  status: RequestStatus,
  commissionId: number | null = null,
): Promise<void> {
  const database = await getDatabase();

  await database.execute(`UPDATE commission_requests SET status = ?, commission_id = ? WHERE id = ?;`, [
    status,
    commissionId,
    requestId,
  ]);
}

export async function deleteRequest(requestId: number): Promise<number> {
  const trashId = await moveToTrash("request", requestId);
  const database = await getDatabase();

  // Remembered for good, even after the trash is emptied
  await database.execute(
    `INSERT OR IGNORE INTO ignored_requests (external_id) SELECT external_id FROM commission_requests WHERE id = ? AND external_id IS NOT NULL;`,
    [requestId],
  );

  await database.execute(`DELETE FROM commission_requests WHERE id = ?;`, [requestId]);

  return trashId;
}

/** Saves form requests not already stored or removed before (recognized by external_id). */
export async function importRequests(items: ImportedRequest[]): Promise<{ added: number; skipped: number }> {
  return await runSerialized(async (database) => {
    // Requests that went to the trash before this was remembered: their ids join the list now
    for (const { payload } of await database.select<{ payload: string }[]>(`SELECT payload FROM trash WHERE kind = 'request';`)) {
      for (const row of (JSON.parse(payload) as Snapshot).commission_requests) {
        if (row.external_id) {
          await database.execute(`INSERT OR IGNORE INTO ignored_requests (external_id) VALUES (?);`, [row.external_id]);
        }
      }
    }

    const known = new Set(
      (
        await database.select<{ external_id: string | null }[]>(
          `SELECT external_id FROM commission_requests UNION SELECT external_id FROM ignored_requests;`,
        )
      ).map((row) => row.external_id),
    );
    let added = 0;

    for (const item of newResponses(items, known)) {
      await database.execute(
        `INSERT INTO commission_requests
           (name, platform, contact, template_id, characters, details, status, created_at, external_id, email,
            tag_platform, tag_handle)
         VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?);`,
        [
          item.name,
          item.platform,
          item.contact,
          item.template_id,
          item.characters,
          item.details,
          item.created_at,
          item.externalId,
          item.email,
          item.tag_platform,
          item.tag_handle,
        ],
      );
      added += 1;
    }

    return { added, skipped: items.length - added };
  });
}

export async function setRequestTemplate(requestId: number, templateId: number | null): Promise<void> {
  const database = await getDatabase();

  await database.execute(`UPDATE commission_requests SET template_id = ? WHERE id = ?;`, [templateId, requestId]);
}

/** Saves whom to tag when posting (null in both = nobody). */
export async function setClientTag(clientId: number, platform: string | null, handle: string | null): Promise<void> {
  const database = await getDatabase();

  await database.execute(`UPDATE clients SET tag_platform = ?, tag_handle = ? WHERE id = ?;`, [platform, handle, clientId]);
}

/** Changes the client's email from their profile (empty removes it). */
export async function saveClientEmail(clientId: number, email: string): Promise<void> {
  const database = await getDatabase();

  await database.execute(`UPDATE clients SET email = ? WHERE id = ?;`, [email.trim() || null, clientId]);
}

/** Saves the client's email only if they had none. */
export async function setClientEmail(clientId: number, email: string): Promise<void> {
  const database = await getDatabase();

  await database.execute(`UPDATE clients SET email = ? WHERE id = ? AND (email IS NULL OR email = '');`, [email, clientId]);
}

// ---- Loading many at once: one query per kind instead of one per item (N+1) ----

/** Rows grouped by id, with an empty list for every id asked for (so a lookup never misses). */
function grouped<Row, Value = Row>(rows: Row[], key: (row: Row) => number, ids: number[], value: (row: Row) => Value = (row) => row as unknown as Value): Record<number, Value[]> {
  const byId: Record<number, Value[]> = Object.fromEntries(ids.map((id) => [id, []]));

  for (const row of rows) {
    (byId[key(row)] ??= []).push(value(row));
  }

  return byId;
}

export async function getStagesByTemplate(templateIds: number[]): Promise<Record<number, TemplateStage[]>> {
  const rows = await (await getDatabase()).select<TemplateStage[]>(
    `SELECT id, template_id, name, stage_order FROM template_stages ORDER BY template_id, stage_order ASC;`,
  );
  return grouped(rows, (row) => row.template_id, templateIds);
}

export async function getStageImagesByCommission(commissionIds: number[]): Promise<Record<number, CommissionStageImage[]>> {
  const rows = await (await getDatabase()).select<CommissionStageImage[]>(
    `SELECT id, commission_id, stage_id, alt, version, label, image_data_url, created_at
     FROM commission_stage_images ORDER BY commission_id, stage_id ASC, alt ASC, version ASC, id ASC;`,
  );
  return grouped(rows, (row) => row.commission_id, commissionIds);
}

export async function getTagsByCommission(commissionIds: number[]): Promise<Record<number, Tag[]>> {
  const rows = await (await getDatabase()).select<(Tag & { commission_id: number })[]>(
    `SELECT commission_tags.commission_id, tags.id, tags.name, tags.color, tags.category
     FROM tags JOIN commission_tags ON tags.id = commission_tags.tag_id ORDER BY tags.name ASC;`,
  );
  return grouped(rows, (row) => row.commission_id, commissionIds, ({ id, name, color, category }) => ({ id, name, color, category }));
}

export async function getCharacterIdsByCommission(commissionIds: number[]): Promise<Record<number, number[]>> {
  const rows = await (await getDatabase()).select<{ commission_id: number; character_id: number }[]>(
    `SELECT commission_id, character_id FROM commission_characters ORDER BY character_id;`,
  );
  return grouped(rows, (row) => row.commission_id, commissionIds, (row) => row.character_id);
}

export async function getCharactersByClient(clientIds: number[]): Promise<Record<number, ClientCharacter[]>> {
  const rows = await (await getDatabase()).select<ClientCharacter[]>(
    `SELECT id, client_id, name, notes, created_at FROM client_characters ORDER BY name ASC;`,
  );
  return grouped(rows, (row) => row.client_id, clientIds);
}

export async function getReferencesByCharacter(characterIds: number[]): Promise<Record<number, CharacterReference[]>> {
  const rows = await (await getDatabase()).select<CharacterReference[]>(
    `SELECT id, character_id, label, image_data_url, created_at FROM character_references ORDER BY id ASC;`,
  );
  return grouped(rows, (row) => row.character_id, characterIds);
}

/** Cancels a commission (it keeps its payments, history and client) or, with null, opens it again. */
export async function setCommissionCancelled(commissionId: number, reason: string | null): Promise<void> {
  const database = await getDatabase();

  await database.execute(`UPDATE commissions SET cancelled_at = ?, cancel_reason = ? WHERE id = ?;`, [
    reason === null ? null : new Date().toISOString(),
    reason?.trim() || null,
    commissionId,
  ]);
}

/** Marks (or unmarks) a commission as waiting for the client. Moving it to another stage unmarks it. */
export async function setCommissionWaiting(commissionId: number, waiting: boolean): Promise<void> {
  const database = await getDatabase();

  await database.execute(`UPDATE commissions SET waiting_since = ? WHERE id = ?;`, [waiting ? new Date().toISOString() : null, commissionId]);
}

export type TimeEntry = { id: number; commission_id: number; stage_id: number | null; started_at: string; ended_at: string | null };

export async function getTimeEntries(commissionId: number): Promise<TimeEntry[]> {
  return (await getDatabase()).select<TimeEntry[]>(
    `SELECT id, commission_id, stage_id, started_at, ended_at FROM time_entries WHERE commission_id = ? ORDER BY started_at;`,
    [commissionId],
  );
}

/** The timer that is running now, if any (only one runs at a time). */
export async function getRunningTimer(): Promise<TimeEntry | null> {
  const [running] = await (await getDatabase()).select<TimeEntry[]>(
    `SELECT id, commission_id, stage_id, started_at, ended_at FROM time_entries WHERE ended_at IS NULL LIMIT 1;`,
  );
  return running ?? null;
}

export async function stopTimer(): Promise<void> {
  await (await getDatabase()).execute(`UPDATE time_entries SET ended_at = ? WHERE ended_at IS NULL;`, [new Date().toISOString()]);
}

/** Starts timing a commission's stage; whatever was running stops first. */
export async function startTimer(commissionId: number, stageId: number | null): Promise<void> {
  await stopTimer();
  await (await getDatabase()).execute(`INSERT INTO time_entries (commission_id, stage_id, started_at) VALUES (?, ?, ?);`, [
    commissionId,
    stageId,
    new Date().toISOString(),
  ]);
}

/** The rate typed for a commission in another currency (null removes it). */
export async function setCommissionExchangeRate(commissionId: number, rate: number | null): Promise<void> {
  await (await getDatabase()).execute(`UPDATE commissions SET exchange_rate = ? WHERE id = ?;`, [rate, commissionId]);
}

/** Money spent on the work, in the default currency. ponytail: one currency only; add a currency column if you buy in others. */
export type Expense = { id: number; spent_at: string; amount: number; note: string };

export async function getExpenses(): Promise<Expense[]> {
  return (await getDatabase()).select<Expense[]>(`SELECT id, spent_at, amount, note FROM expenses ORDER BY spent_at DESC, id DESC;`);
}

export async function addExpense(spentAt: string, amount: number, note: string): Promise<number> {
  const result = await (await getDatabase()).execute(`INSERT INTO expenses (spent_at, amount, note) VALUES (?, ?, ?);`, [spentAt, amount, note.trim()]);
  return Number(result.lastInsertId);
}

/** Gone for good: an expense is one line, easy to type again (no trash). */
export async function deleteExpense(expenseId: number): Promise<void> {
  await (await getDatabase()).execute(`DELETE FROM expenses WHERE id = ?;`, [expenseId]);
}
