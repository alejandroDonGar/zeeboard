import { t } from "../../lib/i18n";
import { thumbUrl } from "../../lib/images";
import { hide } from "../../lib/privacy";
import { getDeadlineStatus } from "../../lib/commissionHelpers";
import { ageInDays, daysToDeadline } from "../../lib/reminders";
import { appSettings } from "../../lib/database";
import type { Commission, CommissionStageImage, TemplateStage } from "../../lib/database";
import GlassPanel from "../../components/GlassPanel";

/** List view, left column: in progress and queue, each commission with its thumbnail, stage and deadline */
function CommissionList({
  ready,
  noCommissions,
  inboxGroups,
  activeCommissionId,
  templateStagesByTemplateId,
  stageImagesByCommissionId,
  handleOpenCommission,
}: {
  ready: boolean;
  /** No commissions at all (else: none match the filters) */
  noCommissions: boolean;
  inboxGroups: { label: string; items: Commission[] }[];
  activeCommissionId: number | null;
  templateStagesByTemplateId: Record<number, TemplateStage[]>;
  stageImagesByCommissionId: Record<number, CommissionStageImage[]>;
  handleOpenCommission: (commission: Commission) => void;
}) {
  return (
    <GlassPanel as="nav" className="min-h-0" contentClassName="overflow-y-auto p-3">
      {!ready ? null : inboxGroups.every((group) => group.items.length === 0) ? (
        <p className="p-4 text-center text-sm text-faint">
          {noCommissions ? t("No commissions yet") : t("No matches")}
        </p>
      ) : (
        inboxGroups
          .filter((group) => group.items.length > 0)
          .map((group) => (
            <div key={group.label} className="mb-3 last:mb-0">
              <p className="px-2 pb-1 text-xs font-bold text-muted">
                {group.label} · {group.items.length}
              </p>

              {group.items.map((commission) => {
                const images = stageImagesByCommissionId[commission.id] ?? [];
                const latestImage = images[images.length - 1] ?? null;
                const stages = commission.template_id
                  ? templateStagesByTemplateId[commission.template_id] ?? []
                  : [];
                const stageName = stages.find((stage) => stage.id === commission.current_stage_id)?.name;
                const deadlineStatus = getDeadlineStatus(commission.deadline);

                return (
                  <button
                    key={commission.id}
                    type="button"
                    onClick={() => handleOpenCommission(commission)}
                    className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition ${
                      commission.id === activeCommissionId ? "bg-highlight" : "hover:bg-paper"
                    }`}
                  >
                    {latestImage ? (
                      <img
                        src={thumbUrl(latestImage.image_data_url)}
                        loading="lazy" decoding="async"
                        alt=""
                        className="h-9 w-9 shrink-0 rounded-sm object-cover"
                      />
                    ) : (
                      <span className="h-9 w-9 shrink-0 rounded-sm bg-paper" />
                    )}

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">{commission.title}</span>
                      <span className="block truncate text-xs text-faint">
                        {[commission.client_name && hide(commission.client_name), stageName].filter(Boolean).join(" · ") || t("No client")}
                      </span>
                    </span>

                    {deadlineStatus ? (
                      <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-xs font-bold ${deadlineStatus.className}`}>
                        {deadlineStatus.short}
                      </span>
                    ) : (
                      // No deadline: days since acceptance, colored as it nears your promise
                      <span
                        title={t("Days since you accepted it")}
                        className={`shrink-0 rounded-sm px-1.5 py-0.5 text-xs font-bold ${
                          daysToDeadline(commission, appSettings().promise_max_days, new Date()).daysLeft < 0
                            ? "chip chip-bad"
                            : daysToDeadline(commission, appSettings().promise_max_days, new Date()).daysLeft <=
                                appSettings().reminder_days_before
                              ? "chip chip-warn"
                              : "chip"
                        }`}
                      >
                        {ageInDays(commission, new Date())}d
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))
      )}
    </GlassPanel>
  );
}

export default CommissionList;
