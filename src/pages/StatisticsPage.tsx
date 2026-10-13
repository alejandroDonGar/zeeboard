import { useEffect, useMemo, useState } from "react";
import TopBar from "../components/TopBar";
import GlassPanel from "../components/GlassPanel";
import Money from "../components/Money";
import LineChart from "../components/LineChart";
import { Segmented } from "../components/BoardFilters";
import { formatMoney } from "../lib/commissionHelpers";
import {
  appSettings,
  getAllPayments,
  getCommissions,
  getRequests,
  getTemplates,
  getTemplateStages,
  type Commission,
  type CommissionPayment,
  type CommissionRequest,
  type Template,
  type TemplateStage,
} from "../lib/database";
import { locale, t } from "../lib/i18n";
import { hide } from "../lib/privacy";
import { changePercent, computeStats, type Period } from "../lib/stats";

/** ▲ 12 % / ▼ 5 % against the previous period (nothing when there is nothing to compare) */
function Change({ now, before }: { now: number | null; before: number | null }) {
  const change = changePercent(now, before);

  if (change === null) {
    return <span className="text-faint">{t("No previous period")}</span>;
  }

  return (
    <span className={change >= 0 ? "text-tone-ok" : "text-tone-bad"}>
      {change >= 0 ? "▲" : "▼"} {Math.abs(change)} %
    </span>
  );
}

