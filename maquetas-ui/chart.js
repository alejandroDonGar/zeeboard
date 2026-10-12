/* Gráfico de línea al estilo Stripe (Resumen y Estadísticas).
   months: [[etiqueta, valor], …]. El último punto es el mes en curso: relleno y con el tramo discontinuo. */
function lineChart(months, height = 150) {
  const n = months.length, max = Math.max(...months.map((m) => m[1]), 1);
  const fmt = (v) => v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  const x = (i) => ((i + 0.5) / n) * 600;
  const y = (v) => 100 - (v / (max * 1.12)) * 100; // 12 % de aire arriba
  const pts = months.map(([, v], i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  return `<div class="line" style="height:${height}px">
    <svg viewBox="0 0 600 100" preserveAspectRatio="none" aria-hidden="true">
      <line class="grid" x1="0" x2="600" y1="100" y2="100"/>
      <path class="area" d="M${x(0)},100 L${pts.join(" L")} L${x(n - 1)},100 Z"/>
      <path class="stroke" d="M${pts.slice(0, -1).join(" L")}"/>
      <path class="stroke open" d="M${pts[n - 2]} L${pts[n - 1]}"/>
    </svg>
    <div class="cols" style="grid-template-columns:repeat(${n},minmax(0,1fr))">${months.map(([m, v], i) => `
      <div class="${i === n - 1 ? "now" : ""}" title="${m}: ${fmt(v)}"><div class="plot">
        <span class="pt" style="top:${y(v)}%"></span><span class="tip" style="top:${y(v)}%">${fmt(v)}</span></div>
        <span class="m">${m}</span></div>`).join("")}</div>
  </div>`;
}
