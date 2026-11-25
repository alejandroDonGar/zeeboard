import { useEffect, useState } from "react";
import {
  fillMessage,
  formatMoney,
  inDefaultCurrency,
  isCommissionCompleted,
  isoDay,
  loadStageImagesForCommissions,
  paymentSummary,
} from "../lib/commissionHelpers";
import {
  appSettings,
  getAllPayments,
  getCommissions,
  getRequests,
  getStagesByTemplate,
  getTemplates,
  setCommissionWaiting,
  type Commission,
  type CommissionPayment,
  type CommissionStageImage,
  type Template,
  type TemplateStage,
} from "../lib/database";
import { locale, t } from "../lib/i18n";
import { thumbUrl } from "../lib/images";
import { hide } from "../lib/privacy";
import { ATTENTION_STYLE, loadAttention, type Attention, type AttentionKind } from "../lib/reminders";
import { useToast } from "../context/ToastContext";
import TopBar from "../components/TopBar";

const DAY = 24 * 60 * 60 * 1000;

// What needs you today, grouped by reason (like Things' Today or Linear's Inbox), most urgent first
const GROUPS: { title: string; kinds: AttentionKind[] }[] = [
  { title: "Overdue", kinds: ["overdue", "due-today"] },
  { title: "Due within 7 days", kinds: ["due-soon"] },
  { title: "Not paid yet", kinds: ["payment"] },
  { title: "Stalled", kinds: ["stalled"] },
];

/**
 * Today: one column with what needs attention and the action to resolve it right there (copy the payment reminder,
 * mark as waiting for the client). The board and the numbers live in Commissions and Statistics, not repeated here.
 */
