// Pure helpers for the trash (no database here, so tests/trash.test.ts can run them)

/** Days an item stays in the trash before it is removed for good */
export const TRASH_DAYS = 30;

type Row = Record<string, unknown>;

/** Rows of one deleted item, by part: the item itself plus everything that hung from it */
export type Snapshot = Record<string, Row[]>;

/** Everything a kind of item takes with it: [key, SELECT with a single ? bound to the item's id] */
const rows = (table: string, where: string): [string, string] => [table, `SELECT * FROM ${table} WHERE ${where}`];
const ofClientCharacters = "character_id IN (SELECT id FROM client_characters WHERE client_id = ?)";

export const KINDS = {
  commission: {
    label: "Commission",
    title: (row: Row) => String(row.title),
    // Parents first: restoring inserts in this order
    parts: [
      rows("commissions", "id = ?"),
      rows("commission_tags", "commission_id = ?"),
      rows("commission_payments", "commission_id = ?"),
      rows("commission_corrections", "commission_id = ?"),
      rows("commission_stage_images", "commission_id = ?"),
      rows("commission_characters", "commission_id = ?"),
    ],
  },
  client: {
    label: "Client",
    title: (row: Row) => String(row.name),
    parts: [
      rows("clients", "id = ?"),
      rows("client_characters", "client_id = ?"),
      rows("character_references", ofClientCharacters),
      rows("commission_characters", ofClientCharacters),
      // Deleting a client unlinks its commissions: remembered to link them again
      ["client_links", "SELECT id, client_id FROM commissions WHERE client_id = ?"],
    ],
  },
  character: {
    label: "Character",
    title: (row: Row) => String(row.name),
    parts: [
      rows("client_characters", "id = ?"),
      rows("character_references", "character_id = ?"),
      rows("commission_characters", "character_id = ?"),
    ],
  },
  template: {
    label: "Template",
    title: (row: Row) => String(row.name),
    parts: [rows("templates", "id = ?"), rows("template_stages", "template_id = ?")],
  },
  tag: {
    label: "Tag",
    title: (row: Row) => String(row.name),
    parts: [rows("tags", "id = ?"), rows("commission_tags", "tag_id = ?")],
  },
  request: {
    label: "Request",
    title: (row: Row) => String(row.name),
    parts: [rows("commission_requests", "id = ?")],
  },
  payment: {
    label: "Payment",
    title: (row: Row) => `${row.amount} · ${row.paid_at}`,
    parts: [rows("commission_payments", "id = ?")],
  },
  correction: {
    label: "Correction",
    title: (row: Row) => String(row.text).slice(0, 60),
    parts: [rows("commission_corrections", "id = ?")],
  },
} as const;

export type TrashKind = keyof typeof KINDS;

/**
 * What each table points at. `required`: without the target the row makes no sense and is skipped.
 * `nullable`: the row comes back, just unlinked.
 */
const REFS: Record<string, { required?: Record<string, string>; nullable?: Record<string, string> }> = {
  commissions: { nullable: { client_id: "clients", template_id: "templates" } },
  commission_tags: { required: { commission_id: "commissions", tag_id: "tags" } },
  commission_payments: { required: { commission_id: "commissions" } },
  commission_corrections: { required: { commission_id: "commissions" } },
  commission_stage_images: { required: { commission_id: "commissions" } },
  commission_characters: { required: { commission_id: "commissions", character_id: "client_characters" } },
  client_characters: { required: { client_id: "clients" } },
  character_references: { required: { character_id: "client_characters" } },
  template_stages: { required: { template_id: "templates" } },
  commission_requests: { nullable: { template_id: "templates", commission_id: "commissions" } },
  client_links: { required: { id: "commissions" } },
};

/** Tables whose ids a restored row may point at: the ids that exist right now are needed for these */
export const REFERENCED_TABLES = ["clients", "templates", "tags", "commissions", "client_characters"] as const;

export type Existing = Record<(typeof REFERENCED_TABLES)[number], Set<number>>;

/**
 * Rows to write back, in order, with what was deleted in the meantime taken out:
 * required links to missing things are skipped, optional ones are set to null.
 */
export function planRestore(kind: TrashKind, snapshot: Snapshot, existing: Existing): [string, Row][] {
  const known: Record<string, Set<number>> = {};
  REFERENCED_TABLES.forEach((table) => (known[table] = new Set(existing[table])));

  const plan: [string, Row][] = [];

  for (const [table] of KINDS[kind].parts) {
    for (const original of snapshot[table] ?? []) {
      const row = { ...original };
      const refs = REFS[table] ?? {};
      const has = (target: string, value: unknown) => known[target]?.has(Number(value));

      if (Object.entries(refs.required ?? {}).some(([column, target]) => !has(target, row[column]))) {
        continue;
      }

      for (const [column, target] of Object.entries(refs.nullable ?? {})) {
        if (row[column] !== null && !has(target, row[column])) {
          row[column] = null;
        }
      }

      // No template means no stages: the commission comes back as "not started"
      if (table === "commissions" && row.template_id === null) {
        row.current_stage_id = null;
      }

      plan.push([table, row]);

      if (known[table] && row.id !== undefined) {
        known[table].add(Number(row.id));
      }
    }
  }

  return plan;
}

/** Table names are our own constants; columns come from the stored rows. REPLACE makes a retry safe. */
export function insertStatement(table: string, row: Row): [string, unknown[]] {
  if (table === "client_links") {
    return [`UPDATE commissions SET client_id = ? WHERE id = ? AND client_id IS NULL;`, [row.client_id, row.id]];
  }

  const columns = Object.keys(row);

  return [
    `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")});`,
    columns.map((column) => row[column]),
  ];
}

/** Image files a snapshot still needs: they must survive the orphan cleanup */
export function imagePathsOf(snapshot: Snapshot): string[] {
  const avatars = (snapshot.clients ?? []).map((row) => row.avatar_url).filter((url) => url && !String(url).startsWith("http"));

  return [
    ...(snapshot.commission_stage_images ?? []).map((row) => row.image_data_url),
    ...(snapshot.character_references ?? []).map((row) => row.image_data_url),
    ...avatars,
  ].map(String);
}
