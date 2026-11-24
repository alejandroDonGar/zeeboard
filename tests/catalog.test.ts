// Quick check of the catalog migration: npx tsx scripts/check-catalog.ts
import assert from "node:assert";
import { PALETTE, TYPE_CATEGORY, templateColors, typeTagsFor } from "../src/lib/catalog";

// The user's real type tags (same as check-form-import)
const tag = (name: string, color: string, category = TYPE_CATEGORY) => ({ name, color, category });
const tags = [
  tag("Render + Complex Background", "#0d9488"), tag("Render + Simple Background | Full Body", "#0891b2"),
  tag("Render + Simple Background | Half Body", "#2563eb"), tag("Full Colour", "#2563eb"),
  tag("Sketch + Background", "#d97706"), tag("Sketch", "#475569"),
  tag("Sketch Characters", "#dc2626", "General"), // other category: never a type
];

// The most specific type tag wins
assert.deepStrictEqual(typeTagsFor("Rendered Full Body + Complex Background", tags).map((t) => t.name), ["Render + Complex Background"]);
assert.deepStrictEqual(typeTagsFor("Sketch + Background", tags).map((t) => t.name), ["Sketch + Background"]);
assert.deepStrictEqual(typeTagsFor("Sketch", tags).map((t) => t.name), ["Sketch"]);
assert.deepStrictEqual(typeTagsFor(null, tags), []);

// Migration: colour from the matching tag; palette when none; templates that already have one are left alone
const templates = [
  { id: 1, name: "Sketch", color: null },
  { id: 2, name: "Rendered Full Body + Complex Background", color: null },
  { id: 3, name: "Chibi", color: null },
  { id: 4, name: "Full Colour", color: "#db2777" },
];
assert.deepStrictEqual(templateColors(templates, tags), { 1: "#475569", 2: "#0d9488", 3: PALETTE[2] });

// Running it again changes nothing (only templates without colour)
const done = templates.map((t) => ({ ...t, color: t.color ?? templateColors(templates, tags)[t.id] }));
assert.deepStrictEqual(templateColors(done, tags), {});

console.log("catalog ok");