function DashboardPage({
  onOpenCommissionsPage,
  onOpenRequestsPage,
  onNewCommission,
}: {
  onOpenCommissionsPage: () => void;
  onOpenRequestsPage: () => void;
  onNewCommission: () => void;
}) {
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [stagesByTemplateId, setStagesByTemplateId] = useState<Record<number, TemplateStage[]>>({});
  const [imagesByCommissionId, setImagesByCommissionId] = useState<Record<number, CommissionStageImage[]>>({});
  const [payments, setPayments] = useState<CommissionPayment[]>([]);
  const [attention, setAttention] = useState<Attention<Commission>[]>([]);
  const [newRequests, setNewRequests] = useState<string[]>([]);
  const { showToast } = useToast();

  const reloadAttention = () => loadAttention().then(setAttention);

  useEffect(() => {
    reloadAttention().catch(console.error);
    getRequests()
      .then((requests) => setNewRequests(requests.filter((request) => request.status === "new").map((request) => request.name)))
      .catch(console.error);
    getCommissions()
      .then(async (data) => {
        const templateList = await getTemplates();
        setCommissions(data);
        setTemplates(templateList);
        setStagesByTemplateId(await getStagesByTemplate(templateList.map((template) => template.id)));
        setImagesByCommissionId(await loadStageImagesForCommissions(data));
        setPayments(await getAllPayments());
      })
      .catch(console.error);
  }, []);

  function open(commission: Commission) {
    localStorage.setItem("zeeboard-active-commission-id", String(commission.id));
    onOpenCommissionsPage();
  }

  // Every total in your currency (another currency by its typed rate; without one it isn't added)
  const money = inDefaultCurrency(commissions, payments, appSettings().default_currency);
  const remainingOf = (commission: Commission) =>
    paymentSummary(commission.price, money.payments.filter((payment) => payment.commission_id === commission.id)).remaining;
  const toCollect = money.commissions.reduce((sum, commission) => sum + Math.max(remainingOf(commission), 0), 0);
  const thisMonth = isoDay(new Date()).slice(0, 7);
  const receivedThisMonth = paymentSummary(null, money.payments.filter((payment) => payment.paid_at.startsWith(thisMonth))).received;
  const active = commissions.filter((commission) => !isCommissionCompleted(commission, stagesByTemplateId));
  const today = new Date(new Date().toDateString()).getTime();
  const dueThisWeek = active.filter((commission) => commission.deadline && (new Date(`${commission.deadline}T00:00:00`).getTime() - today) / DAY <= 7).length;

  async function copyReminder(commission: Commission) {
    const text = fillMessage(t("Hi {client}! Whenever you can, {remaining} is left for {title}. Thank you!"), {
      client: commission.client_name ?? "",
      title: commission.title,
      remaining: formatMoney(remainingOf(commission), commission.currency),
    });
    await navigator.clipboard.writeText(text);
    showToast("Message copied.", "success");
  }

  async function markWaiting(commission: Commission) {
    await setCommissionWaiting(commission.id, true);
    await reloadAttention(); // a commission waiting for the client is no longer "stalled"
  }

  // Without an image yet: the type's colour and initial, so the row doesn't look broken (M4.3)
  const thumb = (commission: Commission) => {
    const images = imagesByCommissionId[commission.id] ?? [];
    const latest = images[images.length - 1];
    const type = templates.find((template) => template.id === commission.template_id);

    return latest ? (
      <img src={thumbUrl(latest.image_data_url)} loading="lazy" decoding="async" alt="" className="h-10 w-10 shrink-0 rounded-control object-cover" />
    ) : (
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control text-sm font-semibold text-ink"
        style={{ backgroundColor: type ? `color-mix(in srgb, ${type.color} 22%, transparent)` : "var(--highlight)" }}
      >
        {(type?.name ?? commission.title).slice(0, 1)}
      </span>
    );
  };

  const action = "shrink-0 rounded-control border border-field-border bg-surface px-2.5 py-1 text-xs font-semibold text-ink transition hover:bg-highlight";

  return (
    <div className="flex h-full min-h-0 flex-col text-sm">
      <TopBar title="Dashboard" action="New commission" shortcut="Ctrl N" onAction={onNewCommission} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="max-w-[880px] px-8 py-7">
          <h2 className="font-display text-3xl font-semibold tracking-tight">{t("Today")}</h2>
          <p className="mt-1 text-faint first-letter:uppercase">
            {new Date().toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" })}
          </p>
          {/* The money at a glance, as one sentence (like Stripe's summary line), instead of a column of figures */}
          <p className="mt-3 text-muted">
            {t("{collect} to collect, {received} received this month, {active} in progress and {due} due within 7 days.", {
              collect: formatMoney(toCollect),
              received: formatMoney(receivedThisMonth),
              active: active.length,
              due: dueThisWeek,
            })}
          </p>

          {attention.length === 0 && newRequests.length === 0 && <p className="mt-8 text-muted">{t("Nothing urgent.")}</p>}

          {GROUPS.map((group) => {
            const items = attention.filter((item) => group.kinds.includes(item.kind));
            if (items.length === 0) return null;

            return (
              <section key={group.title} className="mt-7">
                <h3 className="mb-1 flex items-baseline gap-2 text-sm font-semibold">
                  {t(group.title)}
                  <span className="font-medium text-faint tabular-nums">{items.length}</span>
                </h3>
                {items.map((item) => (
                  <div key={item.key} className="flex items-center gap-3 border-t border-line py-2 first-of-type:border-t-0">
                    <button type="button" onClick={() => open(item.commission)} className="flex min-w-0 flex-1 items-center gap-3 rounded-control text-left">
                      {thumb(item.commission)}
                      <span className="min-w-0">
                        <strong className="block truncate font-semibold">{item.text}</strong>
                        <small className="block truncate text-xs text-muted">
                          {item.commission.client_name ? hide(item.commission.client_name) : t("No client")}
                        </small>
                      </span>
                    </button>
                    {item.kind === "payment" && (
                      <button type="button" onClick={() => copyReminder(item.commission).catch(console.error)} className={action}>
                        {t("Copy reminder")}
                      </button>
                    )}
                    {item.kind === "stalled" && (
                      <button type="button" onClick={() => markWaiting(item.commission).catch(console.error)} className={action}>
                        {t("Waiting for the client")}
                      </button>
                    )}
                    <span className={`chip shrink-0 ${ATTENTION_STYLE[item.kind].className}`}>{t(ATTENTION_STYLE[item.kind].label)}</span>
                  </div>
                ))}
              </section>
            );
          })}

          {newRequests.length > 0 && (
            <section className="mt-7">
              <h3 className="mb-1 flex items-baseline gap-2 text-sm font-semibold">
                {t("Requests to answer")}
                <span className="font-medium text-faint tabular-nums">{newRequests.length}</span>
              </h3>
              <div className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 truncate text-muted">{newRequests.map((name) => hide(name)).join(", ")}</span>
                <button type="button" onClick={onOpenRequestsPage} className={action}>
                  {t("Go to Requests")}
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

export default DashboardPage;
