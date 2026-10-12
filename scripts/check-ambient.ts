import assert from "node:assert";
import { dominantColors } from "../src/lib/ambient";

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

console.log("check-ambient OK", fox);
