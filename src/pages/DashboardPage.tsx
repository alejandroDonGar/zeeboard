import { useEffect, useState, type ReactNode } from "react";
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
  getTemplates,
  type Template,
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
import { TYPE_CATEGORY } from "../lib/catalog";
import { ATTENTION_STYLE, loadAttention, type Attention } from "../lib/reminders";
import TopBar from "../components/TopBar";
import Money from "../components/Money";
import LineChart from "../components/LineChart";

const DAY = 24 * 60 * 60 * 1000;

function DashboardPage({ onOpenCommissionsPage, onNewCommission }: { onOpenCommissionsPage: () => void; onNewCommission: () => void }) {
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [ready, setReady] = useState(false);
  const [commissionTagsById, setCommissionTagsById] = useState<Record<number, Tag[]>>({});
  const [templates, setTemplates] = useState<Template[]>([]);
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
        setTemplates(await getTemplates());

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

  // Types count from the template (old type tags are skipped so nothing is counted twice); extras from the tags
  const tagCounts = new Map<number, { tag: Tag; count: number }>();
  const typeTags: Tag[] = commissions.flatMap((commission) => {
    const template = templates.find((item) => item.id === commission.template_id);
    return template ? [{ id: -template.id, name: template.name, color: template.color, category: "" }] : [];
  });
  [...typeTags, ...Object.values(commissionTagsById).flat()]
    .filter((tag) => tag.category !== "Characters" && tag.category !== "Payment" && tag.category !== TYPE_CATEGORY)
    .forEach((tag) => {
      const entry = tagCounts.get(tag.id) ?? { tag, count: 0 };
      entry.count += 1;
      tagCounts.set(tag.id, entry);
    });
  const topTags = [...tagCounts.values()].sort((a, b) => b.count - a.count).slice(0, 6);

  const totalUnpaid = unpaid.reduce((sum, entry) => sum + entry.remaining, 0);
  const received6 = receivedByMonth.reduce((sum, entry) => sum + entry.total, 0);
  const typeColor = (commission: Commission) => templates.find((item) => item.id === commission.template_id)?.color ?? "var(--line-strong)";
  const initials = (name: string | null) => hide(name || "?").slice(0, 2);

  // Un trozo de la pantalla: título pequeño, su contador y, si hace falta, un enlace a la derecha
  const heading = (text: string, count?: number | string, link?: ReactNode) => (
    <h3 className="mb-2 flex items-baseline gap-2 text-[13px] font-semibold">
      {text}
      {count !== undefined && <span className="font-medium text-faint tabular-nums">{count}</span>}
      {link && <span className="ml-auto font-medium text-faint">{link}</span>}
    </h3>
  );
  const row = "relative grid w-full items-center gap-3 rounded-md py-2 pr-2 pl-3.5 text-left transition hover:bg-highlight/60";
  const thumb = (commission: Commission, size: string) => {
    const images = stageImagesByCommissionId[commission.id] ?? [];
    const latest = images[images.length - 1] ?? null;

    return latest ? (
      <img src={thumbUrl(latest.image_data_url)} loading="lazy" decoding="async" alt="" className={`${size} rounded-md object-cover`} />
    ) : (
      <div className={`${size} flex items-center justify-center rounded-md bg-highlight text-sm font-semibold text-muted`}>{initials(commission.client_name)}</div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 text-sm">
      <TopBar title="Dashboard" action="New commission" shortcut="Ctrl N" onAction={onNewCommission}>
        <span className="text-sm text-faint">{new Date().toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" })}</span>
      </TopBar>

      <div className="@container min-h-0 flex-1">
        <section className="glass grid h-full min-h-0 grid-cols-1 overflow-y-auto rounded-3xl @min-[880px]:grid-cols-[minmax(0,1fr)_clamp(280px,30%,360px)] @min-[880px]:overflow-hidden">
          <div className="grid min-w-0 content-start gap-7 p-6 @min-[880px]:overflow-y-auto">
            <section>
              <h2 className="mb-1 font-display text-3xl leading-tight font-semibold tracking-tight">{t("Today")}</h2>
              <p className="mb-3.5 text-muted">
                {attention.length === 0
                  ? t("Nothing urgent.")
                  : t(attention.length === 1 ? "{n} thing needs your attention." : "{n} things need your attention.", { n: attention.length })}
              </p>

              {attention.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => handleOpenCommission(item.commission)}
                  className={`${row} grid-cols-[40px_minmax(0,1fr)_auto] border-t border-line first:border-t-0`}
                >
                  {thumb(item.commission, "h-10 w-10")}
                  <span className="min-w-0">
                    <strong className="block truncate font-semibold">{item.text}</strong>
                    <small className="block truncate text-[12.5px] text-muted">
                      {item.commission.client_name ? hide(item.commission.client_name) : t("No client")}
                    </small>
                  </span>
                  <span className={`chip ${ATTENTION_STYLE[item.kind].className}`}>{t(ATTENTION_STYLE[item.kind].label)}</span>
                </button>
              ))}
            </section>

            <section>
              {heading(t("In progress"), inProgress.length, <button type="button" onClick={onOpenCommissionsPage} className="hover:text-ink">{t("See all")}</button>)}

              {!ready ? null : inProgress.length === 0 ? (
                <p className="text-sm text-muted">{t("Nothing on the board. Time for a break.")}</p>
              ) : (
                inProgress.map((commission) => {
                  const stages = commission.template_id ? templateStagesByTemplateId[commission.template_id] ?? [] : [];
                  const stageIndex = stages.findIndex((stage) => stage.id === commission.current_stage_id);
                  const deadlineStatus = getDeadlineStatus(commission.deadline);
                  const progress = getCommissionCompletionPercentage(commission, templateStagesByTemplateId);

                  return (
                    <button
                      key={commission.id}
                      type="button"
                      onClick={() => handleOpenCommission(commission)}
                      className={`${row} grid-cols-[40px_minmax(0,1fr)_minmax(70px,120px)_88px] border-t border-line first:border-t-0 max-[1100px]:grid-cols-[40px_minmax(0,1fr)_88px]`}
                    >
                      {/* Barra con el color del tipo de comisión */}
                      <span className="absolute top-2.5 bottom-2.5 left-1 w-[3px] rounded-sm" style={{ backgroundColor: typeColor(commission) }} />
                      {thumb(commission, "h-10 w-10")}

                      <div className="min-w-0">
                        <p className="truncate font-semibold" title={commission.title}>{commission.title}</p>
                        <p className="truncate text-xs text-faint">
                          {stageIndex >= 0 ? `${stages[stageIndex].name} · ${stageIndex + 1}/${stages.length}` : t("Not started")}
                          {commission.client_name ? ` · ${hide(commission.client_name)}` : ""}
                        </p>
                      </div>

                      <div className="h-1 overflow-hidden rounded-sm bg-line max-[1100px]:hidden">
                        <div className="h-full rounded-sm bg-ink" style={{ width: `${progress}%` }} />
                      </div>

                      {deadlineStatus ? (
                        <span className={`${deadlineStatus.className} justify-self-end whitespace-nowrap`} title={deadlineStatus.label}>{deadlineStatus.short}</span>
                      ) : (
                        <span className="text-xs text-faint">{t("No deadline")}</span>
                      )}
                    </button>
                  );
                })
              )}
            </section>

            <section>
              {heading(t("Received per month"), t("after platform fees"))}
              <p className="mb-1.5 flex items-baseline gap-2.5">
                <span className="text-[22px] font-semibold"><Money amount={received6} /></span>
                <span className="text-xs text-faint">
                  {t("in {n} months · average {amount} a month", { n: receivedByMonth.length, amount: formatMoney(received6 / receivedByMonth.length) })}
                </span>
              </p>
              <LineChart points={receivedByMonth.map((entry) => ({
                label: entry.label,
                value: entry.total,
                note: entry.pending > 0 ? t("{n} not entered", { n: entry.pending }) : undefined,
              }))} />
            </section>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] content-start gap-x-8 gap-y-6 border-t border-line px-6 py-6 @min-[880px]:grid-cols-1 @min-[880px]:overflow-y-auto @min-[880px]:border-t-0 @min-[880px]:border-l @min-[880px]:px-5">
            <section>
              {heading(t("This month"))}
              <dl>
                {[
                  { label: t("Received"), value: <Money amount={receivedThisMonth.received} />, detail: receivedThisMonth.pendingReceived > 0 ? t("{n} payments not entered yet", { n: receivedThisMonth.pendingReceived }) : t("{amount} in platform fees", { amount: formatMoney(receivedThisMonth.fees) }) },
                  { label: t("Waiting for payment"), value: <Money amount={totalUnpaid} />, detail: t(unpaid.length === 1 ? "{n} commission" : "{n} commissions", { n: unpaid.length }), tone: unpaid.length > 0 ? "text-tone-warn" : "" },
                  { label: t("In progress"), value: inProgress.length, detail: "" },
                  { label: t("Due within 7 days"), value: dueThisWeek, detail: t("including overdue") },
                ].map((stat) => (
                  <div key={stat.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 border-t border-line py-3 first:border-t-0">
                    <dt className="text-muted">{stat.label}</dt>
                    <dd className={`text-right text-xl font-semibold tabular-nums ${stat.tone ?? ""}`}>{stat.value}</dd>
                    {stat.detail && <dd className="col-span-2 text-xs text-faint">{stat.detail}</dd>}
                  </div>
                ))}
              </dl>
            </section>

            <section>
              {heading(t("Not paid yet"), unpaid.length)}

              {!ready ? null : unpaid.length === 0 ? (
                <p className="text-sm text-muted">{t("All caught up.")}</p>
              ) : (
                <>
                  {unpaid.map(({ commission, remaining }) => (
                    <button
                      key={commission.id}
                      type="button"
                      onClick={() => handleOpenCommission(commission)}
                      className="grid w-full grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-md border-t border-line px-1 py-1.5 text-left transition first:border-t-0 hover:bg-highlight/60"
                    >
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-highlight text-[11px] font-bold text-muted">{initials(commission.client_name)}</span>
                      <span className="min-w-0">
                        <strong className="block truncate font-semibold" title={commission.title}>{commission.title}</strong>
                        <small className="block truncate text-xs text-faint">{commission.client_name ? hide(commission.client_name) : t("No client")}</small>
                      </span>
                      <span className="font-semibold whitespace-nowrap"><Money amount={remaining} currency={commission.currency} /></span>
                    </button>
                  ))}
                  <p className="mt-0.5 flex justify-between border-t border-line-strong px-1 pt-2 font-semibold">
                    <span>{t("Total")}</span>
                    <Money amount={totalUnpaid} />
                  </p>
                </>
              )}
            </section>

            {recentRate !== null && (
              <section>
                {heading(t("Your hourly rate"), t("last 90 days"))}
                <p className="text-[26px] font-semibold"><Money amount={recentRate} />/h</p>
                <p className="mt-0.5 text-xs text-faint">
                  {t(recent.length === 1 ? "{n} piece · {hours} h" : "{n} pieces · {hours} h", {
                    n: recent.length,
                    hours: Math.round(recentHours * 10) / 10,
                  })}
                </p>
              </section>
            )}

            <section>
              {heading(t("Most used types and tags"))}

              {!ready ? null : topTags.length === 0 ? (
                <p className="text-sm text-muted">{t("No tags in use yet.")}</p>
              ) : (
                <div className="flex flex-wrap gap-x-3 gap-y-1.5">
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
        </section>
      </div>
    </div>
  );
}

export default DashboardPage;
