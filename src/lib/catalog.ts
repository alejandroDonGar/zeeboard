// Catalog: the commission type (template) carries the colour; tags are for extras.
// Pure helpers (no database here, so scripts/check-catalog.ts can run them)

/** Colours that read well under white text and match the app */
export const PALETTE = [
  "#7c3aed",
  "#4f46e5",
  "#2563eb",
  "#0891b2",
  "#0d9488",
  "#16a34a",
  "#d97706",
  "#ea580c",
  "#dc2626",
  "#db2777",
  "#92400e",
  "#475569",
];

/** Old tag category that repeated the template as a tag. Its tags are kept (nothing is deleted) but no longer shown on commissions. */
export const TYPE_CATEGORY = "Commission Type";

const words = (text: string) =>
  new Set(text.toLowerCase().replace(/rendered/g, "render").split(/[^a-z0-9]+/).filter(Boolean));

/**
 * The "Commission Type" tags that describe a template: the most specific ones whose words are all in its name
 * ("Render + Complex Background" fits "Rendered Full Body + Complex Background"; "Sketch" doesn't if "Sketch + Background" exists).
 */
export function typeTagsFor<T extends { name: string; category: string }>(templateName: string | null, tags: T[]): T[] {
  const name = words(templateName ?? "");
  const fits = tags
    .filter((tag) => tag.category === TYPE_CATEGORY)
    .map((tag) => ({ tag, size: words(tag.name).size, fits: [...words(tag.name)].every((word) => name.has(word)) }))
    .filter((item) => item.fits);
  const best = Math.max(0, ...fits.map((item) => item.size));

  return fits.filter((item) => item.size === best).map((item) => item.tag);
}

/**
 * One-time migration: a colour for every template that has none yet.
 * It takes the colour of its type tag (so commissions keep the colour they had); otherwise one from the palette.
 * Only adds data: tags and their links stay as they are.
 */
export function templateColors(
  templates: { id: number; name: string; color: string | null }[],
  tags: { name: string; color: string; category: string }[],
): Record<number, string> {
  const colors: Record<number, string> = {};
  const byId = [...templates].sort((a, b) => a.id - b.id);

  byId.forEach((template, index) => {
    if (template.color) return;
    colors[template.id] = typeTagsFor(template.name, tags)[0]?.color ?? PALETTE[index % PALETTE.length];
  });

  return colors;
}
