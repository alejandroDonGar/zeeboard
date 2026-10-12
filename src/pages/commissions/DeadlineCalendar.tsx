import { locale, t } from "../../lib/i18n";
import type { Commission } from "../../lib/database";
import GlassPanel from "../../components/GlassPanel";

/** Grid view side panel: this month with the open commission's deadline marked */
function DeadlineCalendar({ activeCommission }: { activeCommission: Commission | null }) {
const today = new Date();
const currentMonth = today.toLocaleString(locale, {
  month: "long",
});

const currentYear = today.getFullYear();

const firstDayOfMonth = new Date(
  currentYear,
  today.getMonth(),
  1,
);

let startingWeekDay = firstDayOfMonth.getDay();

if (startingWeekDay === 0) {
  startingWeekDay = 7;
}

const daysInMonth = new Date(
  currentYear,
  today.getMonth() + 1,
  0,
).getDate();

const calendarDays = [
  ...Array(startingWeekDay - 1).fill(null),
  ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
];

const selectedDeadlineCommission =
  activeCommission?.deadline ? activeCommission : null;

const daysUntilSelectedDeadline = selectedDeadlineCommission?.deadline
  ? Math.ceil(
      (new Date(selectedDeadlineCommission.deadline).getTime() -
        new Date().getTime()) /
        (1000 * 60 * 60 * 24),
    )
  : null;

  return (
    <GlassPanel as="aside" className="h-full min-h-0" contentClassName="overflow-hidden p-5">
      <div className="max-h-full overflow-y-auto rounded-3xl border border-line bg-paper p-4">
        <p className="text-xs font-bold text-muted">
          {t("Calendar")}
        </p>

        <p className="mt-2 text-lg font-black">
          {currentMonth} {currentYear}
        </p>

        {selectedDeadlineCommission && (
          <div className="mt-4 rounded-2xl bg-surface p-4 shadow-sm">
            <p className="text-xs font-bold text-muted">
              {t("Next deadline")}
            </p>

            <p className="mt-2 text-sm font-black">
              {selectedDeadlineCommission.title}
            </p>

            <p className="mt-1 text-xs text-muted">
              {selectedDeadlineCommission.deadline}
            </p>

            <p className="mt-3 rounded-sm bg-tone-warn/15 px-3 py-1 text-xs font-bold text-ink">
              {daysUntilSelectedDeadline !== null
                ? t(daysUntilSelectedDeadline === 1 ? "{n} day left" : "{n} days left", { n: daysUntilSelectedDeadline })
                : t("No date")}
            </p>
          </div>
        )}

        <div className="mt-4 grid grid-cols-7 gap-2 text-center text-xs font-bold text-faint">
          <span>{t("Mon")}</span>
          <span>{t("Tue")}</span>
          <span>{t("Wed")}</span>
          <span>{t("Thu")}</span>
          <span>{t("Fri")}</span>
          <span>{t("Sat")}</span>
          <span>{t("Sun")}</span>
        </div>

        <div className="mt-3 grid grid-cols-7 gap-2">
          {calendarDays.map((day, index) => {
            const deadlineDate = selectedDeadlineCommission?.deadline
              ? new Date(selectedDeadlineCommission.deadline)
              : null;

            const cellDate =
              day !== null
                ? new Date(currentYear, today.getMonth(), day)
                : null;

            const isToday =
              cellDate !== null &&
              cellDate.toDateString() === today.toDateString();

            const isInDeadlineRange =
              cellDate !== null &&
              deadlineDate !== null &&
              cellDate >= new Date(today.getFullYear(), today.getMonth(), today.getDate()) &&
              cellDate < deadlineDate;

            const isDeadlineDay =
              cellDate !== null &&
              deadlineDate !== null &&
              cellDate.toDateString() === deadlineDate.toDateString();

            return (
              <div
                key={index}
                className={
                  isDeadlineDay
                    ? "flex aspect-square items-center justify-center rounded-xl bg-tone-bad text-xs font-black text-on-tone"
                    : isToday
                      ? "flex aspect-square items-center justify-center rounded-xl bg-primary-hover text-xs font-black text-on-primary shadow-sm"
                      : isInDeadlineRange
                        ? "flex aspect-square items-center justify-center rounded-xl bg-tone-warn/15 text-xs font-bold text-ink"
                        : "flex aspect-square items-center justify-center rounded-xl bg-surface text-xs font-bold text-faint"
                }
              >
                {day ?? ""}
              </div>
            );
          })}
        </div>

        {selectedDeadlineCommission?.deadline && (
          <div className="mt-4 rounded-2xl bg-surface p-4 shadow-sm">
            <p className="text-xs font-bold text-muted">
              {t("Deadline summary")}
            </p>

            <div className="mt-3 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-muted">{t("Today")}</span>
                <span className="font-bold text-ink">
                  {today.toLocaleDateString(locale, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-muted">{t("Deadline")}</span>
                <span className="font-bold text-tone-bad">
                  {new Date(selectedDeadlineCommission.deadline).toLocaleDateString(
                    locale,
                    {
                      month: "short",
                      day: "numeric",
                    },
                  )}
                </span>
              </div>

              <div className="rounded-sm bg-tone-warn/15 px-3 py-2 text-center text-xs font-bold text-ink">
                {daysUntilSelectedDeadline !== null
                  ? daysUntilSelectedDeadline > 0
                    ? t(daysUntilSelectedDeadline === 1 ? "{n} day left" : "{n} days left", { n: daysUntilSelectedDeadline })
                    : daysUntilSelectedDeadline === 0
                      ? t("Due today")
                      : t(daysUntilSelectedDeadline === -1 ? "{n} day overdue" : "{n} days overdue", { n: Math.abs(daysUntilSelectedDeadline) })
                  : t("No deadline")}
              </div>
            </div>
          </div>
        )}
      </div>
    </GlassPanel>
  );
}

export default DeadlineCalendar;
