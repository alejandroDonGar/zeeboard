import { locale, t } from "../lib/i18n";
import { takeAction } from "../lib/actions";
import { useEffect, useState } from "react";
import { imageUrl, thumbUrl, importImage, pickImagePaths } from "../lib/images";
import { IPAD_IMAGE_ADDED } from "../lib/ipad";
import { useImageInput } from "../lib/useImageInput";
import { hide } from "../lib/privacy";
import Linkified from "../components/Linkified";
import BoardFilters, { Segmented, type PaymentFilter } from "../components/BoardFilters";
import CommissionPayments from "../components/CommissionPayments";
import {
  loadStageImagesForCommissions as loadStageImagesForCommissionsHelper,
  getCommissionCompletionPercentage as getCommissionCompletionPercentageHelper,
  groupAlternatives,
  isCommissionCompleted as isCommissionCompletedHelper,
  getDeadlineStatus,
  paymentSummary,
  pinNumber,
  pendingCorrectionsText,
  invoiceDescription,
} from "../lib/commissionHelpers";
import { TYPE_CATEGORY } from "../lib/catalog";
import {
  getTemplateStages,
  getTemplates,
  getCommissions,
  getAllPayments,
  getAllCorrections,
  addCorrection,
  deleteCorrection,
  setCorrectionDone,
  updateCommissionStage,
  finishCommission,
  duplicateCommission,
  deleteCommission,
  getCommissionTags,
  getClients,
  createCommissionStageImage,
  createImageVersion,
  deleteCommissionStageImage,
  getClientCharacters,
  getCharacterReferences,
  getCommissionCharacterIds,
  getTags,
  type ClientCharacter,
  type CharacterReference,
  type CommissionStageImage,
  type Client,
  type Tag,
  type Commission,
  type CommissionPayment,
  type CommissionCorrection,
  type Template,
  type TemplateStage,
} from "../lib/database";
import PageHeader from "../components/PageHeader";
import TagChip from "../components/TagChip";
import GlassPanel from "../components/GlassPanel";
import { useAmbientImage } from "../lib/ambient";
import ConfirmModal from "../components/ConfirmModal";
import { useToast } from "../context/ToastContext";
import { undoToast } from "../lib/undo";
import DeadlineCalendar from "./commissions/DeadlineCalendar";
import FocusViewer from "./commissions/FocusViewer";
import CommissionForm from "./commissions/CommissionForm";
import CommissionGrid from "./commissions/CommissionGrid";
import CommissionList from "./commissions/CommissionList";
import FinishCommissionModal, { type FinishDetails } from "../components/FinishCommissionModal";

