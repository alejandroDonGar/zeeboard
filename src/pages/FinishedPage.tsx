import { locale, t } from "../lib/i18n";
import { useEffect, useState } from "react";
import { IconSearch } from "@tabler/icons-react";
import { useAmbientImage } from "../lib/ambient";
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
import TopBar from "../components/TopBar";
import GlassPanel from "../components/GlassPanel";
import Money from "../components/Money";
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
  // Image open in the viewer; while it is, the background takes its colours
  const [viewed, setViewed] = useState<{ path: string; commissionId: number } | null>(null);
  useAmbientImage(viewed?.path);
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

  const dateInput =
    "w-[132px] rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-ink";
  const viewedCommission = viewed ? commissions.find((commission) => commission.id === viewed.commissionId) : undefined;

  return (
    <>
      <div className="flex h-full min-h-0 flex-col gap-3 text-sm">
        <TopBar title="Finished">
          <Segmented
            options={[
              { value: "month", label: "By month" },
              { value: "client", label: "By client" },
            ]}
            value={groupMode}
            onChange={setGroupMode}
          />

          <label className="flex max-w-[280px] min-w-36 flex-[1_1_160px] items-center gap-2 rounded-2xl border border-line bg-surface/60 px-2.5 py-1.5 text-faint focus-within:border-ink">
            <IconSearch size={16} stroke={1.75} aria-hidden="true" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t("Search title or client…")}
              aria-label={t("Search title or client…")}
              className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-faint"
            />
          </label>

          <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} aria-label={t("From")} className={dateInput} />
          <span className="text-xs text-faint max-[1200px]:hidden">{t("to")}</span>
          <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} aria-label={t("To")} className={dateInput} />

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
              {t("Clear filters")}
            </button>
          )}
        </TopBar>

        <GlassPanel className="min-h-0 flex-1" contentClassName="overflow-y-auto px-5 pb-7">
          {!ready ? null : filteredCompleted.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center p-6 text-center">
              <p className="font-display text-xl font-semibold">{completedCommissions.length === 0 ? t("Nothing finished yet") : t("No matches")}</p>
              <p className="mt-1 text-sm text-muted">
                {completedCommissions.length === 0 ? t("Commissions land here when you mark them as finished.") : t("Try another search or date range.")}
              </p>
            </div>
          ) : (
            <>
              <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 pt-3.5 pb-1 text-[13px] text-muted tabular-nums">
                <span className="text-ink">
                  {t("{n} finished · {amount}", { n: filteredCompleted.length, amount: formatMoney(totalEarnings) })}
                  {overallRate !== null && ` · ${formatMoney(overallRate)}/h`}
                </span>
                {rateByTemplate.length > 0 && <span className="font-semibold">{t("Per hour")}</span>}
                {rateByTemplate.map((entry) => (
                  <span key={entry.name}>
                    {entry.name} <b className="font-semibold text-ink">{formatMoney(entry.rate)}</b>
                  </span>
                ))}
              </p>

              {groups.map((group) => {
                const groupEarnings = group.commissions.reduce((sum, commission) => sum + (commission.price ?? 0), 0);

                return (
                  <section key={group.key}>
                    {/* Group header stays at the top while its images scroll */}
                    <div className="sticky top-0 z-10 flex items-baseline gap-2.5 bg-gradient-to-b from-[var(--glass)] from-70% to-transparent pt-4 pb-2.5">
                      <h3 className="font-display text-[22px] leading-tight font-semibold tracking-tight first-letter:uppercase">
                        {groupMode === "client" ? hide(group.label) : group.label}
                      </h3>
                      <span className="text-[12.5px] text-faint tabular-nums">
                        {group.commissions.length} · {formatMoney(groupEarnings)}
                      </span>
                    </div>

                    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-3.5 gap-y-[18px]">
                      {[...group.commissions]
                        .sort((a, b) => deliveryDay(b).localeCompare(deliveryDay(a)))
                        .map((commission) => {
                          const images = stageImagesByCommissionId[commission.id] ?? [];
                          const latestImage = images[images.length - 1] ?? null;
                          const hours = commission.hours !== null && commission.hours > 0 ? commission.hours : null;
                          const rate = rateOf(commission);

                          return (
                            <div key={commission.id} className="min-w-0">
                              {latestImage ? (
                                <button
                                  type="button"
                                  title={t("View image")}
                                  onClick={() => setViewed({ path: latestImage.image_data_url, commissionId: commission.id })}
                                  className="block aspect-square w-full cursor-zoom-in overflow-hidden rounded-md shadow-[0_0_0_1px_var(--line)] transition active:scale-[0.98]"
                                >
                                  <img src={thumbUrl(latestImage.image_data_url)} loading="lazy" decoding="async" alt={commission.title} className="h-full w-full object-cover" />
                                </button>
                              ) : (
                                <div className="aspect-square w-full rounded-md bg-highlight shadow-[0_0_0_1px_var(--line)]" />
                              )}

                              <button
                                type="button"
                                onClick={() => handleOpenCommission(commission)}
                                title={t("Open commission")}
                                className="group mt-2 grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-2 text-left"
                              >
                                <strong className="truncate font-semibold group-hover:underline group-hover:underline-offset-[3px]">{commission.title}</strong>
                                <b className="font-semibold whitespace-nowrap tabular-nums">{commission.price ? <Money amount={commission.price} currency={commission.currency} /> : "—"}</b>
                                <small className="col-span-full truncate text-xs text-faint tabular-nums">
                                  {groupMode === "month"
                                    ? hide(commission.client_name || t("No client"))
                                    : dateFormatter.format(new Date(`${deliveryDay(commission)}T12:00:00`))}
                                  {" · "}
                                  {hours !== null ? `${hours} h${rate !== null ? ` · ${formatMoney(rate)}/h` : ""}` : t("no hours")}
                                </small>
                              </button>
                            </div>
                          );
                        })}
                    </div>
                  </section>
                );
              })}
            </>
          )}
        </GlassPanel>
      </div>

      {viewed && (
        <div className="fixed inset-0 z-[999] flex flex-col items-center justify-center gap-2.5 bg-black/80 p-6 backdrop-blur-md" onClick={() => setViewed(null)}>
          <img src={imageUrl(viewed.path)} alt="" className="max-h-[82vh] max-w-[90vw] rounded-lg shadow-2xl" />
          <p className="flex w-full max-w-[90vw] items-center justify-center gap-4 text-sm text-[#ece6dc]" onClick={(event) => event.stopPropagation()}>
            {viewedCommission && (
              <>
                <span>
                  {viewedCommission.title} · {hide(viewedCommission.client_name || t("No client"))} ·{" "}
                  {dateFormatter.format(new Date(`${deliveryDay(viewedCommission)}T12:00:00`))}
                </span>
                <button type="button" onClick={() => handleOpenCommission(viewedCommission)} className="underline underline-offset-[3px]">
                  {t("Open commission")}
                </button>
              </>
            )}
          </p>
        </div>
      )}
    </>
  );
}

export default FinishedPage;
