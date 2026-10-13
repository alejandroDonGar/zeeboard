import { t } from "../../lib/i18n";
import { thumbUrl } from "../../lib/images";
import { hide } from "../../lib/privacy";
import { getDeadlineStatus } from "../../lib/commissionHelpers";
import { ageInDays, daysToDeadline } from "../../lib/reminders";
import { appSettings } from "../../lib/database";
import type { Commission, CommissionStageImage, TemplateStage } from "../../lib/database";
import GlassPanel from "../../components/GlassPanel";

/** List view, left column: in progress and queue. Each row has the colour bar of its type, thumbnail, stage and deadline. */
function CommissionList({
  ready,
  noCommissions,
  inboxGroups,
  activeCommissionId,
  templateStagesByTemplateId,
  stageImagesByCommissionId,
  typeColor,
  handleOpenCommission,
}: {
  ready: boolean;
  /** No commissions at all (else: none match the filters) */
  noCommissions: boolean;
  inboxGroups: { label: string; items: Commission[] }[];
  activeCommissionId: number | null;
  templateStagesByTemplateId: Record<number, TemplateStage[]>;
  stageImagesByCommissionId: Record<number, CommissionStageImage[]>;
  typeColor: (commission: Commission) => string;
  handleOpenCommission: (commission: Commission) => void;
}) {
  return (
    <GlassPanel as="nav" className="min-h-0" contentClassName="overflow-y-auto p-2">
      {!ready ? null : inboxGroups.every((group) => group.items.length === 0) ? (
        <p className="p-4 text-center text-sm text-faint">{noCommissions ? t("No commissions yet") : t("No matches")}</p>
      ) : (
        inboxGroups
          .filter((group) => group.items.length > 0)
          .map((group) => (
            <div key={group.label} className="mb-2 last:mb-0">
              <p className="flex items-baseline gap-2 px-2.5 pt-2.5 pb-1.5 text-xs font-semibold text-muted">
                {group.label}
                <span className="font-medium text-faint tabular-nums">{group.items.length}</span>
              </p>

              {group.items.map((commission) => {
                const images = stageImagesByCommissionId[commission.id] ?? [];
                const latestImage = images[images.length - 1] ?? null;
                const stages = commission.template_id ? templateStagesByTemplateId[commission.template_id] ?? [] : [];
                const stageName = stages.find((stage) => stage.id === commission.current_stage_id)?.name;
                const deadlineStatus = getDeadlineStatus(commission.deadline);
                const selected = commission.id === activeCommissionId;

                // No deadline: days since acceptance, colored as it nears your promise
                const left = daysToDeadline(commission, appSettings().promise_max_days, new Date()).daysLeft;
                const ageTone = left < 0 ? "chip chip-bad" : left <= appSettings().reminder_days_before ? "chip chip-warn" : "";

                return (
                  <button
                    key={commission.id}
                    type="button"
                    onClick={() => handleOpenCommission(commission)}
                    aria-current={selected ? "true" : undefined}
                    className={`relative grid w-full grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-md py-1.5 pr-2 pl-3.5 text-left transition ${
                      selected ? "bg-highlight" : "hover:bg-highlight/60"
                    }`}
                  >
                    {/* Barra con el color del tipo de comisión */}
                    <span className="absolute top-2 bottom-2 left-1 w-[3px] rounded-sm" style={{ backgroundColor: typeColor(commission) }} />

                    {latestImage ? (
                      <img src={thumbUrl(latestImage.image_data_url)} loading="lazy" decoding="async" alt="" className="h-9 w-9 rounded-md object-cover" />
                    ) : (
                      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-highlight text-xs font-semibold text-muted">
                        {hide(commission.client_name || "?").slice(0, 2)}
                      </span>
                    )}

                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold" title={commission.title}>{commission.title}</span>
                      <span className="flex items-center gap-1.5 text-xs text-faint">
                        <i className={`h-[7px] w-[7px] shrink-0 rounded-full ${commission.current_stage_id !== null ? "bg-tone-info" : "bg-faint"}`} />
                        <span className="truncate">
                          {[commission.client_name && hide(commission.client_name), stageName].filter(Boolean).join(" · ") || t("No client")}
                        </span>
                      </span>
                    </span>

                    {deadlineStatus ? (
                      <span className={`shrink-0 ${deadlineStatus.className}`}>{deadlineStatus.short}</span>
                    ) : (
                      <span title={t("Days since you accepted it")} className={`shrink-0 text-xs font-semibold tabular-nums ${ageTone || "text-faint"}`}>
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
