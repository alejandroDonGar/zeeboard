import { useEffect, useSyncExternalStore } from "react";
import { BaseDirectory, readFile } from "@tauri-apps/plugin-fs";
import { getThumbPath } from "./images";

/**
 * Colores del fondo: salen de la imagen que se está viendo y cambian con un fundido al pasar a otra.
 * Se calculan sobre la miniatura (≤480 px) y se guardan en memoria por imagen.
 */

export type AmbientColors = [string, string, string];

// Sin imagen (o un boceto en blanco y negro): tonos cálidos y suaves, los de la app
const NEUTRAL: AmbientColors = ["#e6d6bd", "#d4dbe0", "#eadfc6"];

/** Centro de cada mancha en %: [ax, ay, bx, by, cx, cy] */
export type AmbientLayout = [number, number, number, number, number, number];

const HOME: AmbientLayout = [68, 35, 82, 78, 34, 82];

let colors: AmbientColors = NEUTRAL;
let layout: AmbientLayout = HOME;
let state = { colors, layout };
let page = "";
let image = "";
let requested = 0;
const cache = new Map<string, AmbientColors>();
const listeners = new Set<() => void>();

function emit() {
  state = { colors, layout };
  listeners.forEach((listener) => listener());
}

function publish(next: AmbientColors) {
  colors = next;
  emit();
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

const clamp = (value: number) => Math.min(Math.max(value, 6), 94);

/**
 * Dónde caen las manchas: cada pantalla las desplaza de su sitio base (±22 %) y cada imagen un poco más (±7 %).
 * Es determinista: la misma pantalla siempre las coloca igual. Con "reducir movimiento" no se mueven.
 */
export function layoutFor(pageName: string, imagePath: string): AmbientLayout {
  if (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches) return HOME;

  return HOME.map((base, index) => {
    const bySpot = (hash(`${pageName}:${index}`) - 0.5) * 44;
    const byImage = imagePath ? (hash(`${imagePath}:${index}`) - 0.5) * 14 : 0;
    return clamp(base + bySpot + byImage);
  }) as AmbientLayout;
}

function relayout() {
  layout = layoutFor(page, image);
  emit();
}

/** Pantalla actual: las manchas se desplazan despacio a su nueva posición. */
export function setAmbientPage(name: string): void {
  page = name;
  relayout();
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) return [0, 0, l];

  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;

  return [(h * 60 + 360) % 360, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255).toString(16).padStart(2, "0");
  };

  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** Los tres tonos que más pesan en la imagen (por saturación), o `null` si es casi gris. */
export function dominantColors(pixels: Uint8ClampedArray): AmbientColors | null {
  const BINS = 12;
  const bins = Array.from({ length: BINS }, () => ({ weight: 0, s: 0, l: 0 }));

  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 200) continue;

    const [h, s, l] = rgbToHsl(pixels[i], pixels[i + 1], pixels[i + 2]);

    // Fuera lo casi gris, casi blanco y casi negro: es papel y trazo, no color
    if (s < 0.2 || l < 0.12 || l > 0.93) continue;

    const bin = bins[Math.floor(h / (360 / BINS)) % BINS];
    const weight = s * (1 - Math.abs(2 * l - 1));

    bin.weight += weight;
    bin.s += s * weight;
    bin.l += l * weight;
  }

  const ranked = bins
    .map((bin, index) => ({ ...bin, hue: index * (360 / BINS) + 360 / BINS / 2 }))
    .filter((bin) => bin.weight > 0)
    .sort((a, b) => b.weight - a.weight);

  // Sin color suficiente (un boceto): se queda el fondo neutro
  const total = ranked.reduce((sum, bin) => sum + bin.weight, 0);
  if (ranked.length === 0 || total < pixels.length / 4 / 40) return null;

  const picked: typeof ranked = [];
  for (const bin of ranked) {
    // Tonos distintos entre sí: se saltan los vecinos de uno ya elegido
    if (picked.every((other) => Math.min(Math.abs(other.hue - bin.hue), 360 - Math.abs(other.hue - bin.hue)) >= 40)) {
      picked.push(bin);
    }
    if (picked.length === 3) break;
  }

  // Una imagen de un solo tono: variaciones del mismo para completar los tres
  while (picked.length < 3) {
    const base = picked[picked.length - 1] ?? ranked[0];
    picked.push({ ...base, hue: (base.hue + 30) % 360 });
  }

  const hex = (bin: (typeof ranked)[number]) =>
    hslToHex(bin.hue, Math.min(Math.max(bin.s / bin.weight, 0.45), 0.85), Math.min(Math.max(bin.l / bin.weight, 0.5), 0.68));

  return [hex(picked[0]), hex(picked[1]), hex(picked[2])];
}

async function extract(path: string): Promise<AmbientColors | null> {
  const bytes = await readFile(getThumbPath(path), { baseDir: BaseDirectory.AppData });
  const bitmap = await createImageBitmap(new Blob([bytes]), { resizeWidth: 48, resizeQuality: "low" });

  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });

    if (!context) return null;

    context.drawImage(bitmap, 0, 0);
    return dominantColors(context.getImageData(0, 0, bitmap.width, bitmap.height).data);
  } finally {
    bitmap.close();
  }
}

/** Cambia el fondo a los colores de esa imagen; `null` vuelve al fondo neutro. */
export async function setAmbientImage(path: string | null): Promise<void> {
  const mine = ++requested;

  image = path ?? "";
  layout = layoutFor(page, image);

  if (!path) return publish(NEUTRAL);

  const known = cache.get(path);
  if (known) return publish(known);

  try {
    const found = (await extract(path)) ?? NEUTRAL;

    cache.set(path, found);
    // Si mientras tanto se pidió otra imagen, ésta ya no manda
    if (mine === requested) publish(found);
  } catch (error) {
    console.error("No se pudieron sacar los colores de la imagen", error);
    if (mine === requested) publish(NEUTRAL);
  }
}

export function useAmbient(): { colors: AmbientColors; layout: AmbientLayout } {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

/** Mientras la pantalla muestre esa imagen, el fondo toma sus colores. */
export function useAmbientImage(path: string | null | undefined): void {
  useEffect(() => {
    setAmbientImage(path ?? null);
  }, [path]);

  // Al salir de la pantalla, vuelve al fondo neutro
  useEffect(() => () => void setAmbientImage(null), []);
}
