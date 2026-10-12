/* Marco común de las maquetas: barra lateral (según <body data-page>) y cambio de tema instantáneo */
const ICONS = {
  resumen: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  comisiones: '<path d="M9.06 11.9 17 4l3 3-7.9 7.94"/><path d="M7 14.5c-1.66 0-3 1.34-3 3 0 1.31-.84 2-2 2 1.5 2 3.5 2.5 5 2.5a4.5 4.5 0 0 0 4.5-4.5l-4.5-3z"/>',
  solicitudes: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  clientes: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  catalogo: '<path d="M12 2H2v10l9.29 9.29a1 1 0 0 0 1.41 0l8.59-8.59a1 1 0 0 0 0-1.41z"/><circle cx="7" cy="7" r="1.2"/>',
  terminadas: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  estadisticas: '<path d="M3 3v18h18"/><path d="M7 16v-4M12 16V8M17 16v-7"/>',
  ajustes: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/>',
};
const NAV = [["resumen", "Resumen"], ["comisiones", "Comisiones", 6], ["solicitudes", "Solicitudes", 3], ["clientes", "Clientes", 9],
  ["terminadas", "Terminadas"], ["catalogo", "Catálogo"], ["estadisticas", "Estadísticas"], ["ajustes", "Ajustes"]];
const READY = ["resumen", "comisiones", "solicitudes", "clientes", "terminadas", "catalogo", "estadisticas", "ajustes"];
const svg = (d) => `<svg class="i" viewBox="0 0 24 24">${d}</svg>`;

const side = document.getElementById("side");
side.setAttribute("aria-label", "Navegación");
side.innerHTML = `<div class="brand"><span class="brand-mark">Z</span>ZeeBoard</div>
  <nav class="nav">${NAV.map(([id, label, n]) =>
    `<a href="${READY.includes(id) ? id + ".html" : "#"}"${id === document.body.dataset.page ? ' aria-current="page"' : ""}>${svg(ICONS[id])}${label}${n ? `<span class="count num">${n}</span>` : ""}</a>`).join("")}</nav>
  ${side.dataset.note ? `<p class="note"><button aria-label="Cerrar nota" onclick="this.parentNode.remove()">✕</button><strong>Maqueta.</strong> ${side.dataset.note}</p>` : ""}
  <div class="side-foot">
    <button>${svg('<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>')}Modo privado</button>
    <button id="theme">${svg('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>')}Cambiar tema</button>
    <button>${svg('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/>')}Atajos<kbd>?</kbd></button>
  </div>`;

// Todo cambia en el mismo fotograma: las transiciones se apagan durante el cambio. theme: "light" | "dark" | null (= el del sistema)
function setTheme(theme) {
  const r = document.documentElement;
  r.classList.add("theme-switching");
  if (theme) r.dataset.theme = theme; else delete r.dataset.theme;
  requestAnimationFrame(() => requestAnimationFrame(() => r.classList.remove("theme-switching")));
}
document.getElementById("theme").addEventListener("click", () => {
  const r = document.documentElement;
  setTheme((r.dataset.theme ? r.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches) ? "light" : "dark");
});
