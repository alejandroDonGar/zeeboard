import assert from "node:assert";
import { dominantColors, layoutFor, tintStrengths } from "../src/lib/ambient";

const fill = (colors: [number, number, number][], n = 400) => {
  const data = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = colors[i % colors.length];
    data.set([r, g, b, 255], i * 4);
  }
  return data;
};

// Zorro naranja sobre fondo azul: salen tonos naranja y azul
const fox = dominantColors(fill([[224, 123, 57], [224, 123, 57], [143, 191, 212], [243, 201, 160]]));
assert(fox && fox.length === 3 && new Set(fox).size >= 2, "dibujo a color: tres tonos");

// Boceto: papel casi blanco y trazo gris → sin color, fondo neutro
assert.strictEqual(dominantColors(fill([[251, 249, 244], [251, 249, 244], [138, 135, 128]])), null, "boceto: null");

// Un solo tono: completa tres igualmente
const mono = dominantColors(fill([[200, 60, 60]]));
assert(mono && mono.length === 3, "un tono: tres colores");

// Colocación de las manchas: determinista, dentro de la ventana y distinta en cada pantalla
const dash = layoutFor("dashboard", "");
assert.deepStrictEqual(dash, layoutFor("dashboard", ""), "misma pantalla, mismas posiciones");
assert.notDeepStrictEqual(dash, layoutFor("clients", ""), "otra pantalla, otras posiciones");
assert.notDeepStrictEqual(dash, layoutFor("dashboard", "images/ab12.webp"), "otra imagen, ligero cambio");
for (const page of ["dashboard", "commissions", "clients", "tags", "templates", "settings"]) {
  assert(layoutFor(page, "images/x.webp").every((n) => n >= 6 && n <= 94), `${page}: dentro de la ventana`);
}

// Tinte de la cabecera: nunca por encima del tope y más suave cuanto más choca con el texto
const soft = tintStrengths("#ffffff");
assert(soft.light === 0.34 && soft.dark < 0.3, "blanco: el máximo en claro; en oscuro se queda corto (el texto secundario es claro)");
const dark = tintStrengths("#000000");
assert(dark.light < 0.34 && dark.dark === 0.3, "negro: en claro se queda corto (el texto es oscuro), en oscuro el máximo");
const yellow = tintStrengths("#e2b55a");
assert(yellow.light > 0 && yellow.light <= 0.34 && yellow.dark > 0 && yellow.dark <= 0.3, "color medio: algo de tinte dentro de los topes");

console.log("check-ambient OK", fox);
