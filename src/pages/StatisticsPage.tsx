import { useEffect, useMemo, useState } from "react";
import PageHeader from "../components/PageHeader";
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

const panel = "panel rounded-3xl p-5";
const heading = "mb-3 text-xs font-bold text-muted";

/** ▲ 12 % / ▼ 5 % against the previous period (nothing when there is nothing to compare) */
function Change({ now, before }: { now: number | null; before: number | null }) {
  const change = changePercent(now, before);

  if (change === null) {
    return null;
  }

  return (
    <span className={change >= 0 ? "text-green-600" : "text-red-500"}>
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
  const maxMonth = Math.max(...(stats?.months.map((month) => month.total) ?? []), 1);
  const maxRequests = Math.max(...(stats?.requests.months.map((month) => month.received) ?? []), 1);
  const noData = stats !== null && stats.current.pieces === 0 && stats.current.received === 0;

  const tiles = stats && [
    {
      label: t("Received"),
      value: formatMoney(stats.current.received),
      change: <Change now={stats.current.received} before={stats.previous?.received ?? null} />,
      className: "text-green-600",
    },
    {
      label: t("Pieces delivered"),
      value: stats.current.pieces,
      change: <Change now={stats.current.pieces} before={stats.previous?.pieces ?? null} />,
      className: "text-ink",
    },
    {
      label: t("Average per piece"),
      value: stats.current.avgPerPiece === null ? "—" : formatMoney(stats.current.avgPerPiece),
      change: <Change now={stats.current.avgPerPiece} before={stats.previous?.avgPerPiece ?? null} />,
      className: "text-ink",
    },
    {
      label: t("Per hour"),
      value: stats.current.rate === null ? "—" : `${formatMoney(stats.current.rate)}/h`,
      change: <Change now={stats.current.rate} before={stats.previous?.rate ?? null} />,
      className: "text-ink",
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <PageHeader label="Business" title="Statistics" description="How your commissions are doing." />

      <div className="space-y-5 p-5 pb-10">
        <div className="flex items-center gap-3">
          <Segmented
            options={[
              { value: "year", label: "This year" },
              { value: "12m", label: "Last 12 months" },
              { value: "all", label: "All time" },
            ]}
            value={period}
            onChange={setPeriod}
          />
          {stats && stats.excluded > 0 && (
            <span className="text-xs text-faint">
              {t(stats.excluded === 1 ? "{n} commission in another currency isn't counted." : "{n} commissions in another currency aren't counted.", { n: stats.excluded })}
            </span>
          )}
        </div>

        {noData && <p className={`${panel} text-sm text-muted`}>{t("Nothing in this period yet.")}</p>}

        {tiles && (
          <dl className="grid grid-cols-4 gap-4">
            {tiles.map((tile) => (
              <div key={tile.label} className={panel}>
                <dt className="text-xs font-bold text-muted">{tile.label}</dt>
                <dd className={`mt-1 text-2xl font-black ${tile.className}`}>{tile.value}</dd>
                <dd className="text-xs">{tile.change}</dd>
              </div>
            ))}
          </dl>
        )}

        {stats && (
          <section className={panel}>
            <h3 className={heading}>{t("Received per month · after platform fees")}</h3>

            <div className="flex h-36 items-end gap-3 border-b border-line">
              {stats.months.map((month) => (
                <div key={month.key} title={`${month.key}: ${formatMoney(month.total)}`} className="flex h-full flex-1 flex-col justify-end">
                  <div
                    className="min-h-px rounded-t-sm bg-primary transition hover:bg-primary-hover"
                    style={{ height: `${(month.total / maxMonth) * 100}%` }}
                  />
                </div>
              ))}
            </div>

            <div className="mt-1 flex gap-3">
              {stats.months.map((month) => (
                <div key={month.key} className="flex-1 text-center text-xs text-faint">
                  {monthFormatter.format(new Date(`${month.key}-01T12:00:00`))}
                  <span className="block font-semibold text-muted">{formatMoney(month.total)}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {stats && stats.byTemplate.length > 0 && (
          <section className={panel}>
            <h3 className={heading}>{t("By type of commission")}</h3>

            <div className="grid grid-cols-[minmax(0,1fr)_70px_100px_100px_80px_70px_110px] gap-4 px-2 pb-2 text-xs font-bold text-muted">
              <span>{t("Template")}</span>
              <span className="text-right">{t("Pieces")}</span>
              <span className="text-right">{t("Received")}</span>
              <span className="text-right">{t("Average")}</span>
              <span className="text-right">{t("Hours")}</span>
              <span className="text-right">{t("Days")}</span>
              <span className="text-right">{t("Per hour")}</span>
            </div>

            <div className="divide-y divide-line border-y border-line">
              {stats.byTemplate.map((row) => (
                <div key={row.name} className="grid grid-cols-[minmax(0,1fr)_70px_100px_100px_80px_70px_110px] items-center gap-4 px-2 py-2 text-sm">
                  <span className="truncate font-bold">{row.name || t("No template")}</span>
                  <span className="text-right text-muted">{row.pieces}</span>
                  <span className="text-right font-bold">{formatMoney(row.net)}</span>
                  <span className="text-right text-muted">{formatMoney(row.avgNet)}</span>
                  <span className="text-right text-muted">{row.avgHours ?? "—"}</span>
                  <span className="text-right text-muted">{row.avgDays ?? "—"}</span>
                  <span className="text-right font-bold">{row.rate === null ? "—" : `${formatMoney(row.rate)}/h`}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {stats && stats.requests.received > 0 && (
          <section className={panel}>
            <h3 className={heading}>{t("Requests")}</h3>

            <p className="mb-4 text-sm text-muted">
              <span className="text-2xl font-black text-ink">{stats.requests.received}</span> {t("received")}
              {" · "}
              <span className="font-bold text-green-600">{stats.requests.accepted}</span> {t("accepted")}
              {" · "}
              <span className="font-bold text-red-500">{stats.requests.declined}</span> {t("declined")}
              {" · "}
              <span className="font-bold text-ink">{stats.requests.waitlist}</span> {t("on the waitlist")}
              {" · "}
              <span className="font-bold text-ink">{stats.requests.open}</span> {t("unanswered")}
              {stats.requests.rate !== null && (
                <>
                  {" · "}
                  {t("{n} % of the decided ones were accepted", { n: stats.requests.rate })}
                </>
              )}
            </p>

            <div className="flex h-24 items-end gap-3 border-b border-line">
              {stats.requests.months.map((month) => (
                <div
                  key={month.key}
                  title={`${month.key}: ${t("{received} received · {accepted} accepted", { received: month.received, accepted: month.accepted })}`}
                  className="flex h-full flex-1 flex-col justify-end"
                >
                  <div className="flex min-h-px flex-col justify-end" style={{ height: `${(month.received / maxRequests) * 100}%` }}>
                    <div className="bg-line-strong" style={{ flex: month.received - month.accepted }} />
                    <div className="rounded-t-sm bg-primary" style={{ flex: month.accepted }} />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-1 flex gap-3">
              {stats.requests.months.map((month) => (
                <div key={month.key} className="flex-1 text-center text-xs text-faint">
                  {monthFormatter.format(new Date(`${month.key}-01T12:00:00`))}
                  <span className="block font-semibold text-muted">{month.received}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {stats && (
          <div className="grid grid-cols-2 items-start gap-5">
            <section className={panel}>
              <h3 className={heading}>{t("Top clients")}</h3>

              {stats.topClients.length === 0 ? (
                <p className="text-sm text-muted">{t("No delivered pieces with a client in this period.")}</p>
              ) : (
                <>
                  <div className="divide-y divide-line">
                    {stats.topClients.map((client) => (
                      <div key={client.name} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <span className="truncate font-bold">{hide(client.name)}</span>
                        <span className="shrink-0 text-muted">
                          {t(client.pieces === 1 ? "{n} piece" : "{n} pieces", { n: client.pieces })} ·{" "}
                          <span className="font-bold text-ink">{formatMoney(client.net)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                  {stats.returningShare !== null && (
                    <p className="mt-3 text-xs text-muted">
                      {t("{n} % of this income comes from clients who come back.", { n: stats.returningShare })}
                    </p>
                  )}
                </>
              )}
            </section>

            <section className={panel}>
              <h3 className={heading}>{t("Platform fees")}</h3>
              <p className="text-3xl font-black text-red-500">{formatMoney(stats.fees.total)}</p>
              <p className="mt-1 text-xs text-muted">
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
      </div>
    </div>
  );
}

export default StatisticsPage;
