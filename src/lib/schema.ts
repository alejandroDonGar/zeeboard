// The database's shape and how it gets there: numbered migrations, each run once (PRAGMA user_version).
// Runs at start-up only; everything that reads or writes data lives in database.ts.
import { templateColors } from "./catalog";
import { integrityStatements } from "./trash";
import { getDatabase, loadSettings, type ZeeDatabase } from "./database";

/** Migration 1: the schema as it was before versions. Runs once on new databases and on ones from earlier versions. */
async function baseline(database: ZeeDatabase): Promise<void> {

  await database.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY,
      language TEXT NOT NULL DEFAULT 'en',
      theme TEXT NOT NULL DEFAULT 'zebra-light'
    );
  `);
  await addColumn(database, "settings", "default_currency TEXT NOT NULL DEFAULT 'EUR'");
  await addColumn(database, "settings", "extra_character_rate REAL NOT NULL DEFAULT 0.5");
  await addColumn(database, "settings", "auto_backup_enabled INTEGER NOT NULL DEFAULT 0");
  await addColumn(database, "settings", "auto_backup_folder TEXT");
  await addColumn(database, "settings", "auto_backup_keep INTEGER NOT NULL DEFAULT 7");
  await addColumn(database, "settings", "last_auto_backup TEXT");
  await addColumn(database, "settings", "promise_max_days INTEGER NOT NULL DEFAULT 60");
  await addColumn(database, "settings", "reminders_enabled INTEGER NOT NULL DEFAULT 1");
  await addColumn(database, "settings", "reminder_days_before INTEGER NOT NULL DEFAULT 3");
  await addColumn(database, "settings", "stalled_enabled INTEGER NOT NULL DEFAULT 1");
  await addColumn(database, "settings", "stalled_days INTEGER NOT NULL DEFAULT 21");
  await addColumn(database, "settings", "slots_open INTEGER NOT NULL DEFAULT 0");
  await addColumn(database, "settings", "slots_total INTEGER NOT NULL DEFAULT 5");
  await addColumn(database, "settings", "responses_file TEXT");
  await addColumn(database, "settings", "last_form_sync TEXT");

  // Commission requests that aren't commissions yet: new, waitlisted, accepted or declined
  await database.execute(`
    CREATE TABLE IF NOT EXISTS commission_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      platform TEXT,
      contact TEXT,
      template_id INTEGER,
      characters INTEGER NOT NULL DEFAULT 1,
      details TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      commission_id INTEGER,
      created_at TEXT NOT NULL
    );
  `);
  // Where an imported request came from (to avoid importing it twice) and its email
  await addColumn(database, "commission_requests", "external_id TEXT");
  // Form responses removed from the list: the CSV still has them and they must not come back
  await database.execute(`CREATE TABLE IF NOT EXISTS ignored_requests (external_id TEXT PRIMARY KEY);`);
  await addColumn(database, "commission_requests", "email TEXT");
  // Whom to tag when posting: on the request, and on the client once accepted
  await addColumn(database, "commission_requests", "tag_platform TEXT");
  await addColumn(database, "commission_requests", "tag_handle TEXT");
  await database.execute(`INSERT OR IGNORE INTO settings (id) VALUES (1);`);

  await database.execute(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      discord TEXT,
      notes TEXT,
      created_at TEXT NOT NULL
    );
  `);

  await database.execute(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT NOT NULL
    );
  `);
  await addColumn(database, "tags", "category TEXT DEFAULT 'General'");

  await database.execute(`
    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    );
  `);

  await addColumn(database, "templates", "base_price REAL");
  await addColumn(database, "templates", "revisions_included INTEGER");
  // The template is the commission type and carries its colour. Templates without one get it once:
  // the colour of their old "Commission Type" tag, else one from the palette. Only adds data; tags stay as they are.
  await addColumn(database, "templates", "color TEXT");
  const uncoloured = await database.select<{ id: number; name: string; color: string | null }[]>(
    `SELECT id, name, color FROM templates WHERE color IS NULL;`,
  );
  if (uncoloured.length > 0) {
    const all = await database.select<{ id: number; name: string; color: string | null }[]>(`SELECT id, name, color FROM templates;`);
    const tags = await database.select<{ name: string; color: string; category: string }[]>(
      `SELECT name, color, COALESCE(category, 'General') AS category FROM tags;`,
    );
    for (const [id, color] of Object.entries(templateColors(all, tags))) {
      await database.execute(`UPDATE templates SET color = ? WHERE id = ? AND color IS NULL;`, [color, Number(id)]);
    }
  }

  // Client corrections, each tied to a stage; each counts as one revision
  await database.execute(`
    CREATE TABLE IF NOT EXISTS commission_corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      commission_id INTEGER NOT NULL,
      stage_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  // A pin on an image version: which image and where (x, y as 0..1 of its width and height)
  await addColumn(database, "commission_corrections", "image_id INTEGER");
  await addColumn(database, "commission_corrections", "x REAL");
  await addColumn(database, "commission_corrections", "y REAL");
  // When the client's request was dealt with (null = still pending)
  await addColumn(database, "commission_corrections", "done_at TEXT");

  await database.execute(`
    CREATE TABLE IF NOT EXISTS template_stages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      stage_order INTEGER NOT NULL
    );
  `);

  await database.execute(`
    CREATE TABLE IF NOT EXISTS commissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      client_id INTEGER,
      template_id INTEGER,
      current_stage_id INTEGER,
      price REAL,
      deadline TEXT,
      notes TEXT,
      created_at TEXT NOT NULL
    );
  `);

  await addColumn(database, "commissions", "client_name TEXT");

  await addColumn(database, "commissions", "platform TEXT");

  await addColumn(database, "commissions", "currency TEXT DEFAULT 'EUR'");

  await database.execute(`
    CREATE TABLE IF NOT EXISTS commission_tags (
      commission_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (commission_id, tag_id)
    );
  `);

  await addColumn(database, "clients", "platform TEXT");

  await addColumn(database, "clients", "handle TEXT");

  await addColumn(database, "clients", "avatar_url TEXT");

  await database.execute(`
    CREATE TABLE IF NOT EXISTS commission_stage_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      commission_id INTEGER NOT NULL,
      stage_id INTEGER NOT NULL,
      label TEXT NOT NULL DEFAULT 'Alt 1',
      image_data_url TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // Old table that was never used
  await database.execute(`DROP TABLE IF EXISTS commission_references;`);

  await database.execute(`
    CREATE TABLE IF NOT EXISTS client_characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL
    );
  `);

  await database.execute(`
    CREATE TABLE IF NOT EXISTS character_references (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL,
      label TEXT NOT NULL DEFAULT 'Reference',
      image_data_url TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  await database.execute(`
    CREATE TABLE IF NOT EXISTS commission_characters (
      commission_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      PRIMARY KEY (commission_id, character_id)
    );
  `);

  // How many characters each price is for. Older rows: what the request said, else the "N Characters" tag, else the linked ones.
  await addColumn(database, "commissions", "character_count INTEGER");
  await database.execute(`
    UPDATE commissions
    SET character_count = MAX(
      1,
      COALESCE((SELECT r.characters FROM commission_requests r WHERE r.commission_id = commissions.id ORDER BY r.id DESC LIMIT 1), 0),
      COALESCE((
        SELECT CAST(t.name AS INTEGER) FROM commission_tags ct JOIN tags t ON t.id = ct.tag_id
        WHERE ct.commission_id = commissions.id AND t.category = 'Characters' AND t.name GLOB '[0-9]*' LIMIT 1
      ), 0),
      (SELECT COUNT(*) FROM commission_characters cc WHERE cc.commission_id = commissions.id)
    )
    WHERE character_count IS NULL;
  `);

  // PayPal, Ko-fi… fees: received = amount − (amount × % + fixed)
  await database.execute(`
    CREATE TABLE IF NOT EXISTS payment_platforms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      percent REAL NOT NULL DEFAULT 0,
      fixed REAL NOT NULL DEFAULT 0
    );
  `);

  // amount = what the client paid; received = what reached you (NULL = not entered yet)
  await database.execute(`
    CREATE TABLE IF NOT EXISTS commission_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      commission_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      received REAL,
      paid_at TEXT NOT NULL,
      note TEXT
    );
  `);

  // Deleted items, stored as JSON so they can be restored (see deleteCommission / restoreTrash)
  await database.execute(`
    CREATE TABLE IF NOT EXISTS trash (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      payload TEXT NOT NULL,
      deleted_at TEXT NOT NULL
    );
  `);

  // Columns of tables created above. They go after every CREATE TABLE: on a fresh database an ALTER that runs before its
  // table exists fails silently, and the UPDATE below would stop the whole start-up.
  await addColumn(database, "clients", "tag_platform TEXT");
  // PayPal transaction id: prevents importing the same payment twice
  await addColumn(database, "commission_payments", "external_id TEXT");
  // A tip: counts as money received (and its fees) but not towards the price
  await addColumn(database, "commission_payments", "tip INTEGER NOT NULL DEFAULT 0");
  await addColumn(database, "clients", "tag_handle TEXT");
  // When a commission last changed stage: counts as activity for the stalled alert
  await addColumn(database, "commissions", "stage_changed_at TEXT");
  // Alternatives and versions of a stage image (older rows: each one is its own alternative, version 1)
  await addColumn(database, "commission_stage_images", "alt INTEGER");
  await addColumn(database, "commission_stage_images", "version INTEGER NOT NULL DEFAULT 1");
  await database.execute(`
    UPDATE commission_stage_images
    SET alt = (
      SELECT COUNT(*) FROM commission_stage_images older
      WHERE older.commission_id = commission_stage_images.commission_id
        AND older.stage_id = commission_stage_images.stage_id
        AND older.id <= commission_stage_images.id
    )
    WHERE alt IS NULL;
  `);
  await addColumn(database, "commissions", "delivered_at TEXT");
  await addColumn(database, "commissions", "hours REAL");
  await addColumn(database, "commissions", "final_notes TEXT");
}

