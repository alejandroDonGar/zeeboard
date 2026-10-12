import { t } from "../lib/i18n";
import { takeAction } from "../lib/actions";
import { useEffect, useState } from "react";
import { hide, isPrivate } from "../lib/privacy";
import { parseTagAccount } from "../lib/formImport";
import { fetchAvatar } from "../lib/avatars";
import { avatarSrc, imageUrl, thumbUrl, importImage, pickImagePaths } from "../lib/images";
import { useImageInput } from "../lib/useImageInput";
import {
  loadStageImagesForCommissions as loadStageImagesForCommissionsHelper,
  getCommissionCompletionPercentage as getCommissionCompletionPercentageHelper,
  isCommissionCompleted as isCommissionCompletedHelper,
  formatMoney,
  paymentSummary,
} from "../lib/commissionHelpers";
import {
  getTemplateStages,
  getCommissions,
  getAllPayments,
  getClients,
  createClient,
  deleteClient,
  updateClient,
  updateClientAvatar,
  setClientTag,
  saveClientEmail,
  getClientCharacters,
  createClientCharacter,
  updateClientCharacter,
  deleteClientCharacter,
  getCharacterReferences,
  createCharacterReference,
  deleteCharacterReference,
  getCommissionCharacterIds,
  type ClientCharacter,
  type CharacterReference,
  type CommissionStageImage,
  type Client,
  type Commission,
  type CommissionPayment,
  type TemplateStage,
} from "../lib/database";
import PageHeader from "../components/PageHeader";
import ConfirmModal from "../components/ConfirmModal";
import { useToast } from "../context/ToastContext";
import { undoToast } from "../lib/undo";

