import { useEffect, useState } from "react";
import {
  getCommissionCompletionPercentage,
  deliveryDay,
  getDeadlineStatus,
  isoDay,
  netIncome,
  paymentSummary,
  ratePerHour,
  isCommissionCompleted as isCommissionCompletedHelper,
  loadStageImagesForCommissions,
  formatMoney,
} from "../lib/commissionHelpers";
import {
  getCommissions,
  getAllPayments,
  getCommissionTags,
  getTemplateStages,
  type Commission,
  type CommissionPayment,
  type CommissionStageImage,
  type Tag,
  type TemplateStage,
} from "../lib/database";
import { locale, t } from "../lib/i18n";
import { thumbUrl } from "../lib/images";
import { hide } from "../lib/privacy";
import TagChip from "../components/TagChip";
import { ATTENTION_STYLE, loadAttention, type Attention } from "../lib/reminders";
import PageHeader from "../components/PageHeader";

const DAY = 24 * 60 * 60 * 1000;

function DashboardPage({ onOpenCommissionsPage }: { onOpenCommissionsPage: () => void }) {
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [ready, setReady] = useState(false);
  const [commissionTagsById, setCommissionTagsById] = useState<Record<number, Tag[]>>({});
  const [templateStagesByTemplateId, setTemplateStagesByTemplateId] = useState<Record<number, TemplateStage[]>>({});
  const [stageImagesByCommissionId, setStageImagesByCommissionId] = useState<Record<number, CommissionStageImage[]>>({});
  const [payments, setPayments] = useState<CommissionPayment[]>([]);
  const [attention, setAttention] = useState<Attention<Commission>[]>([]);

  useEffect(() => {
    loadAttention().then(setAttention).catch(console.error);
  }, []);

  useEffect(() => {
    getCommissions()
      .then(async (data) => {
        setCommissions(data);

        const tagEntries = await Promise.all(
          data.map(async (commission) => [commission.id, await getCommissionTags(commission.id)] as const),
        );
        setCommissionTagsById(Object.fromEntries(tagEntries));

        const templateIds = [
          ...new Set(data.map((commission) => commission.template_id).filter((id): id is number => id !== null)),
        ];
        const stageEntries = await Promise.all(
          templateIds.map(async (templateId) => [templateId, await getTemplateStages(templateId)] as const),
        );
        setTemplateStagesByTemplateId(Object.fromEntries(stageEntries));

        setStageImagesByCommissionId(await loadStageImagesForCommissions(data));
        setPayments(await getAllPayments());
        setReady(true);
      })
      .catch(console.error);
  }, []);

  function handleOpenCommission(commission: Commission) {
    localStorage.setItem("zeeboard-active-commission-id", String(commission.id));
    onOpenCommissionsPage();
  }

  const today = new Date(new Date().toDateString()).getTime();
  const daysUntil = (deadline: string) => (new Date(`${deadline}T00:00:00`).getTime() - today) / DAY;

  // Dated ones first, most urgent to least; undated last
  const inProgress = commissions
    .filter((commission) => !isCommissionCompletedHelper(commission, templateStagesByTemplateId))
    .sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"));

  const dueThisWeek = inProgress.filter(
    (commission) => commission.deadline !== null && daysUntil(commission.deadline) <= 7,
  ).length;

  const summaryOf = (commission: Commission) =>
    paymentSummary(
      commission.price,
      payments.filter((payment) => payment.commission_id === commission.id),
    );

  // What's left to collect: unpaid and partial with a price
  const unpaid = commissions
    .map((commission) => ({ commission, remaining: summaryOf(commission).remaining }))
    .filter((entry) => entry.remaining > 0);

  const thisMonth = new Date().toISOString().slice(0, 7);
  const receivedThisMonth = paymentSummary(
    null,
    payments.filter((payment) => payment.paid_at.startsWith(thisMonth)),
  );

  const monthFormatter = new Intl.DateTimeFormat(locale, { month: "short" });
  const now = new Date();
  const receivedByMonth = Array.from({ length: 6 }, (_, index) => {
    const month = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1);
    const key = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
    const summary = paymentSummary(
      null,
      payments.filter((payment) => payment.paid_at.startsWith(key)),
    );
    return { label: monthFormatter.format(month), total: summary.received, pending: summary.pendingReceived };
  });
  // Hourly rate of what you delivered in the last 90 days (only pieces with hours)
  const since = isoDay(new Date(Date.now() - 90 * DAY));
  const recent = commissions.filter(
    (commission) =>
      isCommissionCompletedHelper(commission, templateStagesByTemplateId) &&
      deliveryDay(commission) >= since &&
      commission.hours !== null &&
      commission.hours > 0,
  );
  const recentRate = ratePerHour(
    recent.map((commission) => ({ net: netIncome(summaryOf(commission)), hours: commission.hours })),
  );
  const recentHours = recent.reduce((sum, commission) => sum + (commission.hours ?? 0), 0);

  const maxReceived = Math.max(...receivedByMonth.map((entry) => entry.total), 1);

  const tagCounts = new Map<number, { tag: Tag; count: number }>();
  Object.values(commissionTagsById)
    .flat()
    .filter((tag) => tag.category !== "Characters" && tag.category !== "Payment")
    .forEach((tag) => {
      const entry = tagCounts.get(tag.id) ?? { tag, count: 0 };
      entry.count += 1;
      tagCounts.set(tag.id, entry);
    });
  const topTags = [...tagCounts.values()].sort((a, b) => b.count - a.count).slice(0, 6);

  const stats = [
    { label: t("In progress"), value: inProgress.length, detail: t("commissions"), className: "text-ink" },
    {
      label: t("Due within 7 days"),
      value: dueThisWeek,
      detail: t("including overdue"),
      className: dueThisWeek > 0 ? "text-tone-warn" : "text-ink",
    },
    {
      label: t("Waiting for payment"),
      value: formatMoney(unpaid.reduce((sum, entry) => sum + entry.remaining, 0)),
      detail: t(unpaid.length === 1 ? "{n} commission" : "{n} commissions", { n: unpaid.length }),
      className: unpaid.length > 0 ? "text-tone-bad" : "text-ink",
    },
    {
      label: t("Received this month"),
      value: formatMoney(receivedThisMonth.received),
      detail:
        receivedThisMonth.pendingReceived > 0
          ? t("{n} payments not entered yet", { n: receivedThisMonth.pendingReceived })
          : t("{amount} in platform fees", { amount: formatMoney(receivedThisMonth.fees) }),
      className: "text-tone-ok",
    },
  ];

  const panel = "panel rounded-3xl p-5";
  const heading = "mb-3 text-xs font-bold text-muted";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <PageHeader label="Overview" title="Dashboard" description="What's on your desk today." />

      <div className="space-y-5 p-5 pb-6">
        {attention.length > 0 && (
          <section className={panel}>
            <h3 className={heading}>{t("Needs attention · {n}", { n: attention.length })}</h3>

            <div className="divide-y divide-line">
              {attention.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => handleOpenCommission(item.commission)}
                  className="flex w-full items-center gap-3 py-2 text-left text-sm transition hover:bg-paper"
                >
                  <span className={`w-24 shrink-0 rounded-sm px-2 py-0.5 text-xs font-bold ${ATTENTION_STYLE[item.kind].className}`}>
                    {t(ATTENTION_STYLE[item.kind].label)}
                  </span>
                  <span className="truncate">{item.text}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <dl className="grid grid-cols-4 gap-4">
          {stats.map((stat) => (
            <div key={stat.label} className={panel}>
              <dt className="text-xs font-bold text-muted">{stat.label}</dt>
              <dd className={`mt-1 text-2xl font-black ${stat.className}`}>{stat.value}</dd>
              <dd className="text-xs text-muted">{stat.detail}</dd>
            </div>
          ))}
        </dl>

        <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-5">
          <section className={panel}>
            <h3 className={heading}>{t("In progress · {n}", { n: inProgress.length })}</h3>

            {!ready ? null : inProgress.length === 0 ? (
              <p className="text-sm text-muted">{t("Nothing on the board. Time for a break.")}</p>
            ) : (
              <div className="divide-y divide-line">
                {inProgress.map((commission) => {
                  const stages = commission.template_id ? templateStagesByTemplateId[commission.template_id] ?? [] : [];
                  const stageIndex = stages.findIndex((stage) => stage.id === commission.current_stage_id);
                  const images = stageImagesByCommissionId[commission.id] ?? [];
                  const latestImage = images[images.length - 1] ?? null;
                  const deadlineStatus = getDeadlineStatus(commission.deadline);
                  const progress = getCommissionCompletionPercentage(commission, templateStagesByTemplateId);

                  return (
                    <button
                      key={commission.id}
                      type="button"
                      onClick={() => handleOpenCommission(commission)}
                      className="grid w-full grid-cols-[40px_minmax(0,1fr)_96px_auto] items-center gap-4 py-2.5 text-left transition hover:bg-paper"
                    >
                      {latestImage ? (
                        <img
                          src={thumbUrl(latestImage.image_data_url)}
                          loading="lazy" decoding="async"
                          alt=""
                          className="h-10 w-10 rounded-md object-cover"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-md bg-paper" />
                      )}

                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold">{commission.title}</p>
                        <p className="truncate text-xs text-muted">
                          {stageIndex >= 0
                            ? `${stages[stageIndex].name} · ${stageIndex + 1}/${stages.length}`
                            : t("Not started")}
                          {commission.client_name ? ` · ${hide(commission.client_name)}` : ""}
                        </p>
                      </div>

                      <div className="h-1.5 overflow-hidden rounded-sm bg-paper">
                        <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
                      </div>

                      {deadlineStatus ? (
                        <span className={`rounded-sm px-2 py-0.5 text-xs font-bold ${deadlineStatus.className}`}>
                          {deadlineStatus.label}
                        </span>
                      ) : (
                        <span className="text-xs text-faint">{t("No deadline")}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <div className="space-y-5">
            <section className={panel}>
              <h3 className={heading}>{t("Not paid yet · {n}", { n: unpaid.length })}</h3>

              {!ready ? null : unpaid.length === 0 ? (
                <p className="text-sm text-muted">{t("All caught up.")}</p>
              ) : (
                <div className="divide-y divide-line">
                  {unpaid.map(({ commission, remaining }) => (
                    <button
                      key={commission.id}
                      type="button"
                      onClick={() => handleOpenCommission(commission)}
                      className="flex w-full items-center justify-between gap-3 py-2 text-left text-sm transition hover:bg-paper"
                    >
                      <span className="truncate">{commission.title}</span>
                      <span className="shrink-0 font-bold">
                        {formatMoney(remaining, commission.currency)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            {recentRate !== null && (
              <section className={panel}>
                <h3 className={heading}>{t("Your hourly rate · last 90 days")}</h3>
                <p className="text-3xl font-black text-tone-ok">{formatMoney(recentRate)}/h</p>
                <p className="mt-1 text-xs text-muted">
                  {t(recent.length === 1 ? "{n} piece · {hours} h" : "{n} pieces · {hours} h", {
                    n: recent.length,
                    hours: Math.round(recentHours * 10) / 10,
                  })}
                </p>
              </section>
            )}

            <section className={panel}>
              <h3 className={heading}>{t("Most used tags")}</h3>

              {!ready ? null : topTags.length === 0 ? (
                <p className="text-sm text-muted">{t("No tags in use yet.")}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {topTags.map(({ tag, count }) => (
                    <span key={tag.id} className="flex items-center gap-1.5 text-xs">
                      <TagChip name={tag.name} color={tag.color} />
                      <span className="text-faint">{count}</span>
                    </span>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>

        <section className={panel}>
          <h3 className={heading}>{t("Received per month · after platform fees")}</h3>

          <div className="flex h-36 items-end gap-3 border-b border-line">
            {receivedByMonth.map((entry) => (
              // ponytail: native tooltip (title); a custom one if more detail is needed
              <div
                key={entry.label}
                title={`${entry.label}: ${formatMoney(entry.total)}${
                  entry.pending > 0 ? ` · ${t("{n} not entered", { n: entry.pending })}` : ""
                }`}
                className="flex h-full flex-1 flex-col justify-end"
              >
                <div
                  className="min-h-px rounded-t-sm bg-primary transition hover:bg-primary-hover"
                  style={{ height: `${(entry.total / maxReceived) * 100}%` }}
                />
              </div>
            ))}
          </div>

          <div className="mt-1 flex gap-3">
            {receivedByMonth.map((entry) => (
              <div key={entry.label} className="flex-1 text-center text-xs text-faint">
                {entry.label}
                <span className="block font-semibold text-muted">{formatMoney(entry.total)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export default DashboardPage;