/** Adds a column if the table doesn't have it yet; any other failure stops the start (a half-updated database is worse). */
async function addColumn(database: ZeeDatabase, table: string, definition: string): Promise<void> {
  const name = definition.split(" ")[0];
  const columns = await database.select<{ name: string }[]>(`PRAGMA table_info(${table});`);

  if (!columns.some((column) => column.name === name)) {
    await database.execute(`ALTER TABLE ${table} ADD COLUMN ${definition};`);
  }
}

/**
 * Schema changes in order. Each runs once and the database remembers how far it got (PRAGMA user_version).
 * A new change is a new function at the end; one that has shipped is never edited. Each must be safe to run twice:
 * there is no transaction (the plugin's pool doesn't guarantee one connection), so a crash before the version is saved repeats it.
 */
const MIGRATIONS: ((database: ZeeDatabase) => Promise<void>)[] = [baseline, indexes, integrity, cancelling, waiting, timer, exchange];

/** Migration 7: a commission in another currency carries the rate typed for it (default-currency units per 1 of its own). */
async function exchange(database: ZeeDatabase): Promise<void> {
  await addColumn(database, "commissions", "exchange_rate REAL");
}

/** Migration 6: time tracked per stage (a timer). Its links (deleted and restored with its commission) come from REFS. */
async function timer(database: ZeeDatabase): Promise<void> {
  await database.execute(`
    CREATE TABLE IF NOT EXISTS time_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      commission_id INTEGER NOT NULL,
      stage_id INTEGER,
      started_at TEXT NOT NULL,
      ended_at TEXT
    );
  `);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_time_entries_commission_id ON time_entries (commission_id);`);
  await integrity(database);
}

/** Migration 5: "waiting for the client" (their feedback or payment): no stalled alert meanwhile. */
async function waiting(database: ZeeDatabase): Promise<void> {
  await addColumn(database, "commissions", "waiting_since TEXT");
}

/** Migration 4: a commission can be cancelled (with an optional reason) instead of deleted, keeping its payments. */
async function cancelling(database: ZeeDatabase): Promise<void> {
  await addColumn(database, "commissions", "cancelled_at TEXT");
  await addColumn(database, "commissions", "cancel_reason TEXT");
}

/** Migration 2: an index on every column things are looked up by, so lists and deletions don't read whole tables. */
async function indexes(database: ZeeDatabase): Promise<void> {
  const lookups: [string, string][] = [
    ["commissions", "client_id"],
    ["commissions", "template_id"],
    ["template_stages", "template_id, stage_order"],
    ["commission_payments", "commission_id"],
    ["commission_corrections", "commission_id"],
    ["commission_corrections", "image_id"],
    ["commission_stage_images", "commission_id, stage_id"],
    ["commission_tags", "tag_id"],
    ["commission_characters", "character_id"],
    ["client_characters", "client_id"],
    ["character_references", "character_id"],
    ["commission_requests", "commission_id"],
  ];

  for (const [table, columns] of lookups) {
    await database.execute(`CREATE INDEX IF NOT EXISTS idx_${table}_${columns.split(",")[0]} ON ${table} (${columns});`);
  }
}

/** Migration 3: the links between tables, kept by the database (see integrityStatements in trash.ts). */
async function integrity(database: ZeeDatabase): Promise<void> {
  // Only tables that exist by now: a later migration that creates one runs this again (it can run any number of times)
  const tables = await database.select<{ name: string }[]>(`SELECT name FROM sqlite_master WHERE type = 'table';`);

  for (const statement of integrityStatements(new Set(tables.map((table) => table.name)))) {
    await database.execute(statement);
  }

  // A deleted image's pins stay as plain corrections: the text is kept, the position means nothing now
  await database.execute(`
    CREATE TRIGGER IF NOT EXISTS pins_when_image_deleted AFTER DELETE ON commission_stage_images
    BEGIN UPDATE commission_corrections SET image_id = NULL, x = NULL, y = NULL WHERE image_id = OLD.id; END;
  `);
}

export const SCHEMA_VERSION = MIGRATIONS.length;

export async function initializeDatabase(): Promise<void> {
  const database = await getDatabase();
  const [{ user_version: current }] = await database.select<{ user_version: number }[]>(`PRAGMA user_version;`);

  for (let version = current; version < MIGRATIONS.length; version++) {
    await MIGRATIONS[version](database);
    await database.execute(`PRAGMA user_version = ${version + 1};`);
  }

  await loadSettings();
}
