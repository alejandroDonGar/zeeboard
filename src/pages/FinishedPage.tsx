import { locale, t } from "../lib/i18n";
import { useEffect, useState } from "react";
import { imageUrl, thumbUrl } from "../lib/images";
import {
  deliveryDay,
  isCommissionCompleted as isCommissionCompletedHelper,
  loadStageImagesForCommissions,
  formatMoney,
  netIncome,
  paymentSummary,
  ratePerHour,
} from "../lib/commissionHelpers";
import {
  getAllPayments,
  getCommissions,
  getTemplates,
  getTemplateStages,
  type Commission,
  type CommissionPayment,
  type CommissionStageImage,
  type Template,
  type TemplateStage,
} from "../lib/database";
import { hide } from "../lib/privacy";
import PageHeader from "../components/PageHeader";
import { Segmented } from "../components/BoardFilters";

type FinishedGroup = {
  key: string;
  label: string;
  commissions: Commission[];
};

function FinishedPage({
  onOpenCommissionsPage,
}: {
  onOpenCommissionsPage: () => void;
}) {
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [templateStagesByTemplateId, setTemplateStagesByTemplateId] = useState<Record<number, TemplateStage[]>>({});
  const [stageImagesByCommissionId, setStageImagesByCommissionId] = useState<Record<number, CommissionStageImage[]>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [groupMode, setGroupMode] = useState<"month" | "client">("month");
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [payments, setPayments] = useState<CommissionPayment[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);

  useEffect(() => {
    getAllPayments().then(setPayments).catch(console.error);
    getTemplates().then(setTemplates).catch(console.error);
  }, []);

  useEffect(() => {
    getCommissions()
      .then(async (data) => {
        setCommissions(data);

        const templateIds = Array.from(
          new Set(
            data
              .map((commission) => commission.template_id)
              .filter((templateId): templateId is number => templateId !== null),
          ),
        );

        const stageEntries = await Promise.all(
          templateIds.map(async (templateId) => {
            const stages = await getTemplateStages(templateId);
            return [templateId, stages] as const;
          }),
        );

        setTemplateStagesByTemplateId(Object.fromEntries(stageEntries));
        setReady(true);

        setStageImagesByCommissionId(await loadStageImagesForCommissions(data));
      })
      .catch(console.error);
  }, []);

  function isCommissionCompleted(commission: Commission) {
    return isCommissionCompletedHelper(commission, templateStagesByTemplateId);
  }

  function handleOpenCommission(commission: Commission) {
    localStorage.setItem(
      "zeeboard-active-commission-id",
      String(commission.id),
    );

    onOpenCommissionsPage();
  }

  const completedCommissions = commissions.filter(isCommissionCompleted);

  const query = searchQuery.trim().toLowerCase();

  const filteredCompleted = completedCommissions.filter((commission) => {
    const matchesSearch =
      query === "" ||
      commission.title.toLowerCase().includes(query) ||
      (commission.client_name ?? "").toLowerCase().includes(query);

    const delivered = new Date(`${deliveryDay(commission)}T12:00:00`);

    const matchesFrom =
      dateFrom === "" || delivered >= new Date(`${dateFrom}T00:00:00`);

    const matchesTo =
      dateTo === "" || delivered <= new Date(`${dateTo}T23:59:59`);

    return matchesSearch && matchesFrom && matchesTo;
  });

  const totalEarnings = filteredCompleted.reduce(
    (sum, commission) => sum + (commission.price ?? 0),
    0,
  );

  // What each finished commission brought in per hour (only those with hours)
  const net = (commission: Commission) =>
    netIncome(paymentSummary(commission.price, payments.filter((payment) => payment.commission_id === commission.id)));
  const rateOf = (commission: Commission) => ratePerHour([{ net: net(commission), hours: commission.hours }]);
  const overallRate = ratePerHour(filteredCompleted.map((commission) => ({ net: net(commission), hours: commission.hours })));
  const rateByTemplate = templates
    .map((template) => ({
      name: template.name,
      rate: ratePerHour(
        filteredCompleted
          .filter((commission) => commission.template_id === template.id)
          .map((commission) => ({ net: net(commission), hours: commission.hours })),
      ),
    }))
    .filter((entry): entry is { name: string; rate: number } => entry.rate !== null)
    .sort((a, b) => b.rate - a.rate);

  const monthFormatter = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
  });

  function buildMonthGroups(): FinishedGroup[] {
    const groupsMap = new Map<string, FinishedGroup>();

    filteredCompleted.forEach((commission) => {
      const date = new Date(`${deliveryDay(commission)}T12:00:00`);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          key,
          label: monthFormatter.format(new Date(date.getFullYear(), date.getMonth(), 1)),
          commissions: [],
        });
      }

      groupsMap.get(key)!.commissions.push(commission);
    });


    return Array.from(groupsMap.values()).sort((a, b) => b.key.localeCompare(a.key));
  }

  function buildClientGroups(): FinishedGroup[] {
    const groupsMap = new Map<string, FinishedGroup>();

    filteredCompleted.forEach((commission) => {
      const label = commission.client_name || t("No client");

      if (!groupsMap.has(label)) {
        groupsMap.set(label, {
          key: label,
          label,
          commissions: [],
        });
      }

      groupsMap.get(label)!.commissions.push(commission);
    });


    return Array.from(groupsMap.values()).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }

  const groups = groupMode === "month" ? buildMonthGroups() : buildClientGroups();

  const hasActiveFilters = searchQuery.trim() !== "" || dateFrom !== "" || dateTo !== "";

  const dateFormatter = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });

  return (
    <>
      <PageHeader
        label={t("Archive")}
        title={t("Finished commissions")}
        description={t("Everything you've delivered, grouped by delivery month or by client.")}
      />

      <section className="h-[calc(100vh-117px)] min-h-0 p-5 pb-6">
        <div className="flex h-full min-h-0 flex-col panel rounded-3xl p-5">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Segmented
              options={[
                { value: "month", label: "By month" },
                { value: "client", label: "By client" },
              ]}
              value={groupMode}
              onChange={setGroupMode}
            />

            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t("Search title or client…")}
              className="min-w-48 flex-1 rounded-md border border-line-strong bg-paper px-3 py-2 text-sm"
            />

            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="rounded-md border border-line-strong bg-paper px-3 py-2 text-sm"
            />
            <span className="text-xs text-faint">{t("to")}</span>
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="rounded-md border border-line-strong bg-paper px-3 py-2 text-sm"
            />

            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setDateFrom("");
                  setDateTo("");
                }}
                className="px-1 text-xs font-semibold text-muted underline-offset-2 hover:text-ink hover:underline"
              >
                {t("Clear")}
              </button>
            )}

            <span className="ml-auto text-sm font-bold">
              {t("{n} finished · {amount}", { n: filteredCompleted.length, amount: formatMoney(totalEarnings) })}
              {overallRate !== null && ` · ${formatMoney(overallRate)}/h`}
            </span>
          </div>

          {rateByTemplate.length > 0 && (
            <p className="mb-4 text-xs text-muted">
              <span className="font-bold text-muted">{t("Per hour")}</span>
              {rateByTemplate.map((entry) => (
                <span key={entry.name} className="ml-3">
                  {entry.name} <span className="font-bold text-ink">{formatMoney(entry.rate)}</span>
                </span>
              ))}
            </p>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {!ready ? null : filteredCompleted.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <p className="text-lg font-black">
                  {completedCommissions.length === 0 ? t("Nothing finished yet") : t("No matches")}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {completedCommissions.length === 0
                    ? t("Commissions land here when you mark them as finished.")
                    : t("Try another search or date range.")}
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {groups.map((group) => {
                  const groupEarnings = group.commissions.reduce(
                    (sum, commission) => sum + (commission.price ?? 0),
                    0,
                  );

                  return (
                    <section key={group.key}>
                      <div className="mb-1 flex items-baseline justify-between px-2">
                        <h3 className="text-xs font-bold text-muted">
                          {groupMode === "client" ? hide(group.label) : group.label}
                        </h3>
                        <span className="text-xs text-faint">
                          {group.commissions.length} · {formatMoney(groupEarnings)}
                        </span>
                      </div>

                      <div className="divide-y divide-line border-y border-line">
                        {[...group.commissions]
                          .sort((a, b) => deliveryDay(b).localeCompare(deliveryDay(a)))
                          .map((commission) => {
                            const images = stageImagesByCommissionId[commission.id] ?? [];
                            const latestImage = images[images.length - 1] ?? null;

                            return (
                              <div
                                key={commission.id}
                                onClick={() => handleOpenCommission(commission)}
                                title={t("Open commission")}
                                className="grid cursor-pointer grid-cols-[48px_minmax(0,1fr)_160px_80px_130px_100px] items-center gap-4 px-2 py-2 transition hover:bg-paper"
                              >
                                {latestImage ? (
                                  <button
                                    type="button"
                                    title={t("View image")}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setZoomedImage(imageUrl(latestImage.image_data_url));
                                    }}
                                    className="cursor-zoom-in"
                                  >
                                    <img
                                      src={thumbUrl(latestImage.image_data_url)}
                                      loading="lazy" decoding="async"
                                      alt={commission.title}
                                      className="h-12 w-12 rounded-md object-cover"
                                    />
                                  </button>
                                ) : (
                                  <div className="h-12 w-12 rounded-md bg-paper" />
                                )}

                                <span className="truncate text-sm font-bold">{commission.title}</span>
                                <span className="truncate text-sm text-muted">
                                  {hide(commission.client_name || t("No client"))}
                                </span>
                                <span className="text-sm text-faint">
                                  {dateFormatter.format(new Date(`${deliveryDay(commission)}T12:00:00`))}
                                </span>
                                <span className="text-right text-xs text-faint">
                                  {commission.hours !== null && commission.hours > 0
                                    ? `${commission.hours} h${rateOf(commission) !== null ? ` · ${formatMoney(rateOf(commission) as number)}/h` : ""}`
                                    : "—"}
                                </span>
                                <span className="text-right text-sm font-bold">
                                  {commission.price
                                    ? formatMoney(commission.price, commission.currency)
                                    : "—"}
                                </span>
                              </div>
                            );
                          })}
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      {zoomedImage && (
        <div
          className="fixed inset-0 z-[999] flex items-center justify-center bg-black/80 backdrop-blur-md"
          onClick={() => setZoomedImage(null)}
        >
          <img src={zoomedImage} alt="" className="max-h-[90vh] max-w-[90vw] rounded-3xl shadow-2xl" />
        </div>
      )}
    </>
  );
}

export default FinishedPage;