function ClientsPage({
  onOpenCommissionsPage,
}: {
  onOpenCommissionsPage: () => void;
}) {
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsReady, setClientsReady] = useState(false);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [payments, setPayments] = useState<CommissionPayment[]>([]);
  const [clientName, setClientName] = useState("");
  const [clientPlatform, setClientPlatform] = useState("Twitter / X");
  const [clientHandle, setClientHandle] = useState("");
  const [clientNotes, setClientNotes] = useState("");
  // The account tagged when posting, as you'd type it: "Bluesky @name"
  const [tagText, setTagText] = useState("");
  const [clientEmail, setClientEmailText] = useState("");
  const [fetchingAvatar, setFetchingAvatar] = useState(false);
  // null = closed, "new" = create, Client = edit
  const [clientForm, setClientForm] = useState<Client | "new" | null>(null);
  const [clientSearch, setClientSearch] = useState("");
  const [clientToDelete, setClientToDelete] = useState<Client | null>(null);
  const [savingClient, setSavingClient] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [importingCharacterId, setImportingCharacterId] = useState<number | null>(null);
  const [stageImagesByCommissionId, setStageImagesByCommissionId] = useState<Record<number, CommissionStageImage[]>>({});
  const [templateStagesByTemplateId, setTemplateStagesByTemplateId] = useState<Record<number, TemplateStage[]>>({});
  const [charactersByClientId, setCharactersByClientId] = useState<Record<number, ClientCharacter[]>>({});
  const [referencesByCharacterId, setReferencesByCharacterId] = useState<Record<number, CharacterReference[]>>({});
  const [commissionCharactersById, setCommissionCharactersById] = useState<Record<number, number[]>>({});
  const [expandedCharacterId, setExpandedCharacterId] = useState<number | null>(null);
  const [newCharacterName, setNewCharacterName] = useState("");
  const [addingCharacter, setAddingCharacter] = useState(false);
  const [editingCharacter, setEditingCharacter] = useState(false);
  const [editCharacterName, setEditCharacterName] = useState("");
  const [editCharacterNotes, setEditCharacterNotes] = useState("");
  const [characterToDelete, setCharacterToDelete] = useState<ClientCharacter | null>(null);
  const { showToast } = useToast();

  async function loadClients() {
    const data = await getClients();
    setClients(data);
    return data;
  }

  const selectedClient = clients.find((client) => client.id === selectedClientId) ?? null;

  function closeClientForm() {
    setClientForm(null);
    setClientName("");
    setClientPlatform("Twitter / X");
    setClientHandle("");
    setClientNotes("");
    setTagText("");
    setClientEmailText("");
  }

  /** Saves the form's tag account; empty or "none" removes it. */
  async function saveTag(clientId: number) {
    const tag = parseTagAccount(tagText, { platform: "Other", handle: "" });
    await setClientTag(clientId, tag?.platform ?? null, tag?.handle ?? null);
    await saveClientEmail(clientId, clientEmail);
  }

  function handleOpenNewClient() {
    closeClientForm();
    setClientForm("new");
  }

  useEffect(() => {
    if (takeAction("new-client")) {
      handleOpenNewClient();
    }
  }, []);

  async function handleCreateClient() {
    try {
      setSavingClient(true);

      const newId = await createClient(clientName, clientPlatform, clientHandle, clientNotes);
      await saveTag(newId);

      // The photo is fetched in the background so you don't wait
      const tag = parseTagAccount(tagText, { platform: "Other", handle: "" });
      fetchAvatar([
        { platform: tag?.platform ?? null, handle: tag?.handle ?? null },
        { platform: clientPlatform, handle: clientHandle },
      ])
        .then(async (path) => {
          if (path) {
            await updateClientAvatar(newId, path);
            await loadClients();
          }
        })
        .catch(console.error);

      closeClientForm();

      // The new client has the highest id: open their profile
      const data = await loadClients();
      setSelectedClientId(Math.max(...data.map((client) => client.id)));
    } catch (error) {
      console.error(error);
      showToast("Could not create client.", "error");
    } finally {
      setSavingClient(false);
    }
  }

    async function handleDeleteClient(clientId: number) {
    try {
        const trashId = await deleteClient(clientId);
        await loadClients();
        setSelectedClientId(null);
        undoToast(showToast, "Client deleted.", trashId);
    } catch (error) {
        console.error(error);
        showToast("Could not delete client.", "error");
    }
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

  async function loadReferencesForCharacters(
    charactersByClient: Record<number, ClientCharacter[]>,
  ) {
    const allCharacters = Object.values(charactersByClient).flat();

    const entries = await Promise.all(
      allCharacters.map(async (character) => {
        const refs = await getCharacterReferences(character.id);
        return [character.id, refs] as const;
      }),
    );

    setReferencesByCharacterId(Object.fromEntries(entries));

  }

  useEffect(() => {
    (async () => {
      const data = await getClients();

      setClients(data);
      setClientsReady(true);
      // Opens the client picked from search, else the first one alphabetically
      const wanted = Number(sessionStorage.getItem("zeeboard-active-client-id"));
      sessionStorage.removeItem("zeeboard-active-client-id");
      setSelectedClientId(
        data.find((client) => client.id === wanted)?.id ?? [...data].sort((a, b) => a.name.localeCompare(b.name))[0]?.id ?? null,
      );

      const characterEntries = await Promise.all(
        data.map(async (client) => {
          const characters = await getClientCharacters(client.id);
          return [client.id, characters] as const;
        }),
      );

      const nextCharactersByClientId = Object.fromEntries(characterEntries);

      setCharactersByClientId(nextCharactersByClientId);

      await loadReferencesForCharacters(nextCharactersByClientId);
    })();

    getCommissions()
      .then(async (data) => {
        setCommissions(data);
        getAllPayments().then(setPayments).catch(console.error);
        await loadStageImagesForCommissions(data);
        await loadCharactersForCommissions(data);

        const templateIds = Array.from(
          new Set(
            data
              .map((commission) => commission.template_id)
              .filter((templateId): templateId is number => templateId !== null),
          ),
        );

        const entries = await Promise.all(
          templateIds.map(async (templateId) => {
            const stages = await getTemplateStages(templateId);
            return [templateId, stages] as const;
          }),
        );

        setTemplateStagesByTemplateId(Object.fromEntries(entries));
      })
      .catch(console.error);
  }, []);

  function handleOpenEditClient(client: Client) {
    setClientForm(client);
    setClientName(client.name);
    setClientPlatform(client.platform || "Twitter / X");
    setClientHandle(client.handle || "");
    setClientNotes(client.notes || "");
    setTagText(client.tag_handle ? [client.tag_platform, client.tag_handle].filter(Boolean).join(" ") : "");
    setClientEmailText(client.email || "");
  }

  async function handleSaveClientChanges() {
    if (!clientForm || clientForm === "new") {
      return;
    }

    try {
      setSavingClient(true);

      await updateClient(
        clientForm.id,
        clientName,
        clientPlatform,
        clientHandle,
        clientNotes,
      );
      await saveTag(clientForm.id);

      closeClientForm();
      await loadClients();
    } catch (error) {
    console.error(error);
    showToast("Could not save client changes.", "error");
    } finally {
      setSavingClient(false);
    }
  }

  function getClientInitials(name: string) {
    const words = name.trim().split(/\s+/).filter(Boolean);

    if (words.length === 0) {
      return "?";
    }

    if (words.length === 1) {
      return words[0].slice(0, 2).toUpperCase();
    }

    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }

  function getClientAvatarBackground(name: string) {
    const colours = [
      "bg-primary",
      "bg-[#7c3aed]",
      "bg-[#0891b2]",
      "bg-[#16a34a]",
      "bg-[#f59e0b]",
      "bg-[#dc2626]",
    ];

    const total = name
      .split("")
      .reduce((sum, letter) => sum + letter.charCodeAt(0), 0);

    return colours[total % colours.length];
  }

  /** Accounts to look up their photo, in order: tag account first, then contact. */
  function avatarAccounts(client: Client) {
    return [
      { platform: client.tag_platform, handle: client.tag_handle },
      { platform: client.platform, handle: client.handle },
    ];
  }

  async function handleFetchClientAvatar(client: Client) {
    try {
      setFetchingAvatar(true);
      const path = await fetchAvatar(avatarAccounts(client));

      if (!path) {
        showToast("No public photo found. Drop an image on the avatar to set it yourself.", "error");
        return;
      }

      await updateClientAvatar(client.id, path);
      await loadClients();
      showToast("Photo updated.", "success");
    } catch (error) {
      console.error(error);
      showToast(t("Could not fetch the photo: {error}", { error: error instanceof Error ? error.message : String(error) }), "error");
    } finally {
      setFetchingAvatar(false);
    }
  }

  /** Sets the photo by hand: without `source` opens the picker; otherwise it's what you dropped or pasted. */
  async function handleSetAvatar(clientId: number, source?: string | File) {
    try {
      const picked = source ?? (await pickImagePaths())[0];

      if (!picked) {
        return;
      }

      const stored = await importImage(picked);
      await updateClientAvatar(clientId, stored.path);
      await loadClients();
      showToast("Photo updated.", "success");
    } catch (error) {
      console.error(error);
      showToast(t("Could not set the photo: {error}", { error: String(error) }), "error");
    }
  }

  async function handleCreateCharacter() {
    if (!selectedClient) {
      return;
    }

    if (!newCharacterName.trim()) {
      return;
    }

    await createClientCharacter(selectedClient.id, newCharacterName, "");
    await reloadCharacters(selectedClient.id);

    setNewCharacterName("");
    setAddingCharacter(false);
  }

  async function reloadCharacters(clientId: number) {
    const updatedCharacters = await getClientCharacters(clientId);

    setCharactersByClientId((current) => ({
      ...current,
      [clientId]: updatedCharacters,
    }));

    return updatedCharacters;
  }

  async function handleSaveCharacter(characterId: number) {
    if (!selectedClient) {
      return;
    }

    try {
      await updateClientCharacter(characterId, editCharacterName, editCharacterNotes);
      await reloadCharacters(selectedClient.id);
      setEditingCharacter(false);
    } catch (error) {
      console.error(error);
      showToast("Could not save character.", "error");
    }
  }

  async function handleDeleteCharacter(characterId: number) {
    if (!selectedClient) {
      return;
    }

    try {
      const trashId = await deleteClientCharacter(characterId);
      await reloadCharacters(selectedClient.id);
      setExpandedCharacterId(null);
      undoToast(showToast, "Character deleted.", trashId);
    } catch (error) {
      console.error(error);
      showToast("Could not delete character.", "error");
    }
  }

  /** Without `sources` opens the picker; with them, they come from drag and drop or Ctrl+V. */
  async function handleAddCharacterReferences(characterId: number, sources?: (string | File)[]) {
    if (importingCharacterId !== null) {
      return;
    }

    const items = sources ?? (await pickImagePaths());

    if (items.length === 0) {
      return;
    }

    setImportingCharacterId(characterId);

    try {
      for (const item of items) {
        const stored = await importImage(item);
        await createCharacterReference(characterId, stored.path);
      }
    } catch (error) {
      console.error(error);
      showToast(t("Could not add reference image: {error}", { error: String(error) }), "error");
    } finally {
      setImportingCharacterId(null);
    }

    const updatedReferences = await getCharacterReferences(characterId);

    setReferencesByCharacterId((current) => ({
      ...current,
      [characterId]: updatedReferences,
    }));
  }

  const dragZoneId = useImageInput({
    onDrop: (zoneId, paths) => {
      const [kind, characterId] = zoneId.split(":");

      if (kind === "character" || kind === "character-detail") {
        handleAddCharacterReferences(Number(characterId), paths);
      }

      // Dropping an image on the client's photo
      if (kind === "avatar") {
        handleSetAvatar(Number(characterId), paths[0]);
      }
    },
    // Ctrl+V adds the image to the character open in the client's profile
    onPaste: (files) => {
      if (selectedClient && expandedCharacterId !== null) {
        handleAddCharacterReferences(expandedCharacterId, files);
      } else if (selectedClient) {
        // With no character open, the pasted image is the client's photo
        handleSetAvatar(selectedClient.id, files[0]);
      }
    },
  });

  async function handleDeleteCharacterReference(
    characterId: number,
    referenceId: number,
  ) {
    await deleteCharacterReference(referenceId);

    const updatedReferences =
      await getCharacterReferences(characterId);

    setReferencesByCharacterId((current) => ({
      ...current,
      [characterId]: updatedReferences,
    }));
  }

  const selectedClientCommissions = selectedClient
    ? commissions.filter(
        (commission) => commission.client_id === selectedClient.id,
      )
    : [];

  const completedCommissions = selectedClientCommissions.filter(
    isCommissionCompleted,
  );

  const activeCommissions = selectedClientCommissions.filter(
    (commission) => !isCommissionCompleted(commission),
  );

  const totalSpent = selectedClientCommissions.reduce(
    (sum, commission) => sum + (commission.price ?? 0),
    0,
  );

  const totalEarned = selectedClientCommissions.reduce(
    (total, commission) => total + (commission.price || 0),
    0,
  );

  const commissionsWithPrice = selectedClientCommissions.filter(
    (commission) => commission.price !== null,
  );

  const averagePrice =
    commissionsWithPrice.length > 0
      ? Math.round(totalEarned / commissionsWithPrice.length)
      : 0;

  const paymentStatuses = selectedClientCommissions.map(
    (commission) =>
      paymentSummary(
        commission.price,
        payments.filter((payment) => payment.commission_id === commission.id),
      ).status,
  );
  const paidCommissionsCount = paymentStatuses.filter((status) => status === "paid").length;
  // Unpaid or partially paid
  const unpaidCommissionsCount = paymentStatuses.length - paidCommissionsCount;

  function handleOpenCommissionFromClient(commission: Commission) {
    localStorage.setItem(
      "zeeboard-active-commission-id",
      String(commission.id),
    );

    onOpenCommissionsPage();
  }

  function getCommissionCompletionPercentage(commission: Commission) {
    return getCommissionCompletionPercentageHelper(commission, templateStagesByTemplateId);
  }

  function isCommissionCompleted(commission: Commission) {
    return isCommissionCompletedHelper(commission, templateStagesByTemplateId);
  }

  const selectedCharacters = selectedClient ? charactersByClientId[selectedClient.id] ?? [] : [];
  const openCharacter =
    selectedCharacters.find((character) => character.id === expandedCharacterId) ?? null;

  const visibleClients = [...clients]
    .filter((client) =>
      `${client.name} ${client.handle ?? ""}`.toLowerCase().includes(clientSearch.trim().toLowerCase()),
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  function renderAvatar(client: Client, size: "sm" | "lg") {
    const sizeClass = size === "sm" ? "h-9 w-9 text-xs" : "h-14 w-14 text-base";

    // In private mode neither the photo nor the initials identify the client
    if (isPrivate()) {
      return <div className={`${sizeClass} shrink-0 rounded-full bg-highlight`} />;
    }

    return client.avatar_url ? (
      <img
        src={avatarSrc(client.avatar_url)}
        alt={client.name}
        className={`${sizeClass} shrink-0 rounded-full object-cover`}
      />
    ) : (
      <div
        className={`${sizeClass} flex shrink-0 items-center justify-center rounded-full font-black text-white ${getClientAvatarBackground(
          client.name,
        )}`}
      >
        {getClientInitials(client.name)}
      </div>
    );
  }

  return (
    <>
      <PageHeader
        label={t("Client database")}
        title={t("Clients")}
        description={t("Your clients, their characters and their commissions.")}
        action={t("+ New client")}
        onAction={handleOpenNewClient}
      />

      <section className="grid h-[calc(100vh-117px)] min-h-0 grid-cols-[280px_minmax(0,1fr)] gap-5 overflow-hidden p-5 pb-6">
        <div className="flex min-h-0 flex-col panel rounded-3xl p-3">
          <input
            value={clientSearch}
            onChange={(event) => setClientSearch(event.target.value)}
            placeholder={t("Search clients…")}
            className="mb-2 rounded-md border border-line-strong bg-paper px-3 py-2 text-sm"
          />

          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
            {!clientsReady ? null : visibleClients.length === 0 ? (
              <p className="p-4 text-center text-sm text-faint">
                {clients.length === 0 ? t("No clients yet") : t("No matches")}
              </p>
            ) : (
              visibleClients.map((client) => {
                const commissionCount = commissions.filter(
                  (commission) => commission.client_id === client.id,
                ).length;

                return (
                  <button
                    key={client.id}
                    type="button"
                    onClick={() => {
                      setSelectedClientId(client.id);
                      setExpandedCharacterId(null);
                      setAddingCharacter(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition ${
                      client.id === selectedClientId ? "bg-highlight" : "hover:bg-paper"
                    }`}
                  >
                    {renderAvatar(client, "sm")}

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">{hide(client.name)}</p>
                      <p className="truncate text-xs text-faint">
                        {hide(client.handle || client.platform || t("No contact"))}
                      </p>
                    </div>

                    {commissionCount > 0 && (
                      <span className="text-xs font-semibold text-faint">{commissionCount}</span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto panel rounded-3xl p-6">
          {!clientsReady ? null : !selectedClient ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <p className="text-lg font-black">
                {clients.length === 0 ? t("Add your first client") : t("Pick a client")}
              </p>
              <p className="mt-1 text-sm text-muted">
                {clients.length === 0
                  ? t("Keep their contact, characters and references in one place.")
                  : t("Their profile, characters and commissions show up here.")}
              </p>
              {clients.length === 0 && (
                <button
                  type="button"
                  onClick={handleOpenNewClient}
                  className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-bold text-on-primary"
                >
                  {t("New client")}
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  data-image-drop={`avatar:${selectedClient.id}`}
                  title={t("Click, drop an image or paste one (Ctrl+V) to change the photo")}
                  onClick={() => handleSetAvatar(selectedClient.id)}
                  className={`shrink-0 rounded-full transition ${
                    dragZoneId === `avatar:${selectedClient.id}`
                      ? "ring-2 ring-ink ring-offset-2 ring-offset-surface"
                      : "hover:opacity-80"
                  }`}
                >
                  {renderAvatar(selectedClient, "lg")}
                </button>

                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-2xl font-black">{hide(selectedClient.name)}</h3>
                  <p className="text-sm text-muted">
                    {selectedClient.platform || t("No platform")}
                    {selectedClient.handle ? ` · ${hide(selectedClient.handle)}` : ""}
                  </p>
                  {selectedClient.email && <p className="text-sm text-muted">{hide(selectedClient.email)}</p>}
                  {selectedClient.tag_handle && (
                    <p className="text-sm text-muted">
                      {t("Tag when posting:")}{" "}
                      {selectedClient.tag_platform && selectedClient.tag_platform !== "Other"
                        ? `${selectedClient.tag_platform} `
                        : ""}
                      {hide(selectedClient.tag_handle)}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 gap-2">
                  {avatarAccounts(selectedClient).some(
                    (account) => (account.platform === "Bluesky" || account.platform === "Telegram") && account.handle,
                  ) && (
                    <button
                      type="button"
                      onClick={() => handleFetchClientAvatar(selectedClient)}
                      disabled={fetchingAvatar}
                      className="rounded-md border border-line-strong px-3 py-1.5 text-xs font-semibold text-muted transition hover:border-ink hover:text-ink"
                    >
                      {fetchingAvatar ? t("Fetching…") : t("Fetch photo")}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleOpenEditClient(selectedClient)}
                    className="rounded-md border border-line-strong px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-ink"
                  >
                    {t("Edit")}
                  </button>

                  <button
                    type="button"
                    onClick={() => setClientToDelete(selectedClient)}
                    className="rounded-md px-3 py-1.5 text-xs font-semibold text-tone-bad transition hover:bg-tone-bad/10"
                  >
                    {t("Delete")}
                  </button>
                </div>
              </div>

              <dl className="mt-6 grid grid-cols-4 gap-3">
                {[
                  {
                    label: t("Commissions"),
                    value: selectedClientCommissions.length,
                    detail: t("{active} active · {done} done", { active: activeCommissions.length, done: completedCommissions.length }),
                    className: "text-ink",
                  },
                  {
                    label: t("Spent"),
                    value: formatMoney(totalSpent),
                    detail: t("{amount} average", { amount: formatMoney(averagePrice) }),
                    className: "text-ink",
                  },
                  { label: t("Paid"), value: paidCommissionsCount, detail: t("commissions"), className: "text-tone-ok" },
                  { label: t("Unpaid"), value: unpaidCommissionsCount, detail: t("commissions"), className: "text-tone-bad" },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-md bg-paper p-3">
                    <dt className="text-xs font-bold text-muted">
                      {stat.label}
                    </dt>
                    <dd className={`mt-1 text-xl font-black ${stat.className}`}>{stat.value}</dd>
                    <dd className="text-xs text-muted">{stat.detail}</dd>
                  </div>
                ))}
              </dl>

              <h4 className="mb-2 mt-8 text-xs font-bold text-muted">
                Commissions · {selectedClientCommissions.length}
              </h4>

              {selectedClientCommissions.length === 0 ? (
                <p className="text-sm text-muted">{t("No commissions yet.")}</p>
              ) : (
                <div className="divide-y divide-line border-y border-line">
                  {selectedClientCommissions.map((commission) => {
                    const commissionImages = stageImagesByCommissionId[commission.id] ?? [];
                    const commissionPreview = commissionImages[commissionImages.length - 1] ?? null;
                    const completionPercentage = getCommissionCompletionPercentage(commission);
                    const isCompleted = isCommissionCompleted(commission);

                    return (
                      <button
                        key={commission.id}
                        type="button"
                        onClick={() => handleOpenCommissionFromClient(commission)}
                        title={t("Open commission")}
                        className="flex w-full items-center gap-4 px-2 py-2.5 text-left transition hover:bg-paper"
                      >
                        {commissionPreview ? (
                          <img
                            src={thumbUrl(commissionPreview.image_data_url)}
                            loading="lazy" decoding="async"
                            alt={commission.title}
                            className="h-12 w-12 shrink-0 rounded-md object-cover"
                          />
                        ) : (
                          <div className="h-12 w-12 shrink-0 rounded-md bg-paper" />
                        )}

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold">{commission.title}</p>
                          <p className="text-xs text-muted">
                            {commission.price
                              ? formatMoney(commission.price, commission.currency)
                              : t("No price")}
                            {" · "}
                            {commission.deadline || t("No deadline")}
                          </p>
                        </div>

                        <div className="w-32 shrink-0">
                          <div className="flex justify-between text-xs font-bold text-faint">
                            <span>{isCompleted ? t("Done") : t("Progress")}</span>
                            <span>{completionPercentage}%</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-sm bg-paper">
                            <div
                              className={isCompleted ? "h-full bg-tone-ok" : "h-full bg-primary"}
                              style={{ width: `${completionPercentage}%` }}
                            />
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              <h4 className="mb-2 mt-8 text-xs font-bold text-muted">
                Characters · {selectedCharacters.length}
              </h4>

              <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
                {selectedCharacters.map((character) => {
                  const references = referencesByCharacterId[character.id] ?? [];
                  const usedIn = commissions.filter((commission) =>
                    (commissionCharactersById[commission.id] ?? []).includes(character.id),
                  ).length;
                  const isOpen = expandedCharacterId === character.id;
                  const isDropTarget = dragZoneId === `character:${character.id}`;

                  return (
                    <button
                      key={character.id}
                      type="button"
                      data-image-drop={`character:${character.id}`}
                      onClick={() => {
                        setEditingCharacter(false);
                        setExpandedCharacterId(isOpen ? null : character.id);
                      }}
                      className={`rounded-md border p-3 text-left transition ${
                        isDropTarget
                          ? "scale-[1.02] border-ink bg-highlight"
                          : isOpen
                            ? "border-ink bg-paper"
                            : "border-line bg-paper hover:border-line-strong"
                      }`}
                    >
                      <p className="truncate text-sm font-bold">{character.name}</p>
                      <p className="text-xs text-faint">
                        {importingCharacterId === character.id
                          ? t("Optimizing…")
                          : isDropTarget
                            ? t("Drop to add references")
                            : t("{refs} refs · {used} commissions", { refs: references.length, used: usedIn })}
                      </p>

                      <div className="mt-2 grid grid-cols-4 gap-1">
                        {references.slice(0, 4).map((reference, index) => (
                          <div key={reference.id} className="relative aspect-square overflow-hidden rounded-sm bg-highlight">
                            <img
                              src={thumbUrl(reference.image_data_url)}
                              loading="lazy" decoding="async"
                              alt=""
                              className="h-full w-full object-cover"
                            />
                            {index === 3 && references.length > 4 && (
                              <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs font-bold text-white">
                                +{references.length - 4}
                              </span>
                            )}
                          </div>
                        ))}

                        {references.length === 0 && (
                          <div className="col-span-4 flex aspect-[4/1] items-center justify-center rounded-sm border border-dashed border-line-strong text-xs text-faint">
                            {t("No references")}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}

                {addingCharacter ? (
                  <div className="flex flex-col justify-center gap-2 rounded-md border border-line-strong bg-paper p-3">
                    <input
                      autoFocus
                      value={newCharacterName}
                      onChange={(event) => setNewCharacterName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") handleCreateCharacter();
                        if (event.key === "Escape") setAddingCharacter(false);
                      }}
                      placeholder={t("Character name")}
                      className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-ink"
                    />
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setAddingCharacter(false)}
                        className="rounded-md px-2 py-1 text-xs font-semibold text-muted hover:text-ink"
                      >
                        {t("Cancel")}
                      </button>
                      <button
                        type="button"
                        onClick={handleCreateCharacter}
                        disabled={!newCharacterName.trim()}
                        className="rounded-md bg-primary px-2 py-1 text-xs font-bold text-on-primary disabled:opacity-50"
                      >
                        {t("Add")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddingCharacter(true)}
                    className="flex min-h-24 items-center justify-center rounded-md border border-dashed border-line-strong text-sm font-semibold text-muted transition hover:border-ink hover:text-ink"
                  >
                    {t("+ Character")}
                  </button>
                )}
              </div>

              {openCharacter && (() => {
                const character = openCharacter;
                const references = referencesByCharacterId[character.id] ?? [];
                const commissionsUsingCharacter = commissions.filter((commission) =>
                  (commissionCharactersById[commission.id] ?? []).includes(character.id),
                );
                const isDropTarget = dragZoneId === `character-detail:${character.id}`;

                return (
                  <div className="mt-4 rounded-md border border-line p-4">
                    {editingCharacter ? (
                      <div className="space-y-2">
                        <input
                          autoFocus
                          value={editCharacterName}
                          onChange={(event) => setEditCharacterName(event.target.value)}
                          placeholder={t("Character name")}
                          className="w-full rounded-md border border-line-strong bg-paper px-3 py-2 text-sm font-bold"
                        />
                        <textarea
                          value={editCharacterNotes}
                          onChange={(event) => setEditCharacterNotes(event.target.value)}
                          placeholder={t("Notes: species, colours, details to remember…")}
                          rows={3}
                          className="w-full rounded-md border border-line-strong bg-paper px-3 py-2 text-sm"
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingCharacter(false)}
                            className="rounded-md px-3 py-1.5 text-xs font-semibold text-muted hover:text-ink"
                          >
                            {t("Cancel")}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveCharacter(character.id)}
                            disabled={!editCharacterName.trim()}
                            className="rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-on-primary disabled:opacity-50"
                          >
                            {t("Save")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-4">
                        <div className="min-w-0 flex-1">
                          <p className="text-lg font-black">{character.name}</p>
                          {character.notes ? (
                            <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{character.notes}</p>
                          ) : (
                            <p className="mt-1 text-sm text-faint">{t("No notes yet.")}</p>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setEditCharacterName(character.name);
                            setEditCharacterNotes(character.notes ?? "");
                            setEditingCharacter(true);
                          }}
                          className="rounded-md border border-line-strong px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-ink"
                        >
                          {t("Edit")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setCharacterToDelete(character)}
                          className="rounded-md px-3 py-1.5 text-xs font-semibold text-tone-bad transition hover:bg-tone-bad/10"
                        >
                          {t("Delete")}
                        </button>
                      </div>
                    )}

                    <p className="mb-2 mt-5 text-xs font-bold text-muted">
                      References · {references.length}
                    </p>

                    <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
                      {references.map((reference) => (
                        <div key={reference.id} className="group relative aspect-square overflow-hidden rounded-md bg-highlight">
                          <button
                            type="button"
                            onClick={() => setZoomedImage(imageUrl(reference.image_data_url))}
                            className="block h-full w-full cursor-zoom-in"
                          >
                            <img
                              src={thumbUrl(reference.image_data_url)}
                              loading="lazy" decoding="async"
                              alt={reference.label}
                              className="h-full w-full object-cover"
                            />
                          </button>
                          <button
                            type="button"
                            title={t("Remove reference")}
                            onClick={() => handleDeleteCharacterReference(character.id, reference.id)}
                            className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-sm bg-black/60 text-sm text-white opacity-0 transition hover:bg-tone-bad/100 group-hover:opacity-100"
                          >
                            ×
                          </button>
                        </div>
                      ))}

                      <button
                        type="button"
                        data-image-drop={`character-detail:${character.id}`}
                        title={t("Click, drop images here or paste with Ctrl+V")}
                        disabled={importingCharacterId !== null}
                        onClick={() => handleAddCharacterReferences(character.id)}
                        className={`flex aspect-square flex-col items-center justify-center rounded-md border border-dashed text-center text-xs font-semibold transition disabled:cursor-wait disabled:opacity-60 ${
                          isDropTarget
                            ? "border-ink bg-highlight text-ink"
                            : "border-line-strong text-muted hover:border-ink hover:text-ink"
                        }`}
                      >
                        <span className="text-lg">+</span>
                        {importingCharacterId === character.id
                          ? t("Optimizing…")
                          : isDropTarget
                            ? t("Drop here")
                            : t("Add · Ctrl+V")}
                      </button>
                    </div>

                    {commissionsUsingCharacter.length > 0 && (
                      <>
                        <p className="mb-2 mt-5 text-xs font-bold text-muted">
                          Appears in · {commissionsUsingCharacter.length}
                        </p>

                        <div className="flex flex-wrap gap-2">
                          {commissionsUsingCharacter.map((historyCommission) => {
                            const historyImages = stageImagesByCommissionId[historyCommission.id] ?? [];
                            const latestHistoryImage = historyImages[historyImages.length - 1] ?? null;

                            return (
                              <button
                                key={historyCommission.id}
                                type="button"
                                title={historyCommission.title}
                                onClick={() => handleOpenCommissionFromClient(historyCommission)}
                                className="w-24 text-left"
                              >
                                {latestHistoryImage ? (
                                  <img
                                    src={thumbUrl(latestHistoryImage.image_data_url)}
                                    loading="lazy" decoding="async"
                                    alt={historyCommission.title}
                                    className="aspect-square w-full rounded-md object-cover transition hover:opacity-80"
                                  />
                                ) : (
                                  <div className="flex aspect-square items-center justify-center rounded-md bg-paper text-xs text-faint">
                                    {t("No image")}
                                  </div>
                                )}
                                <p className="mt-1 truncate text-xs font-semibold text-muted">
                                  {historyCommission.title}
                                </p>
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}

              {selectedClient.notes && (
                <>
                  <h4 className="mb-2 mt-8 text-xs font-bold text-muted">
                    {t("Notes")}
                  </h4>
                  <p className="whitespace-pre-wrap text-sm text-muted">{selectedClient.notes}</p>
                </>
              )}
            </>
          )}
        </div>
      </section>

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
      {clientForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="w-[480px] glass-heavy rounded-3xl p-6">
            <h3 className="text-xl font-black text-ink">
              {clientForm === "new" ? t("New client") : t("Edit client")}
            </h3>

            <div className="mt-5 space-y-3">
              <input
                autoFocus
                value={clientName}
                onChange={(event) => setClientName(event.target.value)}
                placeholder={t("Client name")}
                data-private
                className="w-full rounded-md border border-line-strong bg-paper px-3 py-2.5"
              />

              <div className="grid grid-cols-[160px_minmax(0,1fr)] gap-3">
                <select
                  value={clientPlatform}
                  onChange={(event) => setClientPlatform(event.target.value)}
                  className="rounded-md border border-line-strong bg-paper px-3 py-2.5"
                >
                  <option>Twitter / X</option>
                  <option>Bluesky</option>
                  <option>Telegram</option>
                  <option>Discord</option>
                  <option>Other</option>
                </select>

                <input
                  value={clientHandle}
                  onChange={(event) => setClientHandle(event.target.value)}
                  placeholder={t("@username")}
                data-private
                  className="rounded-md border border-line-strong bg-paper px-3 py-2.5"
                />
              </div>

              <input
                value={tagText}
                onChange={(event) => setTagText(event.target.value)}
                placeholder={t("Account to tag when posting, e.g. Bluesky @name")}
                data-private
                className="w-full rounded-md border border-line-strong bg-paper px-3 py-2.5"
              />

              <input
                type="email"
                value={clientEmail}
                onChange={(event) => setClientEmailText(event.target.value)}
                placeholder={t("Email (PayPal), to match their payments")}
                data-private
                className="w-full rounded-md border border-line-strong bg-paper px-3 py-2.5"
              />

              <textarea
                value={clientNotes}
                onChange={(event) => setClientNotes(event.target.value)}
                placeholder={t("Notes")}
                data-private
                rows={4}
                className="w-full rounded-md border border-line-strong bg-paper px-3 py-2.5"
              />
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeClientForm}
                className="rounded-md px-4 py-2 text-sm font-semibold text-muted hover:text-ink"
              >
                {t("Cancel")}
              </button>

              <button
                type="button"
                onClick={clientForm === "new" ? handleCreateClient : handleSaveClientChanges}
                disabled={savingClient || !clientName.trim()}
                className="rounded-md bg-primary px-4 py-2 text-sm font-bold text-on-primary transition hover:bg-primary-hover disabled:opacity-50"
              >
                {savingClient ? t("Saving…") : clientForm === "new" ? t("Create client") : t("Save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {characterToDelete && (
        <ConfirmModal
          eyebrow={t("Delete character")}
          title={characterToDelete.name}
          message={t("Its references are deleted too, and it's removed from any commissions. You can undo it right after with Ctrl+Z.")}
          confirmLabel={t("Delete")}
          onConfirm={async () => {
            await handleDeleteCharacter(characterToDelete.id);
            setCharacterToDelete(null);
          }}
          onCancel={() => setCharacterToDelete(null)}
        />
      )}

      {clientToDelete && (
        <ConfirmModal
            eyebrow={t("Delete client")}
            title={clientToDelete.name}
            message={t("You can undo it right after with Ctrl+Z.")}
            confirmLabel={t("Delete")}
            onConfirm={async () => {
            await handleDeleteClient(clientToDelete.id);
            setClientToDelete(null);
            }}
            onCancel={() => setClientToDelete(null)}
        />
        )}
    </>
  );
}

export default ClientsPage;