function CommissionsPage() {
  // A single form to create and edit: null = closed
  const [form, setForm] = useState<{ mode: "new" | "edit"; tagIds: number[] } | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [charactersByClientId, setCharactersByClientId] = useState<Record<number, ClientCharacter[]>>({});
  const [commissionCharactersById, setCommissionCharactersById] = useState<Record<number, number[]>>({});
  const [referencesByCharacterId, setReferencesByCharacterId] = useState<Record<number, CharacterReference[]>>({});
  const [templates, setTemplates] = useState<Template[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [ready, setReady] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [activeCommissionId, setActiveCommissionId] = useState<number | null>(null);
  const [workflowStages, setWorkflowStages] = useState<TemplateStage[]>([]);
  const [templateStagesByTemplateId, setTemplateStagesByTemplateId] = useState<Record<number, TemplateStage[]>>({});
  const activeCommission = commissions.find((commission) => commission.id === activeCommissionId) ?? null;
  const [duplicatingCommission, setDuplicatingCommission] = useState(false);
  const [showDeleteCommissionModal, setShowDeleteCommissionModal] = useState(false);
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [deletingCommission, setDeletingCommission] = useState(false);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [commissionTagsById, setCommissionTagsById] = useState<Record<number, Tag[]>>({});
  const [stageImagesByCommissionId, setStageImagesByCommissionId] = useState<Record<number, CommissionStageImage[]>>({});
  const [activeStageImageIndexByStageId, setActiveStageImageIndexByStageId] = useState<Record<number, number>>({});
  // Image open in focus mode (fullscreen, ← → across all stages)
  const [focusImageId, setFocusImageId] = useState<number | null>(null);
  // Imagen de etapa bajo el cursor: el fondo de la app toma sus colores mientras está encima
  const [hoveredImagePath, setHoveredImagePath] = useState<string | null>(null);
  const [corrections, setCorrections] = useState<CommissionCorrection[]>([]);
  // Stage whose corrections show under the strip; null = none
  const [correctionsStageId, setCorrectionsStageId] = useState<number | null>(null);
  const [correctionDraft, setCorrectionDraft] = useState("");
  // Image height follows the window only, so every commission shows the same size (it used to follow the space left by the content above)
  const [windowHeight, setWindowHeight] = useState(window.innerHeight);
  useEffect(() => {
    const onResize = () => setWindowHeight(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const [commissionMenuOpen, setCommissionMenuOpen] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [importingStageId, setImportingStageId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTagIds, setFilterTagIds] = useState<number[]>([]);
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "overdue">("all");
  const [filterPayment, setFilterPayment] = useState<PaymentFilter>("all");
  const [paymentsByCommissionId, setPaymentsByCommissionId] = useState<Record<number, CommissionPayment[]>>({});
  const { showToast } = useToast();

  // The filter menu also offers the types: each template as a tag with a negative id (no real tag has one)
  const typeFilterTags: Tag[] = templates.map((template) => ({ id: -template.id, name: template.name, color: template.color, category: t("Commission type") }));
  const filterableTags = [...typeFilterTags, ...allTags];

    const filteredCommissions = commissions.filter((commission) => {
    if (isCommissionCompleted(commission)) {
        return false;
    }

    const query = searchQuery.trim().toLowerCase();

    const matchesSearch =
        query === "" ||
        commission.title.toLowerCase().includes(query) ||
        (commission.client_name ?? "").toLowerCase().includes(query);

    const tags = [...(commissionTagsById[commission.id] ?? []), ...typeFilterTags.filter((tag) => tag.id === -(commission.template_id ?? 0))];
    // Within a category one tag is enough (Sketch or Full Colour); across categories, all (and Paid)
    const selectedTagsByCategory = Object.values(
        filterableTags
        .filter((tag) => filterTagIds.includes(tag.id))
        .reduce<Record<string, number[]>>((groups, tag) => {
            (groups[tag.category || "General"] ??= []).push(tag.id);
            return groups;
        }, {}),
    );
    const matchesTags = selectedTagsByCategory.every((tagIds) =>
        tags.some((tag) => tagIds.includes(tag.id)),
    );

    const isOverdue =
        commission.deadline !== null &&
        new Date(`${commission.deadline}T00:00:00`) < new Date(new Date().toDateString());

    const matchesStatus =
        filterStatus === "all" ||
        (filterStatus === "active" && !isOverdue) ||
        (filterStatus === "overdue" && isOverdue);

    const matchesPayment =
        filterPayment === "all" ||
        paymentSummary(commission.price, paymentsByCommissionId[commission.id] ?? []).status === filterPayment;

    return matchesSearch && matchesTags && matchesStatus && matchesPayment;
    });


  useEffect(() => {
    getTemplates()
      .then(async (data) => {
        setTemplates(data);

        const entries = await Promise.all(
          data.map(async (template) => {
            const stages = await getTemplateStages(template.id);
            return [template.id, stages] as const;
          }),
        );

        setTemplateStagesByTemplateId(Object.fromEntries(entries));
      })
      .catch(console.error);

    getCommissions()
      .then(async (data) => {
        setCommissions(data);
        setReady(true);
        await loadTagsForCommissions(data);
        await loadStageImagesForCommissions(data);
        await loadCharactersForCommissions(data);
      })
      .catch(console.error);

    getClients()
      .then(async (data) => {
        setClients(data);

        const characterEntries = await Promise.all(
          data.map(async (client) => {
            const characters = await getClientCharacters(client.id);
            return [client.id, characters] as const;
          }),
        );

        const nextCharactersByClientId =
          Object.fromEntries(characterEntries);

        setCharactersByClientId(nextCharactersByClientId);

        await loadReferencesForCharactersFromClients(
          nextCharactersByClientId,
        );
      })
      .catch(console.error);

    getTags()
      .then(setAllTags)
      .catch(console.error);
  }, []);


  useEffect(() => {
    if (takeAction("new-commission")) {
      openNewCommissionForm();
    }
  }, []);

  useEffect(() => {
    const savedActiveId = localStorage.getItem("zeeboard-active-commission-id");

    if (savedActiveId) {
      setActiveCommissionId(Number(savedActiveId));
    }
  }, []);

  useEffect(() => {
    if (activeCommissionId !== null) {
      localStorage.setItem("zeeboard-active-commission-id", String(activeCommissionId));
    } else {
      localStorage.removeItem("zeeboard-active-commission-id");
    }
  }, [activeCommissionId]);

  // An image arrived from the iPad: re-read the images without remounting the screen (a form may be open)
  useEffect(() => {
    const refresh = async () => {
      const data = await getCommissions();

      setCommissions(data);
      await loadStageImagesForCommissions(data);
    };

    window.addEventListener(IPAD_IMAGE_ADDED, refresh);
    return () => window.removeEventListener(IPAD_IMAGE_ADDED, refresh);
  }, []);

  useEffect(() => {
    async function loadWorkflowStages() {
      if (!activeCommission?.template_id) {
        setWorkflowStages([]);
        return;
      }

      try {
        const stages = await getTemplateStages(
          activeCommission.template_id,
        );

        setWorkflowStages(stages);
      } catch (error) {
        console.error(error);
      }
    }

    loadWorkflowStages();
  }, [activeCommission]);

  function openNewCommissionForm() {
    setForm({ mode: "new", tagIds: [] });
  }

  function handleOpenCommission(commission: Commission) {
    setActiveCommissionId(commission.id);
    setViewMode("list");
  }


  async function loadPayments() {
    const payments = await getAllPayments();
    const grouped: Record<number, CommissionPayment[]> = {};

    for (const payment of payments) {
      (grouped[payment.commission_id] ??= []).push(payment);
    }

    setPaymentsByCommissionId(grouped);
  }

  async function loadTagsForCommissions(data: Commission[]) {
    // Payments reload at the same moments as tags
    loadPayments().catch(console.error);
    getAllCorrections().then(setCorrections).catch(console.error);

    const entries = await Promise.all(
      data.map(async (commission) => {
        const tags = await getCommissionTags(commission.id);
        return [commission.id, tags] as const;
      }),
    );

    setCommissionTagsById(Object.fromEntries(entries));
  }

  async function loadStageImagesForCommissions(data: Commission[]) {
    setStageImagesByCommissionId(await loadStageImagesForCommissionsHelper(data));
  }

  async function loadCharactersForCommissions(data: Commission[]) {
    const entries = await Promise.all(
      data.map(async (commission) => {
        const characterIds = await getCommissionCharacterIds(commission.id);
        return [commission.id, characterIds] as const;
      }),
    );

    setCommissionCharactersById(Object.fromEntries(entries));
  }

  async function loadReferencesForCharactersFromClients(
    charactersByClient: Record<number, ClientCharacter[]>,
  ) {
    const allCharacters = Object.values(charactersByClient).flat();

    const entries = await Promise.all(
      allCharacters.map(async (character) => {
        const references = await getCharacterReferences(character.id);
        return [character.id, references] as const;
      }),
    );

    setReferencesByCharacterId(Object.fromEntries(entries));
  }

  /** +1 advances to the next stage, -1 goes back to the previous one */
  async function handleMoveStage(direction: 1 | -1) {
    if (!activeCommission || workflowStages.length === 0) {
      return;
    }

    const currentStageIndex = workflowStages.findIndex(
      (stage) => stage.id === activeCommission.current_stage_id,
    );

    const nextStage = workflowStages[currentStageIndex + direction];

    if (!nextStage) {
      return;
    }

    await updateCommissionStage(activeCommission.id, nextStage.id);

    const data = await getCommissions();
    setCommissions(data);

  }

  /** Saves the final image, delivery date, hours and notes, then moves to the (until now hidden) last stage. */
  async function handleFinishCommission(details: FinishDetails) {
    const lastStage = workflowStages[workflowStages.length - 1];

    if (!activeCommission || !lastStage) {
      return;
    }

    try {
      setFinishing(true);

      if (details.imagePaths.length > 0) {
        await handleAddStageImages(lastStage.id, details.imagePaths);
      }

      await finishCommission(activeCommission.id, lastStage.id, details);
      setCommissions(await getCommissions());
      setShowFinishModal(false);
      showToast("Commission finished.", "success");
    } catch (error) {
      console.error(error);
      showToast("Could not finish the commission.", "error");
    } finally {
      setFinishing(false);
    }
  }


  async function handleOpenEditCommission() {
    if (!activeCommission) {
      return;
    }

    setForm({ mode: "edit", tagIds: (await getCommissionTags(activeCommission.id)).map((tag) => tag.id) });
  }


  /** After saving the form: the list reloads and the saved commission opens */
  async function handleFormSaved(commissionId: number) {
    const data = await getCommissions();
    setCommissions(data);
    await loadTagsForCommissions(data);
    await loadCharactersForCommissions(data);

    setForm(null);
    setActiveCommissionId(commissionId);
    setViewMode("list");
  }

  async function handleDuplicateCommission() {
    if (!activeCommission) {
        return;
    }

    try {
        setDuplicatingCommission(true);

        const newCommissionId = await duplicateCommission(activeCommission.id);
        const data = await getCommissions();

        setCommissions(data);
        await loadTagsForCommissions(data);

        const duplicatedCommission =
        data.find((commission) => commission.id === newCommissionId) ?? null;

        if (duplicatedCommission) {

        setActiveCommissionId(duplicatedCommission.id);
        }

        showToast("Commission duplicated.", "success");
    } catch (error) {
        console.error(error);
        showToast("Could not duplicate commission.", "error");
    } finally {
        setDuplicatingCommission(false);
    }
    }

  async function handleDeleteCommission() {
    if (!activeCommission) {
        return;
    }

    try {
        setDeletingCommission(true);

        const trashId = await deleteCommission(activeCommission.id);

        const data = await getCommissions();

        setCommissions(data);
        await loadTagsForCommissions(data);


        setActiveCommissionId(null);
        undoToast(showToast, "Commission deleted.", trashId);

        setShowDeleteCommissionModal(false);
    } catch (error) {
        console.error(error);
        showToast("Could not delete commission.", "error");
    } finally {
        setDeletingCommission(false);
    }
    }

  /** Without `sources` opens the picker; with them, they come from drag and drop or Ctrl+V. */
  async function handleAddStageImages(stageId: number, sources?: (string | File)[]) {
    if (!activeCommission || importingStageId !== null) {
      return;
    }

    const items = sources ?? (await pickImagePaths());

    if (items.length === 0) {
      return;
    }

    setImportingStageId(stageId);

    try {
      for (const item of items) {
        const stored = await importImage(item);
        await createCommissionStageImage(activeCommission.id, stageId, stored.path);
      }
    } catch (error) {
      console.error("Could not upload stage image", error);
      showToast(t("Could not add image: {error}", { error: String(error) }), "error");
    } finally {
      setImportingStageId(null);
    }

    const data = await getCommissions();
    setCommissions(data);
    await loadStageImagesForCommissions(data);
  }

  const dragZoneId = useImageInput({
    onDrop: (zoneId, paths) => {
      const [kind, stageId] = zoneId.split(":");

      if (kind === "stage") {
        handleAddStageImages(Number(stageId), paths);
      }
    },
    // Ctrl+V adds the image to the open commission's current stage
    onPaste: (files) => {
      if (activeCommission && pasteStage) {
        handleAddStageImages(pasteStage.id, files);
      }
    },
  });

  /** A retouched version of this image: asks for the file and adds it as the next version of that alternative. */
  async function handleAddVersion(image: CommissionStageImage) {
    if (importingStageId !== null) {
      return;
    }

    const [source] = await pickImagePaths();

    if (!source) {
      return;
    }

    setImportingStageId(image.stage_id);

    try {
      const stored = await importImage(source);
      const newId = await createImageVersion(image.id, stored.path);
      // The focus view, if open, moves to the new version
      setFocusImageId((current) => (current === null ? null : newId));
    } catch (error) {
      console.error("Could not add version", error);
      showToast(t("Could not add image: {error}", { error: String(error) }), "error");
    } finally {
      setImportingStageId(null);
    }

    const data = await getCommissions();
    setCommissions(data);
    await loadStageImagesForCommissions(data);
  }

  async function toggleCorrectionDone(correction: CommissionCorrection) {
    await setCorrectionDone(correction.id, correction.done_at === null);
    setCorrections(await getAllCorrections());
  }

  function copyPendingCorrections(stageId: number) {
    const text = pendingCorrectionsText(activeCorrections.filter((correction) => correction.stage_id === stageId));

    if (!text) {
      showToast("Nothing pending to copy.", "error");
      return;
    }

    navigator.clipboard
      .writeText(text)
      .then(() => showToast("Corrections copied.", "success"))
      .catch(() => showToast("Could not copy it.", "error"));
  }

  async function removeCorrection(correction: CommissionCorrection) {
    const trashId = await deleteCorrection(correction.id);

    setCorrections(await getAllCorrections());
    undoToast(showToast, "Correction removed.", trashId);
  }

  async function handleDeleteStageImage(imageId: number) {
    await deleteCommissionStageImage(imageId);

    const data = await getCommissions();
    setCommissions(data);
    await loadStageImagesForCommissions(data);
  }

  /** What a stage shows: the current (latest) version of each alternative */
  function getStageImages(commissionId: number, stageId: number) {
    return groupAlternatives(
      (stageImagesByCommissionId[commissionId] ?? []).filter((image) => image.stage_id === stageId),
    ).map((group) => group.versions[group.versions.length - 1]);
  }

  /** All versions of the alternative this image belongs to, oldest first */
  function getVersions(image: CommissionStageImage) {
    return (stageImagesByCommissionId[image.commission_id] ?? [])
      .filter((other) => other.stage_id === image.stage_id && other.alt === image.alt)
      .sort((a, b) => a.version - b.version || a.id - b.id);
  }

  /** "v2", or "final" once the commission has moved past that stage */
  function versionLabel(image: CommissionStageImage, versions: CommissionStageImage[], done: boolean) {
    return done && image.id === versions[versions.length - 1].id ? t("final") : `v${image.version}`;
  }

  function getActiveStageImageIndex(stageId: number, images: CommissionStageImage[]) {
    const index = activeStageImageIndexByStageId[stageId] ?? 0;

    if (images.length === 0) {
      return 0;
    }

    return Math.min(index, images.length - 1);
  }

  const currentStageIndex = workflowStages.findIndex(
    (stage) => stage.id === activeCommission?.current_stage_id,
  );

  const isLastStage =
    workflowStages.length > 0 &&
    currentStageIndex === workflowStages.length - 1;

  // The last stage ("finished") only shows once the commission is marked as finished.
  // ponytail: a template with a single stage keeps it visible and works as before.
  const visibleStages = workflowStages.length > 1 && !isLastStage ? workflowStages.slice(0, -1) : workflowStages;
  const nextIsFinish = workflowStages.length > 1 && currentStageIndex === workflowStages.length - 2;

  // Inbox: those already in a stage, and queued ones not started yet; nearest delivery first
  const byDeadline = (a: Commission, b: Commission) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999");
  const inboxGroups = [
    {
      label: t("In progress"),
      items: filteredCommissions.filter((commission) => commission.current_stage_id !== null).sort(byDeadline),
    },
    {
      label: t("Queue"),
      items: filteredCommissions.filter((commission) => commission.current_stage_id === null).sort(byDeadline),
    },
  ];
  const inboxOrder = inboxGroups.flatMap((group) => group.items);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;

      if (
        viewMode !== "list" ||
        focusImageId !== null ||
        (event.key !== "ArrowDown" && event.key !== "ArrowUp") ||
        target.closest("input, textarea, select, [contenteditable]")
      ) {
        return;
      }

      event.preventDefault();
      const index = inboxOrder.findIndex((commission) => commission.id === activeCommissionId);
      const next = inboxOrder[index + (event.key === "ArrowDown" ? 1 : -1)] ?? (index === -1 ? inboxOrder[0] : null);

      if (next) {
        setActiveCommissionId(next.id);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const activeCorrections = activeCommission
    ? corrections.filter((correction) => correction.commission_id === activeCommission.id)
    : [];
  const revisionsIncluded =
    templates.find((template) => template.id === activeCommission?.template_id)?.revisions_included ?? null;
  const correctionsStage = workflowStages.find((stage) => stage.id === correctionsStageId) ?? null;

  const activeClient = clients.find((client) => client.id === activeCommission?.client_id) ?? null;

  function copyTag(handle: string) {
    // The toast doesn't repeat the handle, so it isn't visible on a stream in private mode
    navigator.clipboard
      .writeText(handle)
      .then(() => showToast("Tag copied.", "success"))
      .catch(() => showToast("Could not copy it.", "error"));
  }

  function copyInvoiceDescription() {
    const text = invoiceDescription(
      templates.find((template) => template.id === activeCommission?.template_id)?.name ?? null,
      activeCharacters.map((character) => character.name),
    );

    navigator.clipboard
      .writeText(text)
      .then(() => showToast("Description copied.", "success"))
      .catch(() => showToast("Could not copy it.", "error"));
  }

  const activeDeadlineStatus = activeCommission ? getDeadlineStatus(activeCommission.deadline) : null;
  const activeCharacters = activeCommission
    ? Object.values(charactersByClientId)
        .flat()
        .filter((character) => (commissionCharactersById[activeCommission.id] ?? []).includes(character.id))
    : [];

  const pasteStage = workflowStages[currentStageIndex] ?? workflowStages[0] ?? null;
  // Strip gap minus each stage's label and corrections button
  // The strip clips what sticks out of it, so each column keeps 4 px around its image for the current stage's ring (ring + offset = 4 px);
  // the image gives those 8 px back so the column keeps its height
  const stageImageHeight = Math.max(windowHeight - 580, 180);

  // Focus mode: all images from all stages, in order
  const focusImages = activeCommission
    ? visibleStages.flatMap((stage) =>
        getStageImages(activeCommission.id, stage.id).map((image) => ({ image, stage })),
      )
    : [];
  // focusImageId can be an older version: the item is the one whose alternative contains it
  const focusIndex = focusImages.findIndex((item) => getVersions(item.image).some((version) => version.id === focusImageId));


  // On opening a commission, the strip centers on the current stage
  useEffect(() => {
    document.getElementById("current-stage")?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [activeCommissionId, workflowStages]);

  // Open corrections belong to the previous commission
  useEffect(() => {
    setCorrectionsStageId(null);
  }, [activeCommissionId]);



  const activeCommissionTags = activeCommission
    ? commissionTagsById[activeCommission.id] ?? []
    : [];

  function isPaymentTag(tag: Tag) {
    return tag.category === "Payment";
  }

  // Old type tags stay in the database but aren't shown: the template is the type (chip with its colour)
  function getNormalTags(tags: Tag[]) {
    return tags.filter((tag) => !isPaymentTag(tag) && tag.category !== TYPE_CATEGORY);
  }

  function typeOf(commission: Commission) {
    return templates.find((template) => template.id === commission.template_id) ?? null;
  }

  function getCommissionCompletionPercentage(commission: Commission) {
    return getCommissionCompletionPercentageHelper(commission, templateStagesByTemplateId);
  }

  function isCommissionCompleted(commission: Commission) {
    return isCommissionCompletedHelper(commission, templateStagesByTemplateId);
  }

  const activeNormalTags = getNormalTags(activeCommissionTags);
  const activeType = activeCommission ? typeOf(activeCommission) : null;

  // Colores del fondo: la imagen en foco, la que tiene el cursor encima o la etapa más avanzada de la comisión abierta
  const focusItem = focusIndex >= 0 ? focusImages[focusIndex] : null;
  const focusShown = focusItem ? (getVersions(focusItem.image).find((version) => version.id === focusImageId) ?? focusItem.image) : null;
  useAmbientImage(
    focusShown?.image_data_url ??
      hoveredImagePath ??
      (viewMode === "list" ? focusImages[focusImages.length - 1]?.image.image_data_url : null),
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t("Commissions")}
        description={t("Organize your drawings by stages, clients, dates and tags.")}
        action={t("+ New commission")}
        onAction={openNewCommissionForm}
      />

      <div className="flex items-start gap-3 px-5 pt-5">
        <div className="min-w-0 flex-1">
          <BoardFilters
            tags={filterableTags}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            filterTagIds={filterTagIds}
            onFilterTagIdsChange={setFilterTagIds}
            filterStatus={filterStatus}
            onFilterStatusChange={setFilterStatus}
            filterPayment={filterPayment}
            onFilterPaymentChange={setFilterPayment}
          />
        </div>

        <Segmented
          options={[
            { value: "list", label: "List" },
            { value: "grid", label: "Grid" },
          ]}
          value={viewMode}
          onChange={setViewMode}
        />
      </div>

      <section
        className={`grid min-h-0 flex-1 gap-5 px-5 pb-6 ${
          viewMode === "list" ? "grid-cols-[280px_minmax(0,1fr)]" : "grid-cols-[minmax(0,1fr)_320px]"
        }`}
      >
        {viewMode === "list" && (
          <CommissionList
            ready={ready}
            noCommissions={commissions.length === 0}
            inboxGroups={inboxGroups}
            activeCommissionId={activeCommissionId}
            templateStagesByTemplateId={templateStagesByTemplateId}
            stageImagesByCommissionId={stageImagesByCommissionId}
            handleOpenCommission={handleOpenCommission}
          />
        )}


        <GlassPanel className="h-full min-h-0" contentClassName="flex flex-col p-5">
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {viewMode === "list" && !activeCommission ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <p className="text-lg font-black">{t("Pick a commission")}</p>
                <p className="mt-1 text-sm text-muted">{t("Choose one from the list, or use ↑ ↓ to move between them.")}</p>
              </div>
            ) : viewMode === "list" && activeCommission ? (
              <div className="flex h-full min-h-0 flex-col gap-5">
                {/* Header: everything important on one line */}
                <div className="flex items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-2xl font-black">{activeCommission.title}</h3>
                    <p className="mt-1 text-sm text-muted">
                      {[
                        hide(activeCommission.client_name || t("No client")),
                        activeCommission.platform,
                        templates.find((template) => template.id === activeCommission.template_id)?.name,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      {activeDeadlineStatus && (
                        <span className={`ml-2 rounded-sm px-2 py-0.5 text-xs font-bold ${activeDeadlineStatus.className}`}>
                          {activeDeadlineStatus.label}
                        </span>
                      )}
                    </p>

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(revisionsIncluded !== null || activeCorrections.length > 0) && (
                        <span
                          title={t("Each client correction counts as one revision")}
                          className={`rounded-sm px-2 py-0.5 text-xs font-bold ${
                            revisionsIncluded === null
                              ? "chip"
                              : activeCorrections.length > revisionsIncluded
                                ? "chip chip-bad"
                                : activeCorrections.length === revisionsIncluded
                                  ? "chip chip-warn"
                                  : "chip"
                          }`}
                        >
                          {t("Revisions")} {activeCorrections.length}
                          {revisionsIncluded !== null && ` / ${revisionsIncluded}`}
                          {revisionsIncluded !== null && activeCorrections.length > revisionsIncluded && ` · ${t("extra")}`}
                        </span>
                      )}
                      {activeClient?.tag_handle && (
                        <button
                          type="button"
                          title={t("Copy the account to tag when you post")}
                          onClick={() => copyTag(activeClient.tag_handle!)}
                          className="rounded-sm border border-line-strong px-2 py-0.5 text-xs font-bold text-muted transition hover:border-ink hover:text-ink"
                        >
                          {t("Tag")} {hide(activeClient.tag_handle)}
                          {activeClient.tag_platform && activeClient.tag_platform !== "Other" ? ` · ${activeClient.tag_platform}` : ""} ⧉
                        </button>
                      )}
                      {activeType && <TagChip name={activeType.name} color={activeType.color} />}
                      {activeNormalTags.map((tag) => (
                        <TagChip key={tag.id} name={tag.name} color={tag.color} />
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={handleOpenEditCommission}
                    className="rounded-md border border-line-strong px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-ink"
                  >
                    {t("Edit")}
                  </button>

                  <div className="relative">
                    <button
                      type="button"
                      title={t("More actions")}
                      onClick={() => setCommissionMenuOpen((open) => !open)}
                      className="rounded-md border border-line-strong px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-ink"
                    >
                      ···
                    </button>

                    {commissionMenuOpen && (
                      <>
                        <div className="fixed inset-0 z-30" onClick={() => setCommissionMenuOpen(false)} />
                        <div className="absolute right-0 top-full z-40 mt-1 w-40 rounded-md border border-line bg-surface p-1 shadow-lg">
                          <button
                            type="button"
                            disabled={duplicatingCommission}
                            onClick={() => {
                              setCommissionMenuOpen(false);
                              handleDuplicateCommission();
                            }}
                            className="block w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-highlight"
                          >
                            {duplicatingCommission ? t("Duplicating…") : t("Duplicate")}
                          </button>
                          <button
                            type="button"
                            title={t("Short text for the PayPal invoice")}
                            onClick={() => {
                              setCommissionMenuOpen(false);
                              copyInvoiceDescription();
                            }}
                            className="block w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-highlight"
                          >
                            {t("Copy description")}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setCommissionMenuOpen(false);
                              setShowDeleteCommissionModal(true);
                            }}
                            className="block w-full rounded-sm px-3 py-2 text-left text-sm text-tone-bad hover:bg-tone-bad/10"
                          >
                            {t("Delete")}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <CommissionPayments
                  commission={activeCommission}
                  payments={paymentsByCommissionId[activeCommission.id] ?? []}
                  onChange={loadPayments}
                />

                {workflowStages.length === 0 ? (
                  <p className="rounded-md border border-dashed border-line-strong p-6 text-center text-sm text-faint">
                    {t("This commission has no template, so it has no stages. Edit it to pick one.")}
                  </p>
                ) : (
                  <>
                    {/* Stage strip: same height for all, each image at its real aspect ratio */}
                    <div
                      onWheel={(event) => {
                        // The vertical wheel scrolls the strip horizontally
                        if (event.deltaY !== 0) event.currentTarget.scrollLeft += event.deltaY;
                      }}
                      className="flex min-h-48 flex-1 gap-4 overflow-x-auto"
                      style={{ minHeight: stageImageHeight + 72 }}
                    >
                      {visibleStages.map((stage, index) => {
                        const stageImages = getStageImages(activeCommission.id, stage.id);
                        const imageIndex = getActiveStageImageIndex(stage.id, stageImages);
                        const image = stageImages[imageIndex] ?? null;
                        const isDone = index < currentStageIndex;
                        const isCurrent = index === currentStageIndex;
                        const dropId = `stage:${stage.id}`;
                        const isDropTarget = dragZoneId === dropId;

                        return (
                          <div
                            key={stage.id}
                            id={isCurrent ? "current-stage" : undefined}
                            data-image-drop={dropId}
                            className="flex shrink-0 flex-col p-1"
                          >
                            {image ? (
                              <div
                                className={`group relative ${
                                  isDropTarget ? "opacity-60" : ""
                                }`}
                              >
                                <button
                                  type="button"
                                  title={t("Open in focus mode")}
                                  onClick={() => setFocusImageId(image.id)}
                                  onMouseEnter={() => setHoveredImagePath(image.image_data_url)}
                                  onMouseLeave={() => setHoveredImagePath(null)}
                                  className="block cursor-zoom-in"
                                >
                                  <img
                                    src={imageUrl(image.image_data_url)}
                                    alt={`${stage.name} · ${image.label}`}
                                    style={{ height: stageImageHeight }}
                                    className={`w-auto rounded-md object-contain ${
                                      isCurrent ? "ring-2 ring-ink ring-offset-2 ring-offset-surface" : ""
                                    }`}
                                  />
                                </button>

                                {(getVersions(image).length > 1 || isDone) && (
                                  <span className="absolute left-2 top-2 rounded-sm bg-black/60 px-1.5 py-0.5 text-xs font-bold text-white">
                                    {versionLabel(image, getVersions(image), isDone)}
                                  </span>
                                )}

                                {stageImages.length > 1 && (
                                  <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-sm bg-black/60 px-1.5 py-0.5 text-xs text-white">
                                    <button
                                      type="button"
                                      title={t("Previous alt")}
                                      onClick={() => setActiveStageImageIndexByStageId((current) => ({
                                        ...current,
                                        [stage.id]: (imageIndex - 1 + stageImages.length) % stageImages.length,
                                      }))}
                                      className="px-1 hover:text-white/70"
                                    >
                                      ‹
                                    </button>
                                    Alt {imageIndex + 1} of {stageImages.length}
                                    <button
                                      type="button"
                                      title={t("Next alt")}
                                      onClick={() => setActiveStageImageIndexByStageId((current) => ({
                                        ...current,
                                        [stage.id]: (imageIndex + 1) % stageImages.length,
                                      }))}
                                      className="px-1 hover:text-white/70"
                                    >
                                      ›
                                    </button>
                                  </span>
                                )}

                                <span className="absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
                                  <button
                                    type="button"
                                    title={t("Add an alt")}
                                    disabled={importingStageId !== null}
                                    onClick={() => handleAddStageImages(stage.id)}
                                    className="flex h-7 items-center justify-center rounded-sm bg-black/60 px-2 text-xs font-bold text-white hover:bg-black/80"
                                  >
                                    + Alt
                                  </button>
                                  <button
                                    type="button"
                                    title={t("New version of this image (retouched)")}
                                    disabled={importingStageId !== null}
                                    onClick={() => handleAddVersion(image)}
                                    className="flex h-7 items-center justify-center rounded-sm bg-black/60 px-2 text-xs font-bold text-white hover:bg-black/80"
                                  >
                                    + v
                                  </button>
                                  <button
                                    type="button"
                                    title={t("Remove this image")}
                                    onClick={() => handleDeleteStageImage(image.id)}
                                    className="flex h-7 w-7 items-center justify-center rounded-sm bg-black/60 text-white hover:bg-tone-bad/100"
                                  >
                                    ×
                                  </button>
                                </span>
                              </div>
                            ) : (
                              <button
                                type="button"
                                disabled={importingStageId !== null}
                                onClick={() => handleAddStageImages(stage.id)}
                                style={{ height: stageImageHeight, width: stageImageHeight * 0.75 }}
                                className={`flex shrink-0 flex-col items-center justify-center rounded-md border border-dashed text-center text-xs transition ${
                                  isDropTarget
                                    ? "border-ink bg-highlight text-ink"
                                    : "border-line-strong text-faint hover:border-ink hover:text-ink"
                                }`}
                              >
                                <span className="text-xl">+</span>
                                {importingStageId === stage.id ? t("Optimizing…") : isCurrent ? t("Drop or Ctrl+V") : t("Drop here")}
                              </button>
                            )}

                            <p className="mt-2 flex items-center gap-2 text-sm">
                              <span
                                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                                  isDone
                                    ? "bg-tone-ok text-on-tone"
                                    : isCurrent
                                      ? "bg-primary text-on-primary"
                                      : "border border-line-strong text-faint"
                                }`}
                              >
                                {isDone ? "✓" : index + 1}
                              </span>
                              <span className={isCurrent ? "font-black" : isDone ? "font-semibold" : "text-faint"}>
                                {stage.name}
                              </span>
                              {importingStageId === stage.id && image && (
                                <span className="text-xs text-faint">{t("Optimizing…")}</span>
                              )}
                            </p>

                            {(() => {
                              const stageCorrections = activeCorrections.filter((correction) => correction.stage_id === stage.id);
                              const count = stageCorrections.length;
                              const pending = stageCorrections.filter((correction) => correction.done_at === null).length;
                              const open = correctionsStageId === stage.id;

                              return (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCorrectionDraft("");
                                    setCorrectionsStageId(open ? null : stage.id);
                                  }}
                                  className={`mt-1 self-start rounded-sm px-1.5 py-0.5 text-xs transition ${
                                    pending > 0
                                      ? "bg-tone-warn/15 font-semibold text-ink"
                                      : open
                                        ? "text-ink"
                                        : "text-faint hover:text-ink"
                                  }`}
                                >
                                  {count > 0 ? t(count === 1 ? "{n} correction" : "{n} corrections", { n: count }) : t("+ correction")}
                                  {count > 0 && pending === 0 ? " ✓" : ""}
                                  {open ? " ▴" : count > 0 ? " ▾" : ""}
                                </button>
                              );
                            })()}
                          </div>
                        );
                      })}
                    </div>

                    {correctionsStage && (
                      <div className="shrink-0 rounded-md border border-line bg-paper p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-xs font-bold text-muted">
                            Corrections · {correctionsStage.name}
                          </p>
                          <button
                            type="button"
                            onClick={() => copyPendingCorrections(correctionsStage.id)}
                            className="text-xs text-faint transition hover:text-ink"
                          >
                            {t("Copy corrections")}
                          </button>
                        </div>

                        {activeCorrections
                          .filter((correction) => correction.stage_id === correctionsStage.id)
                          .map((correction) => {
                            const pinImage =
                              correction.image_id === null
                                ? null
                                : (stageImagesByCommissionId[activeCommission.id] ?? []).find((image) => image.id === correction.image_id);

                            return (
                              <div key={correction.id} className="group flex items-baseline gap-3 py-1 text-sm">
                                <input
                                  type="checkbox"
                                  checked={correction.done_at !== null}
                                  onChange={() => toggleCorrectionDone(correction)}
                                  title={correction.done_at === null ? t("Mark as done") : t("Mark as not done")}
                                  className="shrink-0 self-center"
                                />
                                <span className="w-14 shrink-0 text-xs text-faint">
                                  {new Date(correction.created_at).toLocaleDateString(locale, { day: "numeric", month: "short" })}
                                </span>
                                {pinImage && (
                                  <button
                                    type="button"
                                    title={t("Show on the image")}
                                    onClick={() => setFocusImageId(pinImage.id)}
                                    className="chip chip-warn shrink-0 self-center"
                                  >
                                    {pinNumber(activeCorrections, correction)}
                                    <span className="font-semibold">· v{pinImage.version}</span>
                                  </button>
                                )}
                                <span className={`flex-1 whitespace-pre-wrap ${correction.done_at !== null ? "text-faint line-through" : ""}`}>
                                  {correction.text}
                                </span>
                                <button
                                  type="button"
                                  title={t("Remove correction")}
                                  onClick={() => removeCorrection(correction)}
                                  className="text-faint opacity-0 transition hover:text-tone-bad group-hover:opacity-100"
                                >
                                  ×
                                </button>
                              </div>
                            );
                          })}

                        <input
                          autoFocus
                          value={correctionDraft}
                          onChange={(event) => setCorrectionDraft(event.target.value)}
                          onKeyDown={async (event) => {
                            if (event.key === "Escape") setCorrectionsStageId(null);
                            if (event.key !== "Enter" || !correctionDraft.trim()) return;

                            try {
                              await addCorrection(activeCommission.id, correctionsStage.id, correctionDraft);
                              setCorrectionDraft("");
                              setCorrections(await getAllCorrections());
                            } catch (error) {
                              showToast(error instanceof Error ? error.message : `${error}`, "error");
                            }
                          }}
                          placeholder={t("What did the client ask to change? Enter to add")}
                          className="mt-2 w-full rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm outline-none focus:border-ink"
                        />

                        {(() => {
                          const alternatives = getStageImages(activeCommission.id, correctionsStage.id);

                          return (
                            alternatives.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {alternatives.map((image) => (
                                  <button
                                    key={image.id}
                                    type="button"
                                    disabled={importingStageId !== null}
                                    onClick={() => handleAddVersion(image)}
                                    className="rounded-sm border border-line-strong px-2.5 py-1 text-xs font-semibold text-muted transition hover:border-ink hover:text-ink disabled:opacity-50"
                                  >
                                    {alternatives.length > 1
                                      ? t("Upload retouched version · {name}", { name: image.label })
                                      : t("Upload retouched version")}
                                  </button>
                                ))}
                              </div>
                            )
                          );
                        })()}
                      </div>
                    )}

                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        title={t("Back to the previous stage")}
                        onClick={() => handleMoveStage(-1)}
                        disabled={currentStageIndex <= 0}
                        className="rounded-md border border-line-strong px-3 py-1.5 text-sm text-muted transition hover:border-ink hover:text-ink disabled:opacity-30"
                      >
                        {t("‹ Back")}
                      </button>

                      {isLastStage ? (
                        <>
                          <span className="rounded-md bg-tone-ok px-4 py-1.5 text-sm font-bold text-on-tone">
                            {t("✓ Finished")}
                            {activeCommission.delivered_at && ` · ${new Date(`${activeCommission.delivered_at}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}`}
                            {activeCommission.hours !== null && ` · ${activeCommission.hours} h`}
                          </span>
                          <button
                            type="button"
                            title={t("Finish it again with a new delivery date")}
                            onClick={() => setShowFinishModal(true)}
                            className="rounded-md border border-line-strong px-3 py-1.5 text-sm text-muted transition hover:border-ink hover:text-ink"
                          >
                            {t("Edit delivery")}
                          </button>
                        </>
                      ) : nextIsFinish ? (
                        <button
                          type="button"
                          onClick={() => setShowFinishModal(true)}
                          className="rounded-md bg-primary px-4 py-1.5 text-sm font-bold text-on-primary transition hover:bg-primary-hover"
                        >
                          {t("Mark as finished")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleMoveStage(1)}
                          className="rounded-md bg-primary px-4 py-1.5 text-sm font-bold text-on-primary transition hover:bg-primary-hover"
                        >
                          {currentStageIndex < 0
                            ? t("Start {name}", { name: workflowStages[0].name })
                            : t("{name} done →", { name: workflowStages[currentStageIndex].name })}
                        </button>
                      )}

                      {pasteStage && (
                        <span className="ml-2 text-xs text-faint">
                          {t("Ctrl+V adds to")} <b className="text-ink">{pasteStage.name}</b>
                        </span>
                      )}
                    </div>
                  </>
                )}

                {(activeCommission.notes || activeCommission.final_notes || activeCharacters.length > 0) && (
                  <div className="grid shrink-0 grid-cols-2 gap-6 border-t border-line pt-4">
                    <div>
                      <p className="mb-1 text-xs font-bold text-muted">{t("Notes")}</p>
                      <p className="line-clamp-4 whitespace-pre-wrap text-sm text-muted">
                        {activeCommission.notes ? <Linkified text={activeCommission.notes} /> : t("No notes.")}
                      </p>
                      {isLastStage && activeCommission.final_notes && (
                        <>
                          <p className="mb-1 mt-3 text-xs font-bold text-muted">{t("Final notes")}</p>
                          <p className="line-clamp-4 whitespace-pre-wrap text-sm text-muted">
                            <Linkified text={activeCommission.final_notes} />
                          </p>
                        </>
                      )}
                    </div>

                    <div>
                      <p className="mb-1 text-xs font-bold text-muted">{t("Characters")}</p>
                      {activeCharacters.length === 0 ? (
                        <p className="text-sm text-faint">{t("No characters.")}</p>
                      ) : (
                        <div className="space-y-1.5">
                          {activeCharacters.map((character) => (
                            <div key={character.id} className="flex items-center gap-2">
                              <span className="w-24 shrink-0 truncate text-sm font-semibold">{character.name}</span>
                              <div className="flex flex-wrap gap-1">
                                {(referencesByCharacterId[character.id] ?? []).map((reference) => (
                                  <button
                                    key={reference.id}
                                    type="button"
                                    title={reference.label}
                                    onClick={() => setZoomedImage(imageUrl(reference.image_data_url))}
                                    className="cursor-zoom-in"
                                  >
                                    <img
                                      src={thumbUrl(reference.image_data_url)}
                                      loading="lazy" decoding="async"
                                      alt={reference.label}
                                      className="h-8 w-8 rounded-sm object-cover"
                                    />
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : commissions.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <div className="max-w-md text-center">
                  <h4 className="text-xl font-black">{t("No commissions yet")}</h4>
                  <p className="mt-2 text-sm leading-relaxed text-muted">
                    {t("Create a commission type first (Catalog), then your first commission.")}
                  </p>
                </div>
              </div>
            ) : filteredCommissions.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <div className="max-w-md text-center">
                  <h4 className="text-xl font-black">{t("No matches")}</h4>
                  <p className="mt-2 text-sm leading-relaxed text-muted">
                    {t("No commissions match your current search or filters.")}
                  </p>
                </div>
              </div>
            ) : (
              <CommissionGrid
                filteredCommissions={filteredCommissions}
                commissionTagsById={commissionTagsById}
                getNormalTags={getNormalTags}
                typeOf={typeOf}
                stageImagesByCommissionId={stageImagesByCommissionId}
                getCommissionCompletionPercentage={getCommissionCompletionPercentage}
                commissionCharactersById={commissionCharactersById}
                charactersByClientId={charactersByClientId}
                paymentsByCommissionId={paymentsByCommissionId}
                handleOpenCommission={handleOpenCommission}
                setZoomedImage={setZoomedImage}
              />
            )}
          </div>
        </GlassPanel>

        {viewMode === "grid" && (
        <DeadlineCalendar activeCommission={activeCommission} />
        )}
      </section>
      {form && (
        <CommissionForm
          mode={form.mode}
          commission={form.mode === "edit" ? activeCommission : null}
          initialTagIds={form.tagIds}
          linkedCharacterIds={form.mode === "edit" && activeCommission ? commissionCharactersById[activeCommission.id] ?? [] : []}
          templates={templates}
          clients={clients}
          charactersByClientId={charactersByClientId}
          allTags={allTags}
          onClose={() => setForm(null)}
          onSaved={handleFormSaved}
        />
      )}


      {showFinishModal && activeCommission && (
        <FinishCommissionModal
          title={activeCommission.title}
          hours={activeCommission.hours}
          notes={activeCommission.final_notes}
          isSaving={finishing}
          onConfirm={handleFinishCommission}
          onCancel={() => setShowFinishModal(false)}
        />
      )}

      {showDeleteCommissionModal && (
        <ConfirmModal
            eyebrow={t("Delete commission")}
            title={activeCommission?.title ?? ""}
            message={t("You can undo it right after with Ctrl+Z.")}
            confirmLabel={t("Delete")}
            confirmingLabel={t("Deleting...")}
            isConfirming={deletingCommission}
            onConfirm={handleDeleteCommission}
            onCancel={() => setShowDeleteCommissionModal(false)}
        />
        )}
      {focusIndex >= 0 && (
        <FocusViewer
          commissionId={activeCommission?.id ?? null}
          focusImages={focusImages}
          focusIndex={focusIndex}
          focusImageId={focusImageId}
          setFocusImageId={setFocusImageId}
          getVersions={getVersions}
          versionLabel={versionLabel}
          workflowStages={workflowStages}
          currentStageIndex={currentStageIndex}
          activeCorrections={activeCorrections}
          setCorrections={setCorrections}
          toggleCorrectionDone={toggleCorrectionDone}
          removeCorrection={removeCorrection}
          importingStageId={importingStageId}
          handleAddVersion={handleAddVersion}
        />
      )}

      {zoomedImage && (
        <div
          className="fixed inset-0 z-[999] flex items-center justify-center bg-black/80 backdrop-blur-md"
          onClick={() => setZoomedImage(null)}
        >
          <img
            src={zoomedImage}
            alt=""
            className="max-h-[90vh] max-w-[90vw] rounded-3xl shadow-2xl"
          />
        </div>
      )}
    </div>
  );
}

export default CommissionsPage;