import { t } from "../../lib/i18n";
import { imageUrl, thumbUrl } from "../../lib/images";
import { hide } from "../../lib/privacy";
import { PAYMENT_STATUS_STYLE, formatMoney, getDeadlineStatus, paymentSummary } from "../../lib/commissionHelpers";
import type { ClientCharacter, Commission, CommissionPayment, CommissionStageImage, Tag, Template } from "../../lib/database";
import TagChip from "../../components/TagChip";

/** Grid view: one card per commission with its latest image, progress, payment and tags */
function CommissionGrid({
  filteredCommissions,
  commissionTagsById,
  getNormalTags,
  typeOf,
  stageImagesByCommissionId,
  getCommissionCompletionPercentage,
  commissionCharactersById,
  charactersByClientId,
  paymentsByCommissionId,
  handleOpenCommission,
  setZoomedImage,
}: {
  filteredCommissions: Commission[];
  commissionTagsById: Record<number, Tag[]>;
  getNormalTags: (tags: Tag[]) => Tag[];
  typeOf: (commission: Commission) => Template | null;
  stageImagesByCommissionId: Record<number, CommissionStageImage[]>;
  getCommissionCompletionPercentage: (commission: Commission) => number;
  commissionCharactersById: Record<number, number[]>;
  charactersByClientId: Record<number, ClientCharacter[]>;
  paymentsByCommissionId: Record<number, CommissionPayment[]>;
  handleOpenCommission: (commission: Commission) => void;
  setZoomedImage: (url: string | null) => void;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
      {filteredCommissions.map((commission) => {
        const tags = commissionTagsById[commission.id] ?? [];
        const normalTags = getNormalTags(tags);
        const type = typeOf(commission);
        const commissionImages = stageImagesByCommissionId[commission.id] ?? [];
        const latestImage = commissionImages.length > 0 ? commissionImages[commissionImages.length - 1] : null;
        const altCount = commissionImages.length;
        const completionPercentage = getCommissionCompletionPercentage(commission);
        const deadlineStatus = getDeadlineStatus(commission.deadline);
        const commissionCharacterIds = commissionCharactersById[commission.id] ?? [];
        const commissionCharacters = Object.values(charactersByClientId).flat().filter((character) => commissionCharacterIds.includes(character.id), );

        return (
          <button
            key={commission.id}
            onClick={() => handleOpenCommission(commission)}
            className="min-w-0 rounded-3xl border border-line bg-paper p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-ink hover:shadow-md"
          >
            {latestImage && (
              <div
                role="button"
                tabIndex={0}
                aria-label={t("Open in focus mode")}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    setZoomedImage(imageUrl(latestImage.image_data_url));
                  }
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  setZoomedImage(imageUrl(latestImage.image_data_url));
                }}
                className="mb-3 cursor-zoom-in overflow-hidden rounded-2xl bg-surface shadow-sm transition hover:scale-[1.02]"
              >
                <img
                  src={thumbUrl(latestImage.image_data_url)}
                  loading="lazy" decoding="async"
                  alt={commission.title}
                  className="h-auto w-full object-contain"
                />
              </div>
            )}
            {(() => {
              const status = PAYMENT_STATUS_STYLE[
                paymentSummary(commission.price, paymentsByCommissionId[commission.id] ?? []).status
              ];

              return (
                <span className={`mb-2 inline-flex rounded-sm px-2 py-0.5 text-xs font-bold ${status.className}`}>
                  {status.label}
                </span>
              );
            })()}

            <h4 className="break-words font-black leading-tight">
              {commission.title}
            </h4>

            {commissionCharacters.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {commissionCharacters.map((character) => (
                  <span
                    key={character.id}
                    className="rounded-sm border border-line-strong bg-surface px-3 py-1 text-xs font-black text-muted shadow-sm"
                  >
                    {character.name}
                  </span>
                ))}
              </div>
            )}

            {(type || normalTags.length > 0) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {type && <TagChip name={type.name} color={type.color} />}
                {normalTags.map((tag) => (
                  <TagChip key={tag.id} name={tag.name} color={tag.color} />
                ))}
              </div>
            )}

            <p className="mt-2 text-sm font-semibold text-muted">
              {hide(commission.client_name || t("No client"))}
            </p>

            <p className="mt-1 text-xs text-faint">
              {commission.platform || t("No platform")}
            </p>

            <div className="mt-3">
              <div className="flex items-center justify-between text-xs font-bold text-muted">
                <span>{t("Progress")}</span>
                <span>{completionPercentage}%</span>
              </div>

              <div className="mt-2 h-2 overflow-hidden rounded-sm bg-surface">
                <div
                  className={
                    completionPercentage === 100
                      ? "h-full rounded-sm bg-tone-ok"
                      : "h-full rounded-sm bg-primary"
                  }
                  style={{ width: `${completionPercentage}%` }}
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {altCount > 0 && (
                <span className="rounded-sm border border-line-strong bg-surface px-3 py-1 text-xs font-black text-muted shadow-sm">
                  📷 {altCount} {t(altCount === 1 ? "Alt" : "Alts")}
                </span>
              )}

              <span className="rounded-sm bg-surface px-3 py-1 text-xs font-bold text-ink shadow-sm">
                {commission.price
                  ? formatMoney(commission.price, commission.currency)
                  : t("No price")}
              </span>

              {deadlineStatus ? (
                <span
                  className={`rounded-sm px-3 py-1 text-xs font-black shadow-sm ${deadlineStatus.className}`}
                >
                  {deadlineStatus.label}
                </span>
              ) : (
                <span className="rounded-sm bg-surface px-3 py-1 text-xs font-bold text-ink shadow-sm">
                  {t("No deadline")}
                </span>
              )}
            </div>

            {commission.notes && (
              <p className="mt-4 line-clamp-3 text-sm leading-relaxed text-muted">
                {commission.notes}
              </p>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default CommissionGrid;
