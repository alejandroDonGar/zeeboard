import { useState } from "react";
import { formatMoney } from "../lib/commissionHelpers";

export type ChartPoint = { label: string; value: number; /** Extra line in the tooltip (e.g. "2 not entered") */ note?: string };

/**
 * Gráfico de línea (Resumen y Estadísticas). Un punto por mes; el último es el mes en curso: punto relleno,
 * cantidad siempre a la vista y tramo discontinuo, porque aún no ha terminado.
 */
function LineChart({ points, height = 150 }: { points: ChartPoint[]; height?: number }) {
  // El mes en curso enseña su cantidad siempre, salvo mientras se mira otro mes (no se pisan)
  const [hover, setHover] = useState<number | null>(null);
  const n = points.length;
  const max = Math.max(...points.map((point) => point.value), 1);
  const x = (index: number) => ((index + 0.5) / n) * 600;
  const y = (value: number) => 100 - (value / (max * 1.12)) * 100; // 12 % de aire arriba
  const coords = points.map((point, index) => `${x(index).toFixed(1)},${y(point.value).toFixed(1)}`);

  return (
    <div className="relative" style={{ height }}>
      <svg viewBox="0 0 600 100" preserveAspectRatio="none" aria-hidden="true" className="absolute inset-x-0 top-0 h-[calc(100%-22px)] w-full overflow-visible">
        <line x1="0" x2="600" y1="100" y2="100" stroke="var(--line)" vectorEffect="non-scaling-stroke" />
        <path d={`M${x(0)},100 L${coords.join(" L")} L${x(n - 1)},100 Z`} fill="color-mix(in srgb, var(--tone-ok) 14%, transparent)" />
        <path d={`M${coords.slice(0, -1).join(" L")}`} fill="none" stroke="var(--tone-ok)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <path d={`M${coords[n - 2]} L${coords[n - 1]}`} fill="none" stroke="var(--tone-ok)" strokeWidth="2" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      </svg>

      <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        {points.map((point, index) => {
          const now = index === n - 1;
          const text = `${formatMoney(point.value)}${point.note ? ` · ${point.note}` : ""}`;

          return (
            <div
              key={point.label}
              title={`${point.label}: ${text}`}
              onMouseEnter={() => setHover(index)}
              onMouseLeave={() => setHover(null)}
              className="grid cursor-default grid-rows-[1fr_22px] justify-items-center rounded-md hover:bg-linear-to-b hover:from-transparent hover:to-highlight/70"
            >
              <div className="relative w-full">
                <span
                  style={{ top: `${y(point.value)}%` }}
                  className={`absolute left-1/2 -mt-[4.5px] -ml-[4.5px] h-[9px] w-[9px] rounded-full border-2 border-tone-ok ${now ? "bg-tone-ok" : "bg-surface"}`}
                />
                <span
                  style={{ top: `${y(point.value)}%` }}
                  className={`pointer-events-none absolute -translate-y-[130%] rounded-md bg-primary px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-on-primary transition-opacity ${
                    now ? "right-0" : "left-1/2 -translate-x-1/2"
                  } ${hover === index || (now && hover === null) ? "opacity-100" : "opacity-0"}`}
                >
                  {text}
                </span>
              </div>
              <span className={`text-xs leading-[22px] ${now ? "font-semibold text-ink" : "text-faint"}`}>{point.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default LineChart;