function StatisticsPage() {
  const [period, setPeriod] = useState<Period>("year");
  const [data, setData] = useState<{
    commissions: Commission[];
    payments: CommissionPayment[];
    requests: CommissionRequest[];
    templates: Template[];
    stages: Record<number, TemplateStage[]>;
  } | null>(null);

  useEffect(() => {
    (async () => {
      const [commissions, payments, requests, templates] = await Promise.all([getCommissions(), getAllPayments(), getRequests(), getTemplates()]);
      const stages = Object.fromEntries(
        await Promise.all(templates.map(async (template) => [template.id, await getTemplateStages(template.id)] as const)),
      );

      setData({ commissions, payments, requests, templates, stages });
    })().catch(console.error);
  }, []);

  const stats = useMemo(
    () => (data ? computeStats({ ...data, currency: appSettings().default_currency, now: new Date() }, period) : null),
    [data, period],
  );

  const monthFormatter = new Intl.DateTimeFormat(locale, { month: "short" });
  const noData = stats !== null && stats.current.pieces === 0 && stats.current.received === 0;
  const colorOf = (name: string) => data?.templates.find((template) => template.name === name)?.color ?? "var(--line-strong)";
  // "This year" lists the whole year; the line stops at the current month (the last point is the one still running)
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const chartMonths = stats?.months.filter((month) => month.key <= thisMonth) ?? [];

  const tiles = stats && [
    { label: t("Received"), value: <Money amount={stats.current.received} />, change: <Change now={stats.current.received} before={stats.previous?.received ?? null} /> },
    { label: t("Pieces delivered"), value: stats.current.pieces, change: <Change now={stats.current.pieces} before={stats.previous?.pieces ?? null} /> },
    {
      label: t("Average per piece"),
      value: stats.current.avgPerPiece === null ? "—" : <Money amount={stats.current.avgPerPiece} />,
      change: <Change now={stats.current.avgPerPiece} before={stats.previous?.avgPerPiece ?? null} />,
    },
    {
      label: t("Per hour"),
      value: stats.current.rate === null ? "—" : <><Money amount={stats.current.rate} />/h</>,
      change: <Change now={stats.current.rate} before={stats.previous?.rate ?? null} />,
    },
  ];

  const h3 = "mb-2.5 flex items-baseline gap-2 text-[13px] font-semibold";
  const funnel = stats && [
    { label: t("accepted"), n: stats.requests.accepted, color: "bg-tone-ok" },
    { label: t("declined"), n: stats.requests.declined, color: "bg-faint" },
    { label: t("on the waitlist"), n: stats.requests.waitlist, color: "bg-tone-warn" },
    { label: t("unanswered"), n: stats.requests.open, color: "bg-tone-info" },
  ];
  const bestClient = Math.max(...(stats?.topClients.map((client) => client.net) ?? []), 1);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 text-sm">
      <TopBar
        title="Statistics"
        end={
          stats && stats.excluded > 0 ? (
            <span className="text-xs text-faint">
              {t(stats.excluded === 1 ? "{n} commission in another currency isn't counted." : "{n} commissions in another currency aren't counted.", { n: stats.excluded })}
            </span>
          ) : undefined
        }
      >
        <Segmented
          options={[
            { value: "year", label: "This year" },
            { value: "12m", label: "Last 12 months" },
            { value: "all", label: "All time" },
          ]}
          value={period}
          onChange={setPeriod}
        />
      </TopBar>

      <GlassPanel className="min-h-0 flex-1" contentClassName="overflow-y-auto px-6 pb-8">
        {noData && <p className="pt-5 text-muted">{t("Nothing in this period yet.")}</p>}

        {tiles && (
          <dl className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-y-4 pt-5 pb-5">
            {tiles.map((tile) => (
              <div key={tile.label} className="border-l border-line px-5 first:border-l-0 first:pl-0">
                <dt className="text-[13px] text-muted">{tile.label}</dt>
                <dd className="mt-1 font-display text-2xl leading-tight font-semibold tabular-nums">{tile.value}</dd>
                <dd className="mt-0.5 text-xs">{tile.change}</dd>
              </div>
            ))}
          </dl>
        )}

        {stats && chartMonths.length > 1 && (
          <section className="border-t border-line py-5">
            <h3 className={h3}>{t("Received per month · after platform fees")}</h3>
            <LineChart points={chartMonths.map((month) => ({ label: monthFormatter.format(new Date(`${month.key}-01T12:00:00`)), value: month.total }))} height={200} />
          </section>
        )}

        {stats && (
          <div className="grid grid-cols-1 border-t border-line min-[1100px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <section className="min-w-0 py-5 min-[1100px]:pr-6">
              <h3 className={h3}>{t("By type of commission")}</h3>
              {stats.byTemplate.length === 0 ? (
                <p className="text-faint">{t("Nothing in this period yet.")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[13px] tabular-nums">
                    <thead>
                      <tr className="text-right text-faint">
                        {[t("Template"), t("Pieces"), t("Received"), t("Average"), t("Hours"), t("Days"), t("Per hour")].map((label, index) => (
                          <th key={label} className={`pb-2 font-medium whitespace-nowrap ${index === 0 ? "text-left" : "pl-3"}`}>
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {stats.byTemplate.map((row) => (
                        <tr key={row.name} className="border-t border-line text-right whitespace-nowrap">
                          <td className="py-2.5 pl-0 text-left font-semibold whitespace-normal">
                            <i className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-[-1px]" style={{ backgroundColor: colorOf(row.name) }} />
                            {row.name || t("No template")}
                          </td>
                          <td className="py-2.5 pl-3 text-muted">{row.pieces}</td>
                          <td className="py-2.5 pl-3 font-semibold">{formatMoney(row.net)}</td>
                          <td className="py-2.5 pl-3 text-muted">{formatMoney(row.avgNet)}</td>
                          <td className="py-2.5 pl-3 text-muted">{row.avgHours ?? "—"}</td>
                          <td className="py-2.5 pl-3 text-muted">{row.avgDays ?? "—"}</td>
                          <td className="py-2.5 pl-3 font-semibold">{row.rate === null ? "—" : `${formatMoney(row.rate)}/h`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="min-w-0 border-t border-line py-5 min-[1100px]:border-t-0 min-[1100px]:border-l min-[1100px]:pl-6">
              <h3 className={h3}>{t("Top clients")}</h3>
              {stats.topClients.length === 0 ? (
                <p className="text-faint">{t("No delivered pieces with a client in this period.")}</p>
              ) : (
                <>
                  <div className="grid gap-2">
                    {stats.topClients.map((client, index) => (
                      <div key={client.name} className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-2.5">
                        <span className="text-faint tabular-nums">{index + 1}</span>
                        <strong className="truncate font-semibold">{hide(client.name)}</strong>
                        <span className="text-muted tabular-nums">
                          {t(client.pieces === 1 ? "{n} piece" : "{n} pieces", { n: client.pieces })} · <b className="font-semibold text-ink">{formatMoney(client.net)}</b>
                        </span>
                        <span className="col-start-2 col-end-4 mt-1 mb-1 h-1 overflow-hidden rounded-sm bg-line">
                          <i className="block h-full bg-ink" style={{ width: `${(client.net / bestClient) * 100}%` }} />
                        </span>
                      </div>
                    ))}
                  </div>
                  {stats.returningShare !== null && (
                    <p className="mt-3.5 text-muted">{t("{n} % of this income comes from clients who come back.", { n: stats.returningShare })}</p>
                  )}
                </>
              )}
            </section>
          </div>
        )}

        {stats && (
          <div className="grid grid-cols-1 border-t border-line min-[1100px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <section className="min-w-0 py-5 min-[1100px]:pr-6">
              <h3 className={h3}>
                {t("Requests")} <span className="font-medium text-faint tabular-nums">{stats.requests.received}</span>
              </h3>
              {stats.requests.received === 0 ? (
                <p className="text-faint">{t("Nothing in this period yet.")}</p>
              ) : (
                <>
                  <div className="my-3 flex h-2.5 overflow-hidden rounded-full bg-line" role="img" aria-label={t("Requests")}>
                    {funnel!.map((part) => (
                      <i key={part.label} className={`block ${part.color}`} style={{ flex: part.n }} />
                    ))}
                  </div>
                  <p className="flex flex-wrap gap-x-[18px] gap-y-1.5 text-[13px] text-muted">
                    {funnel!.map((part) => (
                      <span key={part.label} className="inline-flex items-center gap-1.5">
                        <i className={`h-[7px] w-[7px] rounded-full ${part.color}`} />
                        <b className="font-semibold text-ink tabular-nums">{part.n}</b> {part.label}
                      </span>
                    ))}
                  </p>
                  {stats.requests.rate !== null && (
                    <p className="mt-3 text-muted">{t("{n} % of the decided ones were accepted", { n: stats.requests.rate })}</p>
                  )}
                </>
              )}
            </section>

            <section className="min-w-0 border-t border-line py-5 min-[1100px]:border-t-0 min-[1100px]:border-l min-[1100px]:pl-6">
              <h3 className={h3}>{t("Platform fees")}</h3>
              <p className="font-display text-[22px] leading-tight font-semibold tabular-nums">
                <Money amount={stats.fees.total} />
              </p>
              <p className="mt-1 text-muted">
                {stats.fees.percent === null
                  ? t("No payments with the received amount entered in this period.")
                  : t("{percent} % of what clients paid.", { percent: stats.fees.percent.toLocaleString(locale) })}
              </p>
              {stats.fees.pending > 0 && (
                <p className="mt-1 text-xs text-faint">
                  {t(stats.fees.pending === 1 ? "{n} payment without the received amount isn't included." : "{n} payments without the received amount aren't included.", { n: stats.fees.pending })}
                </p>
              )}
            </section>
          </div>
        )}
      </GlassPanel>
    </div>
  );
}

export default StatisticsPage;
