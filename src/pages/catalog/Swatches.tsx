import { t } from "../../lib/i18n";

/** Palette plus a custom colour; shared by the type and tag editors. */
function Swatches({ colors, value, onChange }: { colors: string[]; value: string; onChange: (color: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          title={color}
          aria-label={color}
          aria-pressed={value === color}
          onClick={() => onChange(color)}
          className={`h-[22px] w-[22px] rounded-sm transition hover:scale-110 ${value === color ? "outline-2 outline-offset-2 outline-ink" : ""}`}
          style={{ backgroundColor: color }}
        />
      ))}
      <label
        title={t("Custom colour")}
        className="relative flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded-sm border border-dashed border-line-strong text-xs text-muted hover:text-ink"
      >
        +
        <input type="color" value={value} onChange={(event) => onChange(event.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
      </label>
    </div>
  );
}

export default Swatches;
