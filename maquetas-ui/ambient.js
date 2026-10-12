/*
 * Colores sacados de la imagen que se está viendo (mismo algoritmo que src/lib/ambient.ts).
 * Se aplican al fondo (--a1..--a3) y al tinte de la cabecera (--tint), con fundido gracias a @property.
 * El tinte se limita para que el texto encima siga teniendo contraste 4.5:1 en los dos temas.
 */

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function hslToHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const ch = (n) => {
    const k = (n + h / 30) % 12;
    return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255).toString(16).padStart(2, "0");
  };
  return `#${ch(0)}${ch(8)}${ch(4)}`;
}

function dominantColors(px) {
  const BINS = 12, bins = Array.from({ length: BINS }, () => ({ weight: 0, s: 0, l: 0 }));
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 200) continue;
    const [h, s, l] = rgbToHsl(px[i], px[i + 1], px[i + 2]);
    if (s < 0.2 || l < 0.12 || l > 0.93) continue;
    const bin = bins[Math.floor(h / (360 / BINS)) % BINS], w = s * (1 - Math.abs(2 * l - 1));
    bin.weight += w; bin.s += s * w; bin.l += l * w;
  }
  const ranked = bins.map((b, i) => ({ ...b, hue: i * 30 + 15 })).filter((b) => b.weight > 0).sort((a, b) => b.weight - a.weight);
  const total = ranked.reduce((sum, b) => sum + b.weight, 0);
  if (!ranked.length || total < px.length / 4 / 40) return null;
  const picked = [];
  for (const b of ranked) {
    if (picked.every((o) => Math.min(Math.abs(o.hue - b.hue), 360 - Math.abs(o.hue - b.hue)) >= 40)) picked.push(b);
    if (picked.length === 3) break;
  }
  while (picked.length < 3) { const base = picked[picked.length - 1]; picked.push({ ...base, hue: (base.hue + 30) % 360 }); }
  return picked.map((b) => hslToHex(b.hue, Math.min(Math.max(b.s / b.weight, 0.45), 0.85), Math.min(Math.max(b.l / b.weight, 0.5), 0.68)));
}

const cache = new Map();
async function colorsOf(svg) {
  if (cache.has(svg)) return cache.get(svg);
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  await img.decode();
  const c = document.createElement("canvas"); c.width = c.height = 48;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, 48, 48);
  const found = dominantColors(ctx.getImageData(0, 0, 48, 48).data);
  cache.set(svg, found);
  return found;
}

/* Contraste WCAG */
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mixRgb = (a, b, t) => a.map((v, i) => v * t + b[i] * (1 - t));
const isDark = () => { const r = document.documentElement; return r.dataset.theme ? r.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; };

/** El tinte más fuerte (hasta un tope por tema) con el que el texto principal y el secundario siguen en ≥ 4.5:1. */
function safeStrength(tint) {
  const dark = isDark();
  const glass = hexRgb(dark ? "#1f2227" : "#fcf9f3");
  const texts = (dark ? ["#ece6dc", "#b8b0a3"] : ["#1f2933", "#4f473c"]).map(hexRgb);
  let s = dark ? 0.3 : 0.34;
  while (s > 0 && !texts.every((t) => ratio(t, mixRgb(hexRgb(tint), glass, s)) >= 4.8)) s -= 0.01;
  return Math.max(s, 0);
}

let wanted = 0, current = null;
function apply(colors) {
  current = colors;
  const root = document.documentElement.style;
  if (!colors) {
    ["--a1", "--a2", "--a3"].forEach((v) => root.removeProperty(v));
    root.setProperty("--tint-strength", "0");
    return;
  }
  colors.forEach((c, i) => root.setProperty(`--a${i + 1}`, c));
  root.setProperty("--tint", colors[0]);
  root.setProperty("--tint-strength", safeStrength(colors[0]).toFixed(2));
}

/** Pasa el fondo y la cabecera a los colores de esa imagen (o a neutro si es un boceto o no hay imagen). */
async function setAmbientFromSvg(svg) {
  const mine = ++wanted;
  const colors = svg ? await colorsOf(svg).catch(() => null) : null;
  if (mine === wanted) apply(colors);
}

/* Al cambiar de tema se recalcula el tope del tinte */
new MutationObserver(() => apply(current)).observe(document.documentElement, { attributeFilter: ["data-theme"] });
