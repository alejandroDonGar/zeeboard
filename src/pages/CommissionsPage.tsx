import { locale, t } from "../lib/i18n";
import { takeAction } from "../lib/actions";
import { useEffect, useState } from "react";
import { imageUrl, thumbUrl, importImage, pickImagePaths } from "../lib/images";
import { IPAD_IMAGE_ADDED } from "../lib/ipad";
import { useImageInput } from "../lib/useImageInput";
import { hide, isPrivate } from "../lib/privacy";
import { ageInDays, daysToDeadline } from "../lib/reminders";
import Linkified from "../components/Linkified";
import BoardFilters, { Segmented, type PaymentFilter } from "../components/BoardFilters";
import CommissionPayments from "../components/CommissionPayments";
import {
  loadStageImagesForCommissions as loadStageImagesForCommissionsHelper,
  getCommissionCompletionPercentage as getCommissionCompletionPercentageHelper,
  groupAlternatives,
  isCommissionCompleted as isCommissionCompletedHelper,
  getDeadlineStatus,
  formatMoney,
  parsePrice,
  paymentSummary,
  PAYMENT_STATUS_STYLE,
  calculateCommissionPrice,
  effectiveCharacterCount,
  pinNumber,
  pendingCorrectionsText,
  invoiceDescription,
} from "../lib/commissionHelpers";
import { autoTagIds } from "../lib/formImport";
import { TYPE_CATEGORY } from "../lib/catalog";
import {
  getTemplateStages,
  getTemplates,
  createCommission,
  getCommissions,
  getAllPayments,
  appSettings,
  getAllCorrections,
  addCorrection,
  deleteCorrection,
  setCorrectionDone,
  updateCommissionStage,
  finishCommission,
  updateCommission,
  duplicateCommission,
  deleteCommission,
  getCommissionTags,
  replaceCommissionTags,
  getClients,
  createCommissionStageImage,
  createImageVersion,
  deleteCommissionStageImage,
  getClientCharacters,
  getCharacterReferences,
  getCommissionCharacterIds,
  replaceCommissionCharacters,
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
import DialogBehavior from "../components/DialogBehavior";
import AmbientBackground from "../components/AmbientBackground";
import { useAmbientImage } from "../lib/ambient";
import ConfirmModal from "../components/ConfirmModal";
import { useToast } from "../context/ToastContext";
import { undoToast } from "../lib/undo";
import FinishCommissionModal, { type FinishDetails } from "../components/FinishCommissionModal";

function CommissionsPage() {
  // A single form to create and edit: null = closed
  const [formMode, setFormMode] = useState<"new" | "edit" | null>(null);
  const [characterSearch, setCharacterSearch] = useState("");
  const [commissionTitle, setCommissionTitle] = useState("");
  const [commissionPrice, setCommissionPrice] = useState("");
  const [commissionDeadline, setCommissionDeadline] = useState("");
  const [commissionNotes, setCommissionNotes] = useState("");
  const [clientName, setClientName] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [charactersByClientId, setCharactersByClientId] = useState<Record<number, ClientCharacter[]>>({});
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<number[]>([]);
  // What the price is for. Follows the linked characters until set by hand or loaded from a saved commission.
  const [characterCount, setCharacterCount] = useState(1);
  const [countIsFixed, setCountIsFixed] = useState(false);
  const [commissionCharactersById, setCommissionCharactersById] = useState<Record<number, number[]>>({});
  const [referencesByCharacterId, setReferencesByCharacterId] = useState<Record<number, CharacterReference[]>>({});
  const [platform, setPlatform] = useState("Discord");
  const [currency, setCurrency] = useState("EUR");
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [ready, setReady] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [activeCommissionId, setActiveCommissionId] = useState<number | null>(null);
  const [workflowStages, setWorkflowStages] = useState<TemplateStage[]>([]);
  const [templateStagesByTemplateId, setTemplateStagesByTemplateId] = useState<Record<number, TemplateStage[]>>({});
  const activeCommission = commissions.find((commission) => commission.id === activeCommissionId) ?? null;
  const [savingCommission, setSavingCommission] = useState(false);
  const [duplicatingCommission, setDuplicatingCommission] = useState(false);
  const [showDeleteCommissionModal, setShowDeleteCommissionModal] = useState(false);
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [deletingCommission, setDeletingCommission] = useState(false);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
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
  // Correction pins in focus mode: placing mode, the pin being written, the pin whose text is open
  const [pinMode, setPinMode] = useState(false);
  const [pinDraft, setPinDraft] = useState<{ x: number; y: number; text: string } | null>(null);
  const [openPinId, setOpenPinId] = useState<number | null>(null);
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

  function openNewCommissionForm() {
    setCommissionTitle("");
    setSelectedClientId(null);
    setClientName("");
    setPlatform("Discord");
    setSelectedTemplateId(null);
    setCommissionPrice("");
    setCurrency(appSettings().default_currency);
    setCommissionDeadline("");
    setCommissionNotes("");
    setSelectedCharacterIds([]);
    setCharacterCount(1);
    setCountIsFixed(false);
    setSelectedTagIds([]);
    setCharacterSearch("");
    setFormMode("new");
  }

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

  function handleOpenCommission(commission: Commission) {
    setActiveCommissionId(commission.id);
    setViewMode("list");
  }

  /** Automatic price: called by template and character changes, never when opening a form */
  function applyAutoPrice(templateId: number | null, characterCount: number) {
    const basePrice = templates.find((template) => template.id === templateId)?.base_price;

    if (basePrice != null) {
      setCommissionPrice(
        String(calculateCommissionPrice(basePrice, characterCount, appSettings().extra_character_rate)).replace(".", ","),
      );
    }
  }

  /** On create: sets the character tag automatically and drops old type tags (the template is the type now; others are kept) */
  function applyAutoTags(characterCount: number) {
    if (formMode !== "new") {
      return;
    }

    const auto = autoTagIds(characterCount, allTags);
    const own = (id: number) => [TYPE_CATEGORY, "Characters"].includes(allTags.find((tag) => tag.id === id)?.category ?? "");

    setSelectedTagIds((current) => [...current.filter((id) => !own(id)), ...auto]);
  }

  /** Linking or unlinking characters: the count only goes up once it is fixed, else it follows them */
  function changeLinkedCharacters(nextIds: number[]) {
    const count = effectiveCharacterCount(countIsFixed ? characterCount : 0, nextIds.length);

    setSelectedCharacterIds(nextIds);
    setCharacterCount(count);
    applyAutoPrice(selectedTemplateId, count);
    applyAutoTags(count);
  }

  function changeCharacterCount(value: number) {
    const count = effectiveCharacterCount(value, selectedCharacterIds.length);

    setCharacterCount(count);
    setCountIsFixed(true);
    applyAutoPrice(selectedTemplateId, count);
    applyAutoTags(count);
  }

  const formTemplate = templates.find((template) => template.id === selectedTemplateId) ?? null;
  const extraCharacters = characterCount - 1;
  // Chips: the chosen client's characters, plus those of other clients already chosen
  const formCharacterOptions = Object.values(charactersByClientId)
    .flat()
    .filter((character) => character.client_id === selectedClientId || selectedCharacterIds.includes(character.id));
  const allCharacterOptions = Object.values(charactersByClientId)
    .flat()
    .map((character) => ({
      id: character.id,
      label: `${character.name} (${hide(clients.find((client) => client.id === character.client_id)?.name ?? "?")})`,
    }));
  const formLabel = "mb-1.5 block text-xs font-bold text-muted";
  const formField =
    "rounded-md border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-ink";

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

    setCommissionTitle(activeCommission.title);
    setClientName(activeCommission.client_name || "");
    setSelectedClientId(activeCommission.client_id);
    setPlatform(activeCommission.platform || "Discord");
    setSelectedTemplateId(activeCommission.template_id);
    setCommissionPrice(activeCommission.price !== null ? String(activeCommission.price).replace(".", ",") : "");
    setCurrency(activeCommission.currency || "EUR");
    setCommissionDeadline(activeCommission.deadline || "");
    setCommissionNotes(activeCommission.notes || "");
    const linked = commissionCharactersById[activeCommission.id] ?? [];
    setSelectedCharacterIds(linked);
    setCharacterCount(effectiveCharacterCount(activeCommission.character_count ?? 1, linked.length));
    setCountIsFixed(true);
    setSelectedTagIds((await getCommissionTags(activeCommission.id)).map((tag) => tag.id));
    setCharacterSearch("");
    setFormMode("edit");
  }

  /** Saves the form: creates or updates, and in both cases saves tags and characters */
  async function handleSaveCommissionForm() {
    try {
      setSavingCommission(true);

      const selectedClient = clients.find((client) => client.id === selectedClientId) ?? null;
      const fields = [
        commissionTitle,
        selectedClientId,
        selectedClient?.name || clientName,
        selectedClient?.platform || platform,
      ] as const;
      const price = parsePrice(commissionPrice);
      const deadline = commissionDeadline || null;

      let commissionId: number;

      if (formMode === "edit" && activeCommission) {
        commissionId = activeCommission.id;
        await updateCommission(commissionId, ...fields, price, currency, deadline, commissionNotes, characterCount);
      } else {
        commissionId = await createCommission(
          ...fields,
          selectedTemplateId,
          price,
          currency,
          deadline,
          commissionNotes,
          characterCount,
        );
      }

      await replaceCommissionTags(commissionId, selectedTagIds);
      await replaceCommissionCharacters(commissionId, selectedCharacterIds);

      const data = await getCommissions();
      setCommissions(data);
      await loadTagsForCommissions(data);
      await loadCharactersForCommissions(data);

      showToast(formMode === "edit" ? "Commission saved." : "Commission created.", "success");
      setFormMode(null);
      setActiveCommissionId(commissionId);
      setViewMode("list");
    } catch (error) {
      console.error(error);
      showToast(error instanceof Error ? error.message : t("Commission error: {error}", { error: String(error) }), "error");
    } finally {
      setSavingCommission(false);
    }
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
    setOpenPinId(null);
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
    setOpenPinId(null);
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

  useEffect(() => {
    if (focusIndex < 0) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        // First Esc leaves the pin tools; the next one closes the view
        if (pinMode || pinDraft || openPinId !== null) {
          setPinMode(false);
          setPinDraft(null);
          setOpenPinId(null);
        } else {
          setFocusImageId(null);
        }
        return;
      }

      // Arrows move the text cursor while writing a pin
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === "ArrowRight") setFocusImageId(focusImages[(focusIndex + 1) % focusImages.length].image.id);
      if (event.key === "ArrowLeft")
        setFocusImageId(focusImages[(focusIndex - 1 + focusImages.length) % focusImages.length].image.id);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  // Another image, or leaving focus mode: nothing of the pin tools stays open
  useEffect(() => {
    setPinDraft(null);
    setOpenPinId(null);
  }, [focusImageId]);

  useEffect(() => {
    if (focusIndex < 0) setPinMode(false);
  }, [focusIndex]);

  // On opening a commission, the strip centers on the current stage
  useEffect(() => {
    document.getElementById("current-stage")?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [activeCommissionId, workflowStages]);

  // Open corrections belong to the previous commission
  useEffect(() => {
    setCorrectionsStageId(null);
  }, [activeCommissionId]);


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
          <GlassPanel as="nav" className="min-h-0" contentClassName="overflow-y-auto p-3">
            {!ready ? null : inboxGroups.every((group) => group.items.length === 0) ? (
              <p className="p-4 text-center text-sm text-faint">
                {commissions.length === 0 ? t("No commissions yet") : t("No matches")}
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
            )}
          </div>
        </GlassPanel>

        {viewMode === "grid" && (
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
        )}
      </section>
      {formMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-label={formMode === "new" ? t("New commission") : t("Edit commission")} className="grid max-h-[90vh] w-[900px] max-w-[94vw] grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] overflow-hidden glass-heavy rounded-3xl">
            <DialogBehavior onClose={() => setFormMode(null)} />
            {/* Left: pick */}
            <div className="min-h-0 space-y-5 overflow-y-auto p-6">
              <input
                autoFocus
                value={commissionTitle}
                onChange={(event) => setCommissionTitle(event.target.value)}
                placeholder={t("Commission title")}
                className="w-full rounded-md border border-transparent bg-transparent px-1 text-2xl font-black outline-none hover:border-line focus:border-ink"
              />

              <div>
                <p className={formLabel}>{t("Client")}</p>
                <div className="flex gap-2">
                  <input
                    list={isPrivate() ? undefined : "client-options"}
                    data-private
                    value={clientName}
                    onChange={(event) => {
                      const name = event.target.value;
                      const match = clients.find((client) => client.name === name);
                      setClientName(name);
                      setSelectedClientId(match?.id ?? null);
                      if (match?.platform) setPlatform(match.platform);
                    }}
                    placeholder={t("Search or type a name")}
                    className={`${formField} flex-1`}
                  />
                  <datalist id="client-options">
                    {clients.map((client) => (
                      <option key={client.id} value={client.name}>
                        {client.handle ?? client.platform ?? ""}
                      </option>
                    ))}
                  </datalist>

                  {/* The platform comes from the client; pick it by hand only for someone not saved */}
                  {!selectedClientId && (
                    <select value={platform} onChange={(event) => setPlatform(event.target.value)} className={formField}>
                      <option>Discord</option>
                      <option>Twitter / X</option>
                      <option>Bluesky</option>
                      <option>Telegram</option>
                      <option>Email</option>
                      <option>Other</option>
                    </select>
                  )}
                </div>
              </div>

              <div>
                <p className={formLabel}>
                  {t("Characters")}
                  <input
                    type="number"
                    min={1}
                    value={characterCount}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (value >= 1) changeCharacterCount(value);
                    }}
                    title={t("How many characters the commission has; the price depends on it")}
                    className="ml-3 w-14 rounded-sm border border-line-strong bg-surface px-1.5 py-0.5 text-center text-sm normal-case tracking-normal text-ink outline-none focus:border-ink"
                  />
                  <span className="ml-2 normal-case tracking-normal text-faint">
                    {t("the price depends on this number")}
                  </span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {formCharacterOptions.map((character) => {
                    const selected = selectedCharacterIds.includes(character.id);

                    return (
                      <button
                        key={character.id}
                        type="button"
                        onClick={() => {
                          changeLinkedCharacters(
                            selected
                              ? selectedCharacterIds.filter((id) => id !== character.id)
                              : [...selectedCharacterIds, character.id],
                          );
                        }}
                        className={
                          selected
                            ? "rounded-sm bg-primary px-2.5 py-1 text-sm font-bold text-on-primary"
                            : "rounded-sm border border-line-strong px-2.5 py-1 text-sm text-muted hover:border-ink hover:text-ink"
                        }
                      >
                        {character.name}
                        {character.client_id !== selectedClientId && (
                          <span className="ml-1 text-xs opacity-70">
                            · {hide(clients.find((client) => client.id === character.client_id)?.name ?? "")}
                          </span>
                        )}
                      </button>
                    );
                  })}

                  {/* Characters from any client: collaborations, friends' characters… */}
                  <input
                    list={isPrivate() ? undefined : "character-options"}
                    value={characterSearch}
                    onChange={(event) => {
                      const option = allCharacterOptions.find((item) => item.label === event.target.value);

                      if (option) {
                        changeLinkedCharacters(
                          selectedCharacterIds.includes(option.id) ? selectedCharacterIds : [...selectedCharacterIds, option.id],
                        );
                        setCharacterSearch("");
                      } else {
                        setCharacterSearch(event.target.value);
                      }
                    }}
                    placeholder={t("+ from another client")}
                    className="w-52 rounded-sm border border-dashed border-line-strong bg-transparent px-2 py-1 text-sm outline-none focus:border-ink"
                  />
                  <datalist id="character-options">
                    {allCharacterOptions.map((option) => (
                      <option key={option.id} value={option.label} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div>
                <p className={formLabel}>
                  Type
                  {formMode === "edit" && (
                    <span className="ml-2 normal-case tracking-normal text-faint">
                      {t("· can't change after creating (stages and images depend on it)")}
                    </span>
                  )}
                </p>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
                  {templates.map((template) => {
                    const selected = template.id === selectedTemplateId;

                    return (
                      <button
                        key={template.id}
                        type="button"
                        disabled={formMode === "edit"}
                        onClick={() => {
                          setSelectedTemplateId(template.id);
                          applyAutoPrice(template.id, characterCount);
                          applyAutoTags(characterCount);
                        }}
                        className={`rounded-md border px-3 py-2 text-left transition disabled:cursor-default ${
                          selected
                            ? "border-ink bg-paper ring-1 ring-ink"
                            : "border-line hover:border-line-strong disabled:opacity-40"
                        }`}
                      >
                        <span className="block truncate text-sm font-bold">{template.name}</span>
                        <span className="text-xs text-faint">
                          {template.base_price != null ? formatMoney(template.base_price) : t("No base price")}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className={formLabel}>{t("Tags")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {allTags.filter((tag) => tag.category !== TYPE_CATEGORY).map((tag) => {
                    const selected = selectedTagIds.includes(tag.id);

                    return (
                      <TagChip
                        key={tag.id}
                        name={tag.name}
                        color={tag.color}
                        selected={selected}
                        onClick={() =>
                          setSelectedTagIds((current) => {
                            if (selected) {
                              return current.filter((id) => id !== tag.id);
                            }

                            // Only one "Characters" tag at a time
                            const sameCategory =
                              tag.category === "Characters"
                                ? allTags.filter((other) => other.category === tag.category).map((other) => other.id)
                                : [];

                            return [...current.filter((id) => !sameCategory.includes(id)), tag.id];
                          })
                        }
                      />
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right: live summary, price, delivery and notes */}
            <div className="flex min-h-0 flex-col gap-4 overflow-y-auto border-l border-line bg-paper p-6">
              <div>
                <p className={formLabel}>{t("Summary")}</p>
                <p className="truncate text-lg font-black">{commissionTitle.trim() || "Untitled commission"}</p>
                <p className="text-sm text-muted">
                  {[clientName.trim() || t("No client"), platform, formTemplate?.name].filter(Boolean).join(" · ")}
                </p>
              </div>

              <div className="space-y-1 border-y border-line py-3 text-sm">
                {formTemplate?.base_price != null && (
                  <>
                    <p className="flex justify-between">
                      <span>{formTemplate.name}</span>
                      <span>{formatMoney(formTemplate.base_price, currency)}</span>
                    </p>
                    {extraCharacters > 0 && (
                      <p className="flex justify-between text-muted">
                        <span>
                          + {extraCharacters} extra character{extraCharacters === 1 ? "" : "s"} ({Math.round(appSettings().extra_character_rate * 100)}% each)
                        </span>
                        <span>
                          {formatMoney(
                            calculateCommissionPrice(
                              formTemplate.base_price,
                              characterCount,
                              appSettings().extra_character_rate,
                            ) -
                              formTemplate.base_price,
                            currency,
                          )}
                        </span>
                      </p>
                    )}
                  </>
                )}

                <div className="flex items-center justify-between gap-2 pt-1 font-black">
                  <span>{t("Price")}</span>
                  <span className="flex items-center gap-1">
                    <input
                      value={commissionPrice}
                      onChange={(event) => setCommissionPrice(event.target.value)}
                      placeholder="0"
                      inputMode="decimal"
                      data-private
                      title={t("Calculated from the type and characters; you can change it")}
                      className="w-24 rounded-md border border-line-strong bg-surface px-2 py-1 text-right font-black outline-none focus:border-ink"
                    />
                    <select
                      value={currency}
                      onChange={(event) => setCurrency(event.target.value)}
                      className="rounded-md border border-line-strong bg-surface px-1 py-1 text-sm font-semibold"
                    >
                      <option>EUR</option>
                      <option>USD</option>
                      <option>GBP</option>
                    </select>
                  </span>
                </div>
              </div>

              <label className="block">
                <span className={formLabel}>{t("Deadline · optional")}</span>
                <input
                  type="date"
                  value={commissionDeadline}
                  onChange={(event) => setCommissionDeadline(event.target.value)}
                  className={`${formField} w-full`}
                />
              </label>

              <label className="flex min-h-24 flex-1 flex-col">
                <span className={formLabel}>{t("Notes")}</span>
                <textarea
                  value={commissionNotes}
                  onChange={(event) => setCommissionNotes(event.target.value)}
                  placeholder={t("Background, pose, details to remember…")}
                  className={`${formField} w-full flex-1 resize-none`}
                />
              </label>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setFormMode(null)}
                  className="rounded-md px-4 py-2 text-sm font-semibold text-muted hover:text-ink"
                >
                  {t("Cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleSaveCommissionForm}
                  disabled={savingCommission || !commissionTitle.trim()}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-bold text-on-primary transition hover:bg-primary-hover disabled:opacity-50"
                >
                  {savingCommission ? t("Saving…") : formMode === "new" ? t("Create commission") : t("Save changes")}
                </button>
              </div>
            </div>
          </div>
        </div>
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
        <div
          role="dialog" aria-modal="true" aria-label={t("Open in focus mode")}
          className="fixed inset-0 z-[999] flex flex-col items-center justify-center overflow-hidden bg-[#0e0e10]"
          onClick={() => setFocusImageId(null)}
        >
          <AmbientBackground strong />
          {(() => {
            const { image: current, stage } = focusImages[focusIndex];
            const versions = getVersions(current);
            const shown = versions.find((version) => version.id === focusImageId) ?? current;
            const done = workflowStages.findIndex((item) => item.id === stage.id) < currentStageIndex;
            const pins = activeCorrections.filter((correction) => correction.image_id === shown.id && correction.x !== null && correction.y !== null);
            // Pending pins from earlier versions of this alternative show faded on the new one
            const earlier = versions.filter((version) => version.version < shown.version);
            const ghosts = activeCorrections.filter(
              (correction) =>
                correction.done_at === null &&
                correction.x !== null &&
                correction.y !== null &&
                earlier.some((version) => version.id === correction.image_id),
            );
            const openPin = [...pins, ...ghosts].find((correction) => correction.id === openPinId) ?? null;
            // Keeps the text box inside the image when a pin sits near an edge
            const boxLeft = (x: number) => `${Math.min(Math.max(x, 0.15), 0.85) * 100}%`;

            return (
              <>
                <div
                  className={`relative ${pinMode ? "cursor-crosshair" : ""}`}
                  onClick={(event) => {
                    if (!pinMode) return;

                    event.stopPropagation();
                    const box = event.currentTarget.getBoundingClientRect();
                    setOpenPinId(null);
                    setPinDraft({ x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height, text: "" });
                  }}
                >
                  <img
                    src={imageUrl(shown.image_data_url)}
                    alt=""
                    className="block max-h-[88vh] max-w-[94vw] object-contain"
                  />

                  {ghosts.map((correction) => (
                    <button
                      key={correction.id}
                      type="button"
                      title={correction.text}
                      onClick={(event) => {
                        event.stopPropagation();
                        setPinDraft(null);
                        setOpenPinId(openPinId === correction.id ? null : correction.id);
                      }}
                      style={{ left: `${(correction.x ?? 0) * 100}%`, top: `${(correction.y ?? 0) * 100}%` }}
                      className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-dashed border-white bg-amber-400/50 text-xs font-black text-black"
                    >
                      {pinNumber(activeCorrections, correction)}
                    </button>
                  ))}

                  {pins.map((correction) => (
                    <button
                      key={correction.id}
                      type="button"
                      title={correction.text}
                      onClick={(event) => {
                        event.stopPropagation();
                        setPinDraft(null);
                        setOpenPinId(openPinId === correction.id ? null : correction.id);
                      }}
                      style={{ left: `${(correction.x ?? 0) * 100}%`, top: `${(correction.y ?? 0) * 100}%` }}
                      className={`absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-xs font-black shadow-lg ring-2 ring-white ${
                        correction.done_at === null ? "bg-amber-400 text-black" : "bg-green-500 text-white"
                      }`}
                    >
                      {correction.done_at === null ? pinNumber(activeCorrections, correction) : "✓"}
                    </button>
                  ))}

                  {openPin && (
                    <div
                      onClick={(event) => event.stopPropagation()}
                      style={{ left: boxLeft(openPin.x ?? 0), top: `${(openPin.y ?? 0) * 100}%` }}
                      className="absolute z-10 mt-4 w-60 -translate-x-1/2 rounded-md bg-surface p-2.5 text-sm text-ink shadow-2xl"
                    >
                      {openPin.image_id !== shown.id && (
                        <p className="mb-1 text-xs text-faint">
                          {t("From v{n}", { n: versions.find((version) => version.id === openPin.image_id)?.version ?? "" })}
                        </p>
                      )}
                      <p className="whitespace-pre-wrap">{openPin.text}</p>
                      <div className="mt-1.5 flex gap-3 text-xs">
                        <button type="button" onClick={() => toggleCorrectionDone(openPin)} className="font-semibold hover:underline">
                          {openPin.done_at === null ? t("Mark as done") : t("Mark as not done")}
                        </button>
                        <button type="button" onClick={() => removeCorrection(openPin)} className="text-faint hover:text-tone-bad">
                          {t("Remove correction")}
                        </button>
                      </div>
                    </div>
                  )}

                  {pinDraft && (
                    <>
                      <span
                        style={{ left: `${pinDraft.x * 100}%`, top: `${pinDraft.y * 100}%` }}
                        className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-amber-400/70 text-xs font-black text-black ring-2 ring-white"
                      >
                        {activeCorrections.filter((correction) => correction.image_id === shown.id).length + 1}
                      </span>
                      <input
                        autoFocus
                        value={pinDraft.text}
                        onChange={(event) => setPinDraft({ ...pinDraft, text: event.target.value })}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={async (event) => {
                          if (event.key !== "Enter" || !pinDraft.text.trim() || !activeCommission) return;

                          try {
                            await addCorrection(activeCommission.id, stage.id, pinDraft.text, { imageId: shown.id, x: pinDraft.x, y: pinDraft.y });
                            setPinDraft(null);
                            setCorrections(await getAllCorrections());
                          } catch (error) {
                            showToast(error instanceof Error ? error.message : `${error}`, "error");
                          }
                        }}
                        placeholder={t("What should change here? Enter to add")}
                        style={{ left: boxLeft(pinDraft.x), top: `${pinDraft.y * 100}%` }}
                        className="absolute z-10 mt-4 w-64 -translate-x-1/2 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink shadow-2xl outline-none focus:border-ink"
                      />
                    </>
                  )}
                </div>
                <div className="mt-3 flex items-center gap-3 text-sm text-white/80" onClick={(event) => event.stopPropagation()}>
                  <span>
                    {stage.name} · {shown.label}
                  </span>
                  {versions.length > 1 &&
                    versions.map((version) => (
                      <button
                        key={version.id}
                        type="button"
                        onClick={() => setFocusImageId(version.id)}
                        className={`rounded-sm px-2 py-0.5 text-xs font-bold ${
                          version.id === shown.id ? "bg-white text-black" : "bg-white/20 text-white hover:bg-white/30"
                        }`}
                      >
                        {versionLabel(version, versions, done)}
                      </button>
                    ))}
                  <button
                    type="button"
                    onClick={() => {
                      setPinMode(!pinMode);
                      setPinDraft(null);
                      setOpenPinId(null);
                    }}
                    className={`rounded-sm px-2 py-0.5 text-xs font-bold ${
                      pinMode ? "bg-amber-400 text-black" : "bg-white/20 text-white hover:bg-white/30"
                    }`}
                  >
                    {pinMode ? t("Click the image to add a correction") : t("+ Correction pin")}
                  </button>
                  <button
                    type="button"
                    disabled={importingStageId !== null}
                    onClick={() => handleAddVersion(shown)}
                    className="rounded-sm bg-white/20 px-2 py-0.5 text-xs font-bold text-white hover:bg-white/30 disabled:opacity-50"
                  >
                    {t("+ New version")}
                  </button>
                  <span className="text-white/50">
                    {focusIndex + 1} / {focusImages.length} · ← → to move · Esc to close
                  </span>
                </div>
              </>
            );
          })()}
        </div>
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