import type { ReactNode } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import { t } from "../../lib/i18n";
import { imageUrl, thumbUrl } from "../../lib/images";
import { hide } from "../../lib/privacy";
import type { Client, CharacterReference, ClientCharacter, Commission, Tag, Template } from "../../lib/database";
import type { getDeadlineStatus } from "../../lib/commissionHelpers";
import Linkified from "../../components/Linkified";
import TagChip from "../../components/TagChip";

/** Right column of the detail: properties, tags, payments, notes and characters. */
function CommissionInfo({
  commission,
  type,
  stageLabel,
  deadlineStatus,
  revisions,
  client,
  copyTag,
  tags,
  payments,
  isLastStage,
  characters,
  referencesByCharacterId,
  setZoomedImage,
}: {
  commission: Commission;
  type: Template | null;
  stageLabel: string;
  deadlineStatus: ReturnType<typeof getDeadlineStatus>;
  /** Corrections so far and how many the price includes (null = no limit) */
  revisions: { count: number; included: number | null };
  client: Client | null;
  copyTag: (handle: string) => void;
  tags: Tag[];
  /** The payments block (summary and payments list) */
  payments: ReactNode;
  isLastStage: boolean;
  characters: ClientCharacter[];
  referencesByCharacterId: Record<number, CharacterReference[]>;
  setZoomedImage: (url: string | null) => void;
}) {
  const label = "pt-2.5 text-faint first:pt-0";
  const value = "flex min-w-0 flex-wrap items-center gap-1.5 pt-2.5 first:pt-0";
  const heading = "mb-2 text-sm font-semibold";
  // An inspector section (like Lightroom's or Figma's): a title that folds what's under it. Native <details>, so the
  // keyboard and screen readers already know it. ponytail: not remembered; add localStorage if people fold the same ones
  const section = (title: string, body: ReactNode) => (
    <details open className="group min-w-0 border-b border-line pb-4 last:border-b-0 [&:not([open])]:pb-0">
      <summary className="mb-2.5 flex cursor-pointer list-none items-center justify-between text-sm font-semibold [&::-webkit-details-marker]:hidden">
        {t(title)}
        <IconChevronDown size={15} stroke={1.75} aria-hidden="true" className="text-faint transition group-open:rotate-180" />
      </summary>
      {body}
    </details>
  );
  const showRevisions = revisions.included !== null || revisions.count > 0;
  const revisionTone =
    revisions.included === null ? "" : revisions.count > revisions.included ? "chip-bad" : revisions.count === revisions.included ? "chip-warn" : "";

  return (
    <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(240px,1fr))] content-start gap-x-8 gap-y-5 border-t border-line p-4 @min-[760px]:grid-cols-1 @min-[760px]:overflow-y-auto @min-[760px]:border-t-0 @min-[760px]:border-l">
      {section("Commission", <>
      <dl className="grid grid-cols-[84px_minmax(0,1fr)] items-center gap-x-2.5">
        {type && (
          <>
            <dt className={label}>{t("Type")}</dt>
            {/* Plain text, not a chip: a long type name stays on one line instead of a tall block */}
            <dd className={value} title={type.name}>
              <span className="flex min-w-0 items-center gap-1.5">
                <i className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: type.color }} />
                <span className="truncate">{type.name}</span>
              </span>
            </dd>
          </>
        )}

        <dt className={label}>{t("Stage")}</dt>
        <dd className={value}>{stageLabel}</dd>

        <dt className={label}>{t("Delivery")}</dt>
        <dd className={value}>
          {deadlineStatus ? <span className={deadlineStatus.className}>{deadlineStatus.label}</span> : <span className="text-faint">{t("No deadline")}</span>}
        </dd>

        {showRevisions && (
          <>
            <dt className={label}>{t("Revisions")}</dt>
            <dd className={value}>
              <span title={t("Each client correction counts as one revision")} className={`chip ${revisionTone}`}>
                {revisions.count}
                {revisions.included !== null && ` / ${revisions.included}`}
                {revisions.included !== null && revisions.count > revisions.included && ` · ${t("extra")}`}
              </span>
            </dd>
          </>
        )}

        {client?.tag_handle && (
          <>
            <dt className={label}>{t("Tag")}</dt>
            <dd className={value}>
              <button
                type="button"
                title={t("Copy the account to tag when you post")}
                onClick={() => copyTag(client.tag_handle!)}
                className="max-w-full truncate rounded-chip border border-line-strong px-2 py-0.5 text-xs font-semibold text-muted transition hover:border-ink hover:text-ink"
              >
                {hide(client.tag_handle)}
                {client.tag_platform && client.tag_platform !== "Other" ? ` · ${client.tag_platform}` : ""} ⧉
              </button>
            </dd>
          </>
        )}
      </dl>

      {tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label={t("Tags")}>
          {tags.map((tag) => (
            <TagChip key={tag.id} name={tag.name} color={tag.color} />
          ))}
        </div>
      )}
      </>)}

      {section("Money", payments)}

      {characters.length > 0 &&
        section(
          "Characters",
          <div className="space-y-2">
            {characters.map((character) => (
              <div key={character.id} className="flex items-center gap-2">
                <span className="w-20 shrink-0 truncate font-semibold">{character.name}</span>
                <div className="flex flex-wrap gap-1">
                  {(referencesByCharacterId[character.id] ?? []).map((reference) => (
                    <button key={reference.id} type="button" title={reference.label} onClick={() => setZoomedImage(imageUrl(reference.image_data_url))} className="cursor-zoom-in">
                      <img src={thumbUrl(reference.image_data_url)} loading="lazy" decoding="async" alt={reference.label} className="h-8 w-8 rounded-chip object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>,
        )}

      {(commission.notes || (isLastStage && commission.final_notes)) &&
        section(
          "Notes",
          <>
            <p className="line-clamp-6 whitespace-pre-wrap text-muted">{commission.notes ? <Linkified text={commission.notes} /> : t("No notes.")}</p>
            {isLastStage && commission.final_notes && (
              <>
                <p className={`${heading} mt-3`}>{t("Final notes")}</p>
                <p className="line-clamp-6 whitespace-pre-wrap text-muted">
                  <Linkified text={commission.final_notes} />
                </p>
              </>
            )}
          </>,
        )}
    </div>
  );
}

export default CommissionInfo;
