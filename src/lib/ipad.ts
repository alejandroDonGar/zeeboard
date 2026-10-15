// Receiving images from the iPad. The server lives in Rust (src-tauri/src/ipad.rs);
// this file starts it, tells it what to list on the iPad, and saves what arrives.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { groupAlternatives, loadOpenCommissions } from "./commissionHelpers";
import { createCommissionStageImage, createImageVersion, getCommissionReferences, getCommissionStageImages, getTemplateStages } from "./database";
import { getThumbPath, isProcessedImage } from "./images";
import { latestOfAlternative } from "./ipadLink";
import { hide } from "./privacy";

/** Tells the screens an image was added from outside, so they re-read the images without remounting */
export const IPAD_IMAGE_ADDED = "zeeboard:ipad-image-added";

const KEY = "zeeboard-ipad";
const DEFAULT_PORT = 8787;

export type IpadSettings = { enabled: boolean; port: number; token: string };

/** The secret in the link: without it the server answers nothing */
export function newToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function saveIpadSettings(settings: IpadSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* no storage: it will ask again next time */
  }
}

export function ipadSettings(): IpadSettings {
  let saved: Partial<IpadSettings> = {};

  try {
    saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    /* nothing saved yet */
  }

  const settings = { enabled: saved.enabled === true, port: saved.port ?? DEFAULT_PORT, token: saved.token ?? newToken() };

  if (!saved.token) {
    saveIpadSettings(settings);
  }

  return settings;
}

/** What the iPad page lists: open commissions, their stages (the hidden "delivery" stage is left out) and each stage's alternatives */
export async function pushSnapshot(): Promise<void> {
  const commissions = await loadOpenCommissions();
  const stagesByTemplate = new Map<number, { id: number; name: string }[]>();

  for (const commission of commissions) {
    if (commission.template_id !== null && !stagesByTemplate.has(commission.template_id)) {
      const stages = await getTemplateStages(commission.template_id);
      stagesByTemplate.set(commission.template_id, stages.length > 1 ? stages.slice(0, -1) : stages);
    }
  }

  const withTemplate = commissions.filter((commission) => commission.template_id !== null);
  const imagesByCommission = new Map(
    await Promise.all(withTemplate.map(async (commission) => [commission.id, await getCommissionStageImages(commission.id)] as const)),
  );
  const referencesByCommission = new Map(
    await Promise.all(withTemplate.map(async (commission) => [commission.id, await getCommissionReferences(commission.id)] as const)),
  );

  const json = JSON.stringify({
    commissions: withTemplate.map((commission) => ({
      id: commission.id,
      title: commission.title,
      client: hide(commission.client_name ?? ""),
      currentStageId: commission.current_stage_id,
      // Character references, to keep them on the iPad: the server only hands out images listed here
      refs: (referencesByCommission.get(commission.id) ?? [])
        .filter((reference) => isProcessedImage(reference.image_data_url))
        .map((reference) => ({
          character: reference.character,
          label: reference.label,
          image: reference.image_data_url,
          thumb: getThumbPath(reference.image_data_url),
        })),
      stages: (stagesByTemplate.get(commission.template_id as number) ?? []).map((stage) => ({
        id: stage.id,
        name: stage.name,
        // Each alternative shows its newest version: that is what a new version is added on top of
        alts: groupAlternatives((imagesByCommission.get(commission.id) ?? []).filter((image) => image.stage_id === stage.id)).map(
          ({ alt, versions }) => {
            const latest = versions[versions.length - 1];

            return {
              alt,
              label: latest.label,
              version: latest.version,
              thumb: isProcessedImage(latest.image_data_url) ? getThumbPath(latest.image_data_url) : null,
            };
          },
        ),
      })),
    })),
  });

  await invoke("ipad_set_snapshot", { json });
}

export async function startIpad(): Promise<void> {
  const { port, token } = ipadSettings();

  await invoke("ipad_start", { port, token });
  await pushSnapshot();
}

export const stopIpad = () => invoke("ipad_stop");

export const ipadAddresses = () => invoke<string[]>("ipad_addresses");

export type IpadImage = { commissionId: number; stageId: number; alt: number | null; stored: { path: string } };

export const listenIpadImages = (onImage: (image: IpadImage) => void) =>
  listen<IpadImage>("ipad-image", (event) => onImage(event.payload));

/**
 * The image is already processed and stored by Rust: it only needs adding to its stage, as a new alternative
 * or, if the iPad chose one, as the next version of that alternative. Returns false when the chosen alternative
 * no longer exists and the image went in as a new one instead.
 */
export async function saveIpadImage(image: IpadImage): Promise<boolean> {
  let asRequested = true;

  if (image.alt !== null) {
    const base = latestOfAlternative(await getCommissionStageImages(image.commissionId), image.stageId, image.alt);

    if (base) {
      await createImageVersion(base.id, image.stored.path);
    } else {
      asRequested = false;
      await createCommissionStageImage(image.commissionId, image.stageId, image.stored.path);
    }
  } else {
    await createCommissionStageImage(image.commissionId, image.stageId, image.stored.path);
  }

  window.dispatchEvent(new Event(IPAD_IMAGE_ADDED));

  return asRequested;
}
