import { formatMoney } from "../lib/commissionHelpers";

/** Cantidad con los céntimos y la moneda más pequeños y en gris: 350,00 EUR → 350 ,00 EUR. Números de ancho fijo. */
function Money({ amount, currency }: { amount: number; currency?: string | null }) {
  const [number, ...rest] = formatMoney(amount, currency).split(" ");
  const parts = number.match(/^(.*\d)([.,]\d{2})$/);

  return (
    <span className="tabular-nums">
      {parts ? parts[1] : number}
      <small className="text-[0.65em] font-medium text-faint">
        {parts ? parts[2] : ""}
        {rest.length > 0 ? ` ${rest.join(" ")}` : ""}
      </small>
    </span>
  );
}

export default Money;
