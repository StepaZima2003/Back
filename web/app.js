const DEMO = {
  alex: { key: "alex", phone: "+79990030001", displayName: "Алексей" },
  sasha: { key: "sasha", phone: "+79990030002", displayName: "Саша" },
  dima: { key: "dima", phone: "+79990030003", displayName: "Дима" },
  masha: { key: "masha", phone: "+79990030004", displayName: "Маша" }
};

const state = {
  currentScreen: "home",
  activeNav: "home",
  collectionsFilter: "active",
  session: null,
  actors: {},
  selectedCollectionId: null,
  selectedOrganizerCollectionId: null,
  selectedPaymentMethodId: null,
  lastPaymentSummary: null,
  draftExpenseItems: [],
  me: null,
  collections: [],
  collectionBundles: [],
  dueBundles: [],
  organizerBundles: [],
  notifications: [],
  paymentMethods: [],
  autopayRules: [],
  autopayPreviewByCollectionId: new Map(),
  autopayExecutionSummaryByCollectionId: new Map(),
  auditLogByCollectionId: new Map(),
  pendingPayConfirmationCollectionId: null,
  pendingAutopayConfirmationCollectionId: null,
  friendships: [],
  friends: [],
  groups: [],
  userDirectory: new Map()
};

const screens = [...document.querySelectorAll(".screen")];
const navItems = [...document.querySelectorAll(".nav-item")];
const statusDot = document.querySelector(".status-dot");
const apiStatusText = document.getElementById("api-status-text");
const disputeCommentInput = document.getElementById("dispute-comment");
const collectionNameInput = document.getElementById("collection-name");
const friendPhoneInput = document.getElementById("friend-phone");
const groupNameInput = document.getElementById("group-name");
const organizerFriendSelect = document.getElementById("organizer-friend-select");
const organizerGuestNameInput = document.getElementById("organizer-guest-name");
const organizerChildNameInput = document.getElementById("organizer-child-name");
const organizerChildResponsibleSelect = document.getElementById("organizer-child-responsible-select");
const organizerExpenseTitleInput = document.getElementById("organizer-expense-title");
const organizerExpenseAmountInput = document.getElementById("organizer-expense-amount");
const organizerExpenseItemTitleInput = document.getElementById("organizer-expense-item-title");
const organizerExpenseItemAmountInput = document.getElementById("organizer-expense-item-amount");
const payManualProofUrlInput = document.getElementById("pay-manual-proof-url");
const payManualCommentInput = document.getElementById("pay-manual-comment");
const collectionFilterTabs = [...document.querySelectorAll('[data-screen="collections"] .tab-row .chip')];
const INTERACTIVE_SELECTOR =
  "[data-go], [data-action], [data-collection-id], [data-organizer-collection-id], [data-payment-method-id], [data-notification-id], .chip, .switch";

collectionFilterTabs[0]?.setAttribute("data-collection-filter", "active");
collectionFilterTabs[1]?.setAttribute("data-collection-filter", "history");
collectionFilterTabs[2]?.setAttribute("data-collection-filter", "organizer");

document.addEventListener("click", async (event) => {
  const target = event.target instanceof Element ? event.target.closest(INTERACTIVE_SELECTOR) : null;
  if (!target) {
    return;
  }

  haptic("tap");

  if (target.classList.contains("chip")) {
    handleChipClick(target);
    return;
  }

  if (target.classList.contains("switch")) {
    target.classList.toggle("is-on");
    return;
  }

  const paymentMethodId = target.getAttribute("data-payment-method-id");
  if (paymentMethodId) {
    state.selectedPaymentMethodId = paymentMethodId;
    renderPayScreen();
    return;
  }

  const collectionId = target.getAttribute("data-collection-id");
  if (collectionId) {
    state.selectedCollectionId = collectionId;
  }

  const organizerCollectionId = target.getAttribute("data-organizer-collection-id");
  if (organizerCollectionId) {
    state.selectedOrganizerCollectionId = organizerCollectionId;
  }

  const notificationId = target.getAttribute("data-notification-id");
  if (notificationId) {
    openNotification(notificationId);
    return;
  }

  const action = target.getAttribute("data-action");
  if (action) {
    await runAction(action, target);
    return;
  }

  const screen = target.getAttribute("data-go");
  if (!screen) {
    return;
  }

  const nav = target.getAttribute("data-nav");
  setActiveScreen(screen, nav ?? state.activeNav);
  renderScreenDependents();
  if (screen === "organizer") {
    void syncOrganizerAutopayPreview({ collectionId: state.selectedOrganizerCollectionId, silent: true });
  }
});

document.addEventListener("pointerdown", (event) => {
  const target = event.target instanceof Element ? event.target.closest(INTERACTIVE_SELECTOR) : null;
  target?.classList.add("is-pressing");
});

["pointerup", "pointercancel", "pointerleave"].forEach((eventName) => {
  document.addEventListener(eventName, () => {
    document.querySelectorAll(".is-pressing").forEach((node) => node.classList.remove("is-pressing"));
  });
});

function setActiveScreen(screenName, navName) {
  state.currentScreen = screenName;
  state.activeNav = navName;

  if (screenName !== "pay") {
    state.pendingPayConfirmationCollectionId = null;
  }
  if (screenName !== "organizer") {
    state.pendingAutopayConfirmationCollectionId = null;
  }

  screens.forEach((screen) => {
    const isActive = screen.dataset.screen === screenName;
    screen.classList.toggle("is-active", isActive);
    screen.classList.toggle("is-entering", false);
    if (isActive) {
      const scrollArea = screen.querySelector(".screen-scroll");
      if (scrollArea) {
        scrollArea.scrollTop = 0;
      }
      requestAnimationFrame(() => {
        screen.classList.add("is-entering");
      });
    }
  });

  navItems.forEach((item) => item.classList.toggle("is-active", item.dataset.nav === navName));

  if (screenName === "paid" || screenName === "dispute-sent") {
    triggerCompletionFeedback();
  }

  if (screenName === "collection" && state.selectedCollectionId) {
    void ensureCollectionAuditLog(state.selectedCollectionId);
  }
  if (screenName === "organizer" && state.selectedOrganizerCollectionId) {
    void ensureCollectionAuditLog(state.selectedOrganizerCollectionId);
  }
}

async function runAction(action, source) {
  try {
    switch (action) {
      case "open-pay":
        state.pendingPayConfirmationCollectionId = null;
        setActiveScreen("pay", "home");
        renderPayScreen();
        break;
      case "open-pay-confirm":
        armPaymentConfirmation();
        break;
      case "cancel-pay-confirm":
        state.pendingPayConfirmationCollectionId = null;
        renderPayScreen();
        break;
      case "confirm-pay-now":
        await submitPayment();
        break;
      case "submit-dispute":
        await submitDispute();
        break;
      case "create-collection":
        await createCollectionFromForm();
        break;
      case "invite-friend":
        await inviteFriendFromForm();
        break;
      case "create-group":
        await createGroupFromForm();
        break;
      case "add-collection-friend":
        await addCollectionFriend();
        break;
      case "add-collection-guest":
        await addCollectionGuest();
        break;
      case "add-collection-child":
        await addCollectionChild();
        break;
      case "set-responsible-payer":
        await setResponsiblePayerFromAction(source);
        break;
      case "save-participant-profile":
        await updateParticipantProfileFromAction(source);
        break;
      case "apply-participant-preset":
        await applyParticipantPresetFromAction(source);
        break;
      case "add-expense":
        await addCollectionExpense();
        break;
      case "add-expense-item-draft":
        addDraftExpenseItem();
        break;
      case "clear-expense-items-draft":
        clearDraftExpenseItems();
        break;
      case "add-expense-item":
        await addExpenseItemToExistingExpense(source);
        break;
      case "add-expense-rule":
        await addExpenseRuleForParticipant(source);
        break;
      case "calculate-collection":
        await calculateSelectedCollection();
        break;
      case "send-review":
        await sendCollectionToReview();
        break;
      case "confirm-review":
        await confirmCurrentParticipantReview();
        break;
      case "accept-dispute":
        await updateDisputeFromAction(source, "accept");
        break;
      case "reject-dispute":
        await updateDisputeFromAction(source, "reject");
        break;
      case "resolve-dispute":
        await updateDisputeFromAction(source, "resolve");
        break;
      case "mark-manual-paid":
        await markManualPaymentFromUi();
        break;
      case "confirm-manual-payment":
        await updateManualPaymentFromAction(source, "confirm");
        break;
      case "reject-manual-payment":
        await updateManualPaymentFromAction(source, "reject");
        break;
      case "create-payment-setup":
        await createPaymentMethodSetup();
        break;
      case "confirm-payment-setup":
        await updatePaymentMethodSetup(source, "confirm");
        break;
      case "fail-payment-setup":
        await updatePaymentMethodSetup(source, "fail");
        break;
      case "revoke-payment-method":
        await revokePaymentMethodFromAction(source);
        break;
      case "save-autopay-rule":
        await saveAutopayRule();
        break;
      case "preview-autopay":
        state.pendingAutopayConfirmationCollectionId = null;
        await syncOrganizerAutopayPreview();
        break;
      case "open-autopay-confirm":
        await armAutopayConfirmation();
        break;
      case "cancel-autopay-confirm":
        state.pendingAutopayConfirmationCollectionId = null;
        renderOrganizerScreen();
        break;
      case "confirm-execute-autopay":
        await executeOrganizerAutopay();
        break;
      default:
        break;
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Действие не выполнено", false);
  }
}

function handleChipClick(target) {
  const container = target.closest(".chip-wrap, .tab-row");
  if (!container) {
    target.classList.toggle("is-selected");
    return;
  }

  [...container.querySelectorAll(".chip")].forEach((chip) => chip.classList.remove("is-selected"));
  target.classList.add("is-selected");

  const collectionFilter = target.getAttribute("data-collection-filter");
  if (collectionFilter) {
    state.collectionsFilter = collectionFilter;
    renderCollectionsScreen();
  }
}

async function bootstrap() {
  document.body.classList.add("is-booting");
  renderBootSkeletons();
  await pingHealth();
  await loginDemoActors();
  await ensureDemoData();
  await refreshAppData();
  setStatus("Демо-данные готовы", true);
  renderAll();
  document.body.classList.remove("is-booting");
}

async function pingHealth() {
  const response = await fetch("/health");
  if (!response.ok) {
    throw new Error(`Проверка API не прошла: ${response.status}`);
  }
  const health = await response.json();
  setStatus(`${health.service} онлайн`, true);
}

async function loginDemoActors() {
  for (const actor of Object.values(DEMO)) {
    const session = await authActor(actor.phone, actor.displayName);
    state.actors[actor.key] = session;
    if (actor.key === "alex") {
      state.session = session;
    }
  }
}

async function authActor(phone, displayName) {
  await fetchJson("/auth/request-otp", {
    method: "POST",
    body: { phone }
  });

  const session = await fetchJson("/auth/verify-otp", {
    method: "POST",
    body: { phone, otp: "000000" }
  });

  await fetchJson("/me", {
    method: "PATCH",
    token: session.accessToken,
    body: { displayName }
  });

  session.user.displayName = displayName;
  return session;
}

async function ensureDemoData() {
  const alexCollections = await fetchJson("/collections", { token: state.actors.alex.accessToken });
  const titleSet = new Set(alexCollections.map((collection) => collection.title));

  if ((await fetchJson("/friends", { token: state.actors.alex.accessToken })).filter((item) => item.status === "accepted").length === 0) {
    await seedFriendships();
  }

  let dachaGroup = (await fetchJson("/groups", { token: state.actors.alex.accessToken })).find((group) => group.title === "Дача");
  if (!dachaGroup) {
    dachaGroup = await fetchJson("/groups", {
      method: "POST",
      token: state.actors.alex.accessToken,
      body: { title: "Дача", groupType: "trip" }
    });
  }

  const paymentMethods = await fetchJson("/payment-methods", { token: state.actors.alex.accessToken });
  if (!paymentMethods.some((method) => method.status === "active")) {
    await fetchJson("/payment-methods/mock-bind", {
      method: "POST",
      token: state.actors.alex.accessToken,
      body: {
        provider: "bank",
        maskedPan: "2200 **** **** 4821",
        brand: "mir",
        setAsDefault: true
      }
    });
  }

  if (!titleSet.has("Шашлыки в субботу")) {
    await seedPicnicCollection();
  }

  if (!titleSet.has("Дача на майские")) {
    await seedOrganizerCollection(dachaGroup.id);
  }

  if (!titleSet.has("Подарок Ире")) {
    await seedGiftCollection();
  }
}

async function seedFriendships() {
  const sashaInvite = await fetchJson("/friends/invite", {
    method: "POST",
    token: state.actors.alex.accessToken,
    body: { phone: DEMO.sasha.phone }
  });
  await fetchJson(`/friends/${sashaInvite.id}/accept`, {
    method: "POST",
    token: state.actors.sasha.accessToken
  });

  const dimaInvite = await fetchJson("/friends/invite", {
    method: "POST",
    token: state.actors.alex.accessToken,
    body: { phone: DEMO.dima.phone }
  });
  await fetchJson(`/friends/${dimaInvite.id}/accept`, {
    method: "POST",
    token: state.actors.dima.accessToken
  });

  const mashaInvite = await fetchJson("/friends/invite", {
    method: "POST",
    token: state.actors.alex.accessToken,
    body: { phone: DEMO.masha.phone }
  });
  await fetchJson(`/friends/${mashaInvite.id}/accept`, {
    method: "POST",
    token: state.actors.masha.accessToken
  });
}

async function seedPicnicCollection() {
  const created = await fetchJson("/collections", {
    method: "POST",
    token: state.actors.sasha.accessToken,
    body: { title: "Шашлыки в субботу", type: "picnic" }
  });

  const collectionId = created.collection.id;
  const organizerParticipant = created.organizerParticipant;
  const alexParticipant = await fetchJson(`/collections/${collectionId}/participants`, {
    method: "POST",
    token: state.actors.sasha.accessToken,
    body: {
      linkedUserId: state.actors.alex.user.id,
      displayName: "Алексей"
    }
  });

  const dimaParticipant = await fetchJson(`/collections/${collectionId}/participants`, {
    method: "POST",
    token: state.actors.sasha.accessToken,
    body: {
      linkedUserId: state.actors.dima.user.id,
      displayName: "Дима"
    }
  });

  const guest = await fetchJson(`/collections/${collectionId}/participants/add-guest`, {
    method: "POST",
    token: state.actors.sasha.accessToken,
    body: {
      displayName: "Аня",
      responsiblePayerParticipantId: alexParticipant.id
    }
  });

  const invitedNames = ["Маша", "Илья", "Катя", "Олег"];
  const seededParticipants = [alexParticipant, dimaParticipant, guest];
  for (const [index, name] of invitedNames.entries()) {
    const participant = await fetchJson(`/collections/${collectionId}/participants`, {
      method: "POST",
      token: state.actors.sasha.accessToken,
      body: {
        invitedPhone: `+7999003100${index + 1}`,
        displayName: name
      }
    });
    seededParticipants.push(participant);
  }

  await fetchJson(`/collections/${collectionId}/expenses`, {
    method: "POST",
    token: state.actors.sasha.accessToken,
    body: {
      title: "Продукты и беседка",
      amountMinor: 14000,
      payments: [{ paidByParticipantId: organizerParticipant.id, amountMinor: 14000, paymentSource: "card" }]
    }
  });

  await fetchJson(`/collections/${collectionId}/calculate`, {
    method: "POST",
    token: state.actors.sasha.accessToken
  });
  await fetchJson(`/collections/${collectionId}/send-to-review`, {
    method: "POST",
    token: state.actors.sasha.accessToken
  });

  const autoPaidNames = new Set(["Маша", "Илья", "Катя"]);
  for (const participant of seededParticipants.filter((item) => autoPaidNames.has(item.displayNameSnapshot))) {
    const payment = await fetchJson(`/collections/${collectionId}/payments/mock-intents`, {
      method: "POST",
      token: state.actors.sasha.accessToken,
      body: {
        participantId: participant.id,
        amountMinor: 1750,
        provider: "bank",
        idempotencyKey: `demo-picnic-${participant.id}`
      }
    });

    await fetchJson(`/payments/${payment.id}/simulate-success`, {
      method: "POST",
      token: state.actors.sasha.accessToken
    });
  }
}

async function seedOrganizerCollection(groupId) {
  const created = await fetchJson("/collections", {
    method: "POST",
    token: state.actors.alex.accessToken,
    body: { title: "Дача на майские", type: "trip", groupId }
  });

  const collectionId = created.collection.id;
  const organizerParticipant = created.organizerParticipant;
  const dimaParticipant = await fetchJson(`/collections/${collectionId}/participants`, {
    method: "POST",
    token: state.actors.alex.accessToken,
    body: {
      linkedUserId: state.actors.dima.user.id,
      displayName: "Дима"
    }
  });

  await fetchJson(`/collections/${collectionId}/participants`, {
    method: "POST",
    token: state.actors.alex.accessToken,
    body: {
      linkedUserId: state.actors.sasha.user.id,
      displayName: "Саша"
    }
  });

  await fetchJson(`/collections/${collectionId}/expenses`, {
    method: "POST",
    token: state.actors.alex.accessToken,
    body: {
      title: "Аренда дома",
      amountMinor: 15000,
      payments: [{ paidByParticipantId: organizerParticipant.id, amountMinor: 15000, paymentSource: "card" }]
    }
  });

  await fetchJson(`/collections/${collectionId}/calculate`, {
    method: "POST",
    token: state.actors.alex.accessToken
  });
  await fetchJson(`/collections/${collectionId}/send-to-review`, {
    method: "POST",
    token: state.actors.alex.accessToken
  });

  await fetchJson(`/collections/${collectionId}/disputes`, {
    method: "POST",
    token: state.actors.dima.accessToken,
    body: {
      participantId: dimaParticipant.id,
      type: "partial_time",
      message: "Меня не было на ужине и бане."
    }
  });
}

async function seedGiftCollection() {
  const created = await fetchJson("/collections", {
    method: "POST",
    token: state.actors.alex.accessToken,
    body: { title: "Подарок Ире", type: "gift" }
  });

  const collectionId = created.collection.id;
  const organizerParticipant = created.organizerParticipant;
  await fetchJson(`/collections/${collectionId}/participants`, {
    method: "POST",
    token: state.actors.alex.accessToken,
    body: {
      linkedUserId: state.actors.sasha.user.id,
      displayName: "Саша"
    }
  });
  await fetchJson(`/collections/${collectionId}/participants`, {
    method: "POST",
    token: state.actors.alex.accessToken,
    body: {
      linkedUserId: state.actors.masha.user.id,
      displayName: "Маша"
    }
  });
  await fetchJson(`/collections/${collectionId}/expenses`, {
    method: "POST",
    token: state.actors.alex.accessToken,
    body: {
      title: "Подарочный сертификат",
      amountMinor: 10000,
      payments: [{ paidByParticipantId: organizerParticipant.id, amountMinor: 10000, paymentSource: "card" }]
    }
  });
  await fetchJson(`/collections/${collectionId}/calculate`, {
    method: "POST",
    token: state.actors.alex.accessToken
  });
}

async function refreshAppData() {
  const token = state.session.accessToken;
  const [me, collections, notifications, paymentMethods, autopayRules, friendships, groups] = await Promise.all([
    fetchJson("/me", { token }),
    fetchJson("/collections", { token }),
    fetchJson("/notifications", { token }),
    fetchJson("/payment-methods", { token }),
    fetchJson("/autopay-rules", { token }),
    fetchJson("/friends", { token }),
    fetchJson("/groups", { token })
  ]);

  state.me = me;
  state.collections = collections;
  state.notifications = notifications;
  state.paymentMethods = paymentMethods;
  state.autopayRules = autopayRules;
  state.friendships = friendships;
  state.groups = groups;
  const activeMethodIds = new Set(paymentMethods.filter((method) => method.status === "active").map((method) => method.id));
  if (!state.selectedPaymentMethodId || !activeMethodIds.has(state.selectedPaymentMethodId)) {
    state.selectedPaymentMethodId =
      paymentMethods.find((method) => method.isDefault && method.status === "active")?.id ??
      paymentMethods.find((method) => method.status === "active")?.id ??
      null;
  }

  const userIds = new Set([me.id, ...collections.map((collection) => collection.organizerId)]);
  friendships.forEach((friendship) => {
    userIds.add(friendship.userId);
    userIds.add(friendship.friendId);
  });

  const users = await Promise.all(
    [...userIds].map(async (userId) => {
      try {
        return await fetchJson(`/users/${userId}`, { token });
      } catch {
        return null;
      }
    })
  );
  state.userDirectory = new Map(users.filter(Boolean).map((user) => [user.id, user]));

  state.collectionBundles = await Promise.all(collections.map((collection) => loadCollectionBundle(collection)));
  state.dueBundles = state.collectionBundles.filter((bundle) => bundle.userDueMinor > 0 && bundle.collection.organizerId !== me.id);
  state.organizerBundles = state.collectionBundles.filter((bundle) => bundle.collection.organizerId === me.id);
  state.friends = await buildFriendDirectory();

  const collectionIds = new Set(state.collectionBundles.map((bundle) => bundle.collection.id));
  if (!state.selectedCollectionId || !collectionIds.has(state.selectedCollectionId)) {
    state.selectedCollectionId = state.dueBundles[0]?.collection.id ?? state.collectionBundles[0]?.collection.id ?? null;
  }
  const organizerCollectionIds = new Set(state.organizerBundles.map((bundle) => bundle.collection.id));
  if (!state.selectedOrganizerCollectionId || !organizerCollectionIds.has(state.selectedOrganizerCollectionId)) {
    state.selectedOrganizerCollectionId = state.organizerBundles[0]?.collection.id ?? null;
  }

  const auditTargets = [...new Set([state.selectedCollectionId, state.selectedOrganizerCollectionId].filter(Boolean))];
  await Promise.all(auditTargets.map((collectionId) => ensureCollectionAuditLog(collectionId, { force: true })));

  if (state.selectedOrganizerCollectionId) {
    await syncOrganizerAutopayPreview({ collectionId: state.selectedOrganizerCollectionId, silent: true });
  }
}

async function ensureCollectionAuditLog(collectionId, options = {}) {
  if (!collectionId || !state.session?.accessToken) {
    return [];
  }

  if (!options.force && state.auditLogByCollectionId.has(collectionId)) {
    return state.auditLogByCollectionId.get(collectionId) ?? [];
  }

  const auditLog = await fetchJson(`/collections/${collectionId}/audit-log`, {
    token: state.session.accessToken
  });
  state.auditLogByCollectionId.set(collectionId, auditLog);

  if (state.currentScreen === "collection" && state.selectedCollectionId === collectionId) {
    renderCollectionScreen();
  }
  if (state.currentScreen === "organizer" && state.selectedOrganizerCollectionId === collectionId) {
    renderOrganizerScreen();
  }

  return auditLog;
}

async function buildFriendDirectory() {
  const accepted = state.friendships.filter((friendship) => friendship.status === "accepted");
  return accepted.map((friendship) => {
    const friendUserId = friendship.userId === state.me.id ? friendship.friendId : friendship.userId;
    const friend = state.userDirectory.get(friendUserId);
    return {
      id: friendship.id,
      userId: friendUserId,
      displayName: friend?.displayName ?? "Участник",
      phone: friend?.phone ?? "",
      sharedCollections: state.collectionBundles.filter((bundle) =>
        bundle.participants.some((participant) => participant.linkedUserId === friendUserId)
      ).length
    };
  });
}

async function loadCollectionBundle(collection) {
  const token = state.session.accessToken;
  const [participants, expenses, calculation, payments, disputes, manualPayments] = await Promise.all([
    fetchJson(`/collections/${collection.id}/participants`, { token }),
    fetchJson(`/collections/${collection.id}/expenses`, { token, allow404: true }).then((value) => value ?? []),
    fetchJson(`/collections/${collection.id}/calculations/latest`, { token, allow404: true }),
    fetchJson(`/collections/${collection.id}/payments`, { token, allow404: true }).then((value) => value ?? []),
    fetchJson(`/collections/${collection.id}/disputes`, { token, allow404: true }).then((value) => value ?? []),
    fetchJson(`/collections/${collection.id}/manual-payments`, { token, allow404: true }).then((value) => value ?? [])
  ]);

  const currentParticipant = participants.find((participant) => participant.linkedUserId === state.me.id) ?? null;
  const coveredParticipants = currentParticipant
    ? participants.filter(
        (participant) => participant.id === currentParticipant.id || participant.paymentResponsibleParticipantId === currentParticipant.id
      )
    : [];

  const userDueMinor = currentParticipant && calculation
    ? calculation.result.transferPlan
        .filter((item) => item.fromResponsiblePayerId === currentParticipant.id)
        .reduce((sum, item) => sum + item.amountMinor, 0)
    : 0;

  const collectedMinor =
    payments.filter((payment) => payment.status === "succeeded").reduce((sum, payment) => sum + payment.amountMinor, 0) +
    manualPayments.filter((payment) => payment.status === "confirmed").reduce((sum, payment) => sum + payment.amountMinor, 0);

  const progressPercent = collection.totalAmountMinor > 0
    ? Math.min(100, Math.round((collectedMinor / collection.totalAmountMinor) * 100))
    : 0;

  return {
    collection,
    participants,
    expenses,
    calculation,
    payments,
    disputes,
    manualPayments,
    currentParticipant,
    coveredParticipants,
    userDueMinor,
    collectedMinor,
    progressPercent
  };
}

function renderAll() {
  renderShowcase();
  renderHome();
  renderInboxScreen();
  renderCollectionsScreen();
  renderCollectionScreen();
  renderPayScreen();
  renderOrganizerScreen();
  renderFriendsScreen();
  renderGroupsScreen();
  renderProfileScreen();
}

function renderShowcase() {
  const bundle = getSelectedOrganizerBundle() ?? state.organizerBundles[0] ?? state.collectionBundles[0] ?? null;
  if (!bundle) {
    return;
  }

  const transfers = bundle.calculation?.result?.transferPlan ?? [];
  const remainingMinor = Math.max(bundle.collection.totalAmountMinor - bundle.collectedMinor, 0);
  const expenseItemsCount = bundle.expenses.reduce((sum, expense) => sum + (expense.items?.length ?? 0), 0) || bundle.expenses.length;
  const dueParticipants = bundle.participants
    .map((participant) => ({
      participant,
      dueMinor: transfers
        .filter((transfer) => transfer.fromResponsiblePayerId === participant.id)
        .reduce((sum, transfer) => sum + transfer.amountMinor, 0),
      paidMinor:
        bundle.payments
          .filter((payment) => payment.payerParticipantId === participant.id && payment.status === "succeeded")
          .reduce((sum, payment) => sum + payment.amountMinor, 0) +
        bundle.manualPayments
          .filter((payment) => payment.payerParticipantId === participant.id && payment.status === "confirmed")
          .reduce((sum, payment) => sum + payment.amountMinor, 0)
    }))
    .sort((left, right) => right.dueMinor - left.dueMinor || right.paidMinor - left.paidMinor);

  text("showcase-collection-title", bundle.collection.title);
  text("showcase-collected-amount", formatMoney(bundle.collectedMinor));
  text("showcase-collected-subtitle", `из ${formatMoney(bundle.collection.totalAmountMinor)}`);
  text("showcase-progress-value", `${bundle.progressPercent}%`);
  text("showcase-remaining-note", `Осталось собрать ${formatMoney(remainingMinor)}`);
  text("showcase-deadline-note", bundle.progressPercent >= 100 ? "Все участники закрыли свои доли" : "Напоминания можно отправить в один тап");
  text("showcase-expenses-total", formatMoney(bundle.collection.totalAmountMinor));
  text("showcase-expenses-count", `${expenseItemsCount} позиций`);
  text("showcase-participants-total", `${bundle.participants.length} человек`);
  text("showcase-expenses-screen-total", formatMoney(bundle.collection.totalAmountMinor));
  text("showcase-expenses-screen-count", `${expenseItemsCount} позиций`);
  text("showcase-settlement-total", formatMoney(remainingMinor));
  text(
    "showcase-reminder-note",
    dueParticipants.some((item) => item.dueMinor > 0) ? "Напоминания готовы к отправке" : "Все долги закрыты"
  );
  text(
    "showcase-finish-title",
    remainingMinor <= 0 || bundle.collection.status === "paid" || bundle.collection.status === "closed" ? "Сбор завершен!" : "Сбор идет по плану"
  );
  text(
    "showcase-finish-subtitle",
    remainingMinor <= 0 || bundle.collection.status === "paid" || bundle.collection.status === "closed"
      ? "Все рассчитались. До новых встреч."
      : `Осталось собрать ${formatMoney(remainingMinor)}. Вся история уже под контролем.`
  );
  text(
    "showcase-receipt-note",
    bundle.expenses.length ? `Найдено ${expenseItemsCount} позиций. Проверьте состав и подтвердите.` : "Добавьте первый расход и подтвердите состав."
  );

  const progressRing = document.getElementById("showcase-progress-ring");
  progressRing?.style.setProperty("--progress", String(bundle.progressPercent));

  const heroAvatars = document.getElementById("showcase-hero-avatars");
  if (heroAvatars) {
    const topParticipants = bundle.participants.slice(0, 3);
    const extraCount = Math.max(bundle.participants.length - topParticipants.length, 0);
    heroAvatars.innerHTML =
      topParticipants
        .map(
          (participant, index) =>
            `<span class="showcase-avatar-chip" style="${showcaseAvatarStyle(index)}">${escapeHtml(initials(participant.displayNameSnapshot))}</span>`
        )
        .join("") + (extraCount ? `<span class="showcase-avatar-chip more">+${extraCount}</span>` : "");
  }

  const participantsGrid = document.getElementById("showcase-participants-grid");
  if (participantsGrid) {
    participantsGrid.innerHTML = bundle.participants
      .slice(0, 4)
      .map((participant, index) => {
        const dueMinor = transfers
          .filter((transfer) => transfer.fromResponsiblePayerId === participant.id)
          .reduce((sum, transfer) => sum + transfer.amountMinor, 0);
        const paidMinor =
          bundle.payments
            .filter((payment) => payment.payerParticipantId === participant.id && payment.status === "succeeded")
            .reduce((sum, payment) => sum + payment.amountMinor, 0) +
          bundle.manualPayments
            .filter((payment) => payment.payerParticipantId === participant.id && payment.status === "confirmed")
            .reduce((sum, payment) => sum + payment.amountMinor, 0);
        const amountMinor = dueMinor > 0 ? dueMinor : paidMinor;
        const statusLabel = dueMinor > 0 ? "к оплате" : paidMinor > 0 ? "внесено" : "в сборе";
        return `
          <article class="showcase-participant-card">
            <span class="showcase-avatar-chip" style="${showcaseAvatarStyle(index + 1)}">${escapeHtml(initials(participant.displayNameSnapshot))}</span>
            <div class="showcase-person-name">${escapeHtml(participant.displayNameSnapshot)}</div>
            <strong>${formatMoney(amountMinor)}</strong>
            <div class="showcase-person-meta">${escapeHtml(statusLabel)}</div>
          </article>
        `;
      })
      .join("");
  }

  const expenseChips = document.getElementById("showcase-expense-chips");
  if (expenseChips) {
    const categories = ["Все", ...new Set(bundle.expenses.map((expense) => inferExpenseCategory(expense.title)).filter(Boolean))].slice(0, 5);
    expenseChips.innerHTML = categories
      .map((category, index) => `<button class="mock-chip${index === 0 ? " is-active" : ""}" type="button">${escapeHtml(category)}</button>`)
      .join("");
  }

  const expensesList = document.getElementById("showcase-expenses-list");
  if (expensesList) {
    expensesList.innerHTML = bundle.expenses.length
      ? bundle.expenses.slice(0, 6).map((expense) => renderShowcaseExpenseRow(expense)).join("")
      : renderShowcaseEmpty("Добавьте первый расход, и он появится здесь.");
  }

  const receiptPaper = document.getElementById("showcase-receipt-paper");
  if (receiptPaper) {
    const receiptLines = bundle.expenses.length
      ? bundle.expenses
          .slice(0, 6)
          .map(
            (expense) => `
              <div class="receipt-line">
                <span>${escapeHtml(truncateText(expense.title, 18))}</span>
                <span>${formatMoney(expense.amountMinor)}</span>
              </div>
            `
          )
          .join("")
      : '<div class="receipt-line"><span>Нет распознанных позиций</span><span>0 ₽</span></div>';
    receiptPaper.innerHTML = `
      <div class="receipt-store">ООО "Вместе"</div>
      <div class="receipt-date">${escapeHtml(formatNotificationTime(bundle.collection.updatedAt ?? bundle.collection.createdAt ?? new Date().toISOString()))}</div>
      ${receiptLines}
      <div class="receipt-total">ИТОГО ${formatMoney(bundle.collection.totalAmountMinor)}</div>
    `;
  }

  const debtList = document.getElementById("showcase-debt-list");
  if (debtList) {
    const debtors = dueParticipants.filter((item) => item.dueMinor > 0).slice(0, 4);
    debtList.innerHTML = debtors.length
      ? debtors
          .map(
            (item, index) => `
              <article class="showcase-debt-row">
                <span class="showcase-avatar-chip" style="${showcaseAvatarStyle(index + 2)}">${escapeHtml(initials(item.participant.displayNameSnapshot))}</span>
                <div class="showcase-debt-copy">
                  <div class="showcase-person-name">${escapeHtml(item.participant.displayNameSnapshot)}</div>
                  <div class="showcase-person-meta">${formatMoney(item.dueMinor)}</div>
                </div>
                <button class="mock-remind-button" type="button" data-go="inbox" data-nav="home">Напомнить</button>
              </article>
            `
          )
          .join("")
      : renderShowcaseEmpty("Никто ничего не должен. Этот сбор уже закрыт.");
  }

  const notificationsList = document.getElementById("showcase-notifications-list");
  if (notificationsList) {
    notificationsList.innerHTML = state.notifications.length
      ? state.notifications.slice(0, 3).map((notification, index) => renderShowcaseNotificationRow(notification, index)).join("")
      : renderShowcaseEmpty("Новых уведомлений пока нет.");
  }

  const paymentMethods = document.getElementById("showcase-payment-methods");
  if (paymentMethods) {
    const activeMethods = state.paymentMethods.filter((method) => method.status === "active").slice(0, 2);
    const cards = activeMethods.map(
      (method) => `
        <article class="mock-payment-card">
          <div class="mock-card-chip"></div>
          <div>
            <strong>${escapeHtml(method.maskedPan)}</strong>
            <p>${escapeHtml(method.isDefault ? "Основная карта" : paymentMethodStatusLabel(method.status))}</p>
          </div>
        </article>
      `
    );
    cards.push(`
      <article class="mock-payment-card is-add">
        <div class="mock-add-icon" aria-hidden="true"></div>
        <p>Добавить карту</p>
      </article>
    `);
    paymentMethods.innerHTML = cards.join("");
  }
}

function renderShowcaseExpenseRow(expense) {
  const category = inferExpenseCategory(expense.title);
  const { icon, tone } = showcaseExpenseVisual(expense.title);
  return `
    <article class="showcase-expense-row">
      <span class="showcase-expense-icon ${tone}">${icon}</span>
      <div>
        <div class="showcase-expense-row-title">${escapeHtml(expense.title)}</div>
        <div class="showcase-expense-row-subtitle">${escapeHtml(category)}</div>
      </div>
      <strong>${formatMoney(expense.amountMinor)}</strong>
    </article>
  `;
}

function renderShowcaseNotificationRow(notification, index) {
  const badgeClass = index === 0 ? "" : index === 1 ? " is-warn" : " is-muted";
  const badgeLabel = index === 0 ? "✓" : index === 1 ? "!" : "+";
  return `
    <article class="mock-notification-row">
      <div class="mock-notification-main">
        <span class="showcase-avatar-chip" style="${showcaseAvatarStyle(index + 4)}">${escapeHtml(initials(notification.title))}</span>
        <div class="mock-notification-meta">
          <strong>${escapeHtml(notification.title)}</strong>
          <p>${escapeHtml(formatNotificationTime(notification.createdAt))}</p>
        </div>
      </div>
      <span class="mock-status-badge${badgeClass}">${badgeLabel}</span>
    </article>
  `;
}

function renderShowcaseEmpty(copy) {
  return `<article class="showcase-expense-row"><div class="showcase-expense-row-subtitle">${escapeHtml(copy)}</div></article>`;
}

function showcaseAvatarStyle(index) {
  const gradients = [
    "background: linear-gradient(145deg, #ffcb9c, #79c9ff);",
    "background: linear-gradient(145deg, #f8a3a3, #f7d38a);",
    "background: linear-gradient(145deg, #92f3ba, #5db8ff);",
    "background: linear-gradient(145deg, #f2b680, #bd8dff);",
    "background: linear-gradient(145deg, #ffc5d2, #8cc8ff);"
  ];
  return gradients[index % gradients.length];
}

function inferExpenseCategory(title) {
  const value = String(title ?? "").toLowerCase();
  if (value.includes("мяс") || value.includes("шашлык")) {
    return "Еда";
  }
  if (value.includes("овощ") || value.includes("зел")) {
    return "Овощи";
  }
  if (value.includes("напит") || value.includes("сок") || value.includes("вода")) {
    return "Напитки";
  }
  if (value.includes("уголь") || value.includes("розжиг")) {
    return "Для мангала";
  }
  if (value.includes("соус") || value.includes("спец")) {
    return "Соусы";
  }
  if (value.includes("хлеб") || value.includes("лаваш")) {
    return "Выпечка";
  }
  return "Все";
}

function showcaseExpenseVisual(title) {
  const value = String(title ?? "").toLowerCase();
  if (value.includes("мяс") || value.includes("шашлык")) {
    return { icon: "🥩", tone: "" };
  }
  if (value.includes("овощ") || value.includes("зел")) {
    return { icon: "🥬", tone: "fresh" };
  }
  if (value.includes("напит") || value.includes("сок") || value.includes("вода")) {
    return { icon: "🥤", tone: "drink" };
  }
  if (value.includes("уголь") || value.includes("розжиг")) {
    return { icon: "🔥", tone: "fire" };
  }
  if (value.includes("соус") || value.includes("спец")) {
    return { icon: "🥫", tone: "sauce" };
  }
  if (value.includes("хлеб") || value.includes("лаваш")) {
    return { icon: "🥖", tone: "bread" };
  }
  return { icon: "•", tone: "" };
}

function truncateText(value, length) {
  const source = String(value ?? "");
  if (source.length <= length) {
    return source;
  }
  return `${source.slice(0, Math.max(0, length - 1))}…`;
}

function renderBootSkeletons() {
  const skeletonCard = `
    <article class="collection-card skeleton-card" aria-hidden="true">
      <div class="skeleton-line skeleton-line-title"></div>
      <div class="skeleton-line skeleton-line-copy"></div>
      <div class="skeleton-track"></div>
      <div class="skeleton-row">
        <span></span>
        <span></span>
      </div>
    </article>
  `;
  const bento = document.getElementById("home-bento-grid");
  const dueList = document.getElementById("home-due-list");
  const organizerList = document.getElementById("home-organizer-list");
  const notificationsList = document.getElementById("home-notifications-list");

  if (bento) {
    bento.innerHTML = `
      <article class="bento-item bento-item-large skeleton-card" aria-hidden="true"></article>
      <article class="bento-item skeleton-card" aria-hidden="true"></article>
      <article class="bento-item skeleton-card" aria-hidden="true"></article>
    `;
  }
  if (dueList) {
    dueList.innerHTML = skeletonCard;
  }
  if (organizerList) {
    organizerList.innerHTML = `${skeletonCard}${skeletonCard}`;
  }
  if (notificationsList) {
    notificationsList.innerHTML = `
      <article class="notification-card skeleton-card" aria-hidden="true">
        <div class="skeleton-line skeleton-line-title"></div>
        <div class="skeleton-line skeleton-line-copy"></div>
      </article>
    `;
  }

  const showcaseExpenses = document.getElementById("showcase-expenses-list");
  const showcaseDebts = document.getElementById("showcase-debt-list");
  const showcaseNotifications = document.getElementById("showcase-notifications-list");
  const showcasePayments = document.getElementById("showcase-payment-methods");
  if (showcaseExpenses) {
    showcaseExpenses.innerHTML = `${renderShowcaseEmpty("Загружаем расходы...")}${renderShowcaseEmpty("Загружаем расходы...")}`;
  }
  if (showcaseDebts) {
    showcaseDebts.innerHTML = `${renderShowcaseEmpty("Готовим список должников...")}${renderShowcaseEmpty("Готовим список должников...")}`;
  }
  if (showcaseNotifications) {
    showcaseNotifications.innerHTML = `${renderShowcaseEmpty("Подтягиваем уведомления...")}`;
  }
  if (showcasePayments) {
    showcasePayments.innerHTML = `${renderShowcaseEmpty("Проверяем методы оплаты...")}`;
  }
}

function renderScreenDependents() {
  if (state.currentScreen === "inbox") {
    renderInboxScreen();
  }
  if (state.currentScreen === "collections") {
    renderCollectionsScreen();
  }
  if (state.currentScreen === "collection") {
    renderCollectionScreen();
  }
  if (state.currentScreen === "pay") {
    renderPayScreen();
  }
  if (state.currentScreen === "organizer") {
    renderOrganizerScreen();
  }
}

function renderHome() {
  text("home-user-name", state.me?.displayName ?? "Алексей");
  text("home-user-avatar", initials(state.me?.displayName ?? "Алексей"));
  text("home-due-note", `${state.dueBundles.length} активных сборов`);
  text("home-organizer-note", `${state.organizerBundles.length} сборов под контролем`);

  renderHomeBento();

  const dueList = document.getElementById("home-due-list");
  dueList.innerHTML = state.dueBundles.length
    ? state.dueBundles.slice(0, 2).map((bundle) => renderCollectionCard(bundle, { variant: "due", go: "collection", nav: "home" })).join("")
    : renderEmptyCard("Нет сборов, где нужно платить.");

  const organizerList = document.getElementById("home-organizer-list");
  organizerList.innerHTML = state.organizerBundles.length
    ? state.organizerBundles.slice(0, 2).map((bundle) => renderCollectionCard(bundle, { variant: "organizer", go: "organizer", nav: "collections" })).join("")
    : renderEmptyCard("Организаторских сборов пока нет.");

  const homeNotifications = document.getElementById("home-notifications-list");
  homeNotifications.innerHTML = state.notifications.length
    ? state.notifications
        .slice(0, 3)
        .map((notification) => renderNotificationCard(notification, { compact: true }))
        .join("")
    : renderEmptyCard("Входящие пока пусты.");
}

function renderHomeBento() {
  const node = document.getElementById("home-bento-grid");
  if (!node) {
    return;
  }

  const dueTotalMinor = state.dueBundles.reduce((sum, bundle) => sum + Math.max(bundle.userDueMinor, 0), 0);
  const organizerTotalMinor = state.organizerBundles.reduce((sum, bundle) => sum + bundle.collection.totalAmountMinor, 0);
  const collectedMinor = state.organizerBundles.reduce((sum, bundle) => sum + bundle.collectedMinor, 0);
  const openDisputes = state.organizerBundles.reduce((sum, bundle) => sum + bundle.disputes.length, 0);
  const collectedPercent = organizerTotalMinor > 0 ? Math.round((collectedMinor / organizerTotalMinor) * 100) : 0;

  node.innerHTML = `
    <article class="bento-item bento-item-large">
      <span>К оплате</span>
      <strong>${formatMoney(dueTotalMinor)}</strong>
      <em>${state.dueBundles.length} активных сборов</em>
    </article>
    <article class="bento-item">
      <span>Собрано</span>
      <strong>${collectedPercent}%</strong>
      <em>${formatMoney(collectedMinor)}</em>
    </article>
    <article class="bento-item ${openDisputes ? "bento-item-alert" : "bento-item-calm"}">
      <span>Споры</span>
      <strong>${openDisputes}</strong>
      <em>${openDisputes ? "нужна реакция" : "чисто"}</em>
    </article>
  `;
}

function renderInboxScreen() {
  const list = document.getElementById("inbox-list");
  list.innerHTML = state.notifications.length
    ? state.notifications.map((notification) => renderNotificationCard(notification)).join("")
    : renderEmptyCard("Уведомлений пока нет.");
}

function renderCollectionsScreen() {
  const list = document.getElementById("collections-list");
  const summary = document.getElementById("collections-summary");
  collectionFilterTabs.forEach((tab) => tab.classList.toggle("is-selected", tab.getAttribute("data-collection-filter") === state.collectionsFilter));

  const participantBundles = state.collectionBundles.filter((bundle) => bundle.collection.organizerId !== state.me.id);
  const organizerBundles = state.collectionBundles.filter((bundle) => bundle.collection.organizerId === state.me.id);
  const activeParticipantBundles = participantBundles.filter((bundle) => !isHistoricalCollectionBundle(bundle));
  const historyParticipantBundles = participantBundles.filter((bundle) => isHistoricalCollectionBundle(bundle));
  const actionableBundles = activeParticipantBundles.filter((bundle) => isActionableCollectionBundle(bundle));
  const passiveBundles = activeParticipantBundles.filter((bundle) => !isActionableCollectionBundle(bundle));
  const liveOrganizerBundles = organizerBundles.filter((bundle) => !isHistoricalCollectionBundle(bundle));
  const archivedOrganizerBundles = organizerBundles.filter((bundle) => isHistoricalCollectionBundle(bundle));

  summary.innerHTML = `
    <article class="detail-panel">
      <div class="panel-title">Срез</div>
      <div class="line-item"><span>Активные</span><strong>${activeParticipantBundles.length}</strong></div>
      <div class="line-item"><span>История</span><strong>${historyParticipantBundles.length}</strong></div>
      <div class="line-item"><span>Организую</span><strong>${organizerBundles.length}</strong></div>
    </article>
  `;

  if (state.collectionsFilter === "active") {
    list.innerHTML =
      renderCollectionSection("Требуют действия", actionableBundles, "Оплата, согласование и ожидающие действия") +
      renderCollectionSection("Спокойные", sortBundles(passiveBundles), "Без срочных действий");
    if (!actionableBundles.length && !passiveBundles.length) {
      list.innerHTML = renderEmptyCard("Нет активных сборов.");
    }
    return;
  }

  if (state.collectionsFilter === "history") {
    const paidBundles = historyParticipantBundles.filter((bundle) => bundle.collection.status === "paid" || bundle.collection.status === "closed");
    const cancelledBundles = historyParticipantBundles.filter((bundle) => bundle.collection.status === "cancelled");
    list.innerHTML =
      renderCollectionSection("Завершенные", sortBundles(paidBundles), "Оплаченные и закрытые") +
      renderCollectionSection("Отмененные", sortBundles(cancelledBundles), "Сохранены для истории");
    if (!paidBundles.length && !cancelledBundles.length) {
      list.innerHTML = renderEmptyCard("История пока пустая.");
    }
    return;
  }

  list.innerHTML =
    renderCollectionSection("Живые сборы", sortBundles(liveOrganizerBundles), "Ты управляешь процессом") +
    renderCollectionSection("Архив организатора", sortBundles(archivedOrganizerBundles), "Закрытые и завершенные");
  if (!liveOrganizerBundles.length && !archivedOrganizerBundles.length) {
    list.innerHTML = renderEmptyCard("Организаторских сборов пока нет.");
  }
}

function renderCollectionScreen() {
  const bundle = getSelectedCollectionBundle();
  if (!bundle) {
    return;
  }

  const organizerName = state.userDirectory.get(bundle.collection.organizerId)?.displayName ?? "Организатор";
  text("collection-title", bundle.collection.title);
  text("collection-subtitle", `Организатор ${organizerName} · ${bundle.participants.length} участников`);
  text("collection-type-pill", labelizeCollectionType(bundle.collection.type));
  text("collection-balance-main", formatMoney(bundle.userDueMinor));
  text("collection-balance-sub", coveredParticipantsLabel(bundle.coveredParticipants));
  text("collection-progress-copy", `${formatMoney(bundle.collectedMinor)} / ${formatMoney(bundle.collection.totalAmountMinor)}`);
  text("collection-progress-percent", `${bundle.progressPercent}%`);
  text("collection-pay-button", bundle.userDueMinor > 0 ? `Оплатить ${formatMoney(bundle.userDueMinor)}` : "Уже оплачено");
  text("dispute-subtitle", bundle.collection.title);
  setProgress("collection-progress-fill", bundle.progressPercent);
  setCollectionBalancePill("collection-balance-pill", bundle.userDueMinor);

  const explanation = document.getElementById("collection-explanation-list");
  explanation.innerHTML = renderExplanation(bundle);

  const participantsList = document.getElementById("collection-participants-list");
  participantsList.innerHTML = bundle.participants
    .map((participant) => {
      const subLabel =
        participant.id === bundle.currentParticipant?.id
          ? coveredParticipantsLabel(bundle.coveredParticipants)
          : participant.paymentResponsibleParticipantId
            ? `Платит ${displayNameByParticipantId(bundle.participants, participant.paymentResponsibleParticipantId)}`
            : null;
      return renderParticipantRow(participant, subLabel);
    })
    .join("");

  const reviewButton = document.getElementById("collection-review-button");
  if (reviewButton) {
    const canConfirmReview =
      bundle.collection.status === "review" &&
      bundle.currentParticipant &&
      bundle.currentParticipant.status !== "confirmed";
    reviewButton.hidden = !canConfirmReview;
    reviewButton.textContent = canConfirmReview ? `Подтвердить ${formatMoney(bundle.userDueMinor || 0)}` : "Подтверждено";
  }

  const disputesList = document.getElementById("collection-disputes-list");
  disputesList.innerHTML = bundle.disputes.length
    ? bundle.disputes
        .map((dispute) => {
          const disputeParticipant = bundle.participants.find((participant) => participant.id === dispute.participantId);
          return `
            <div class="line-item">
              <span>${escapeHtml(disputeParticipant?.displayNameSnapshot ?? "Участник")}: ${escapeHtml(disputeStatusLabel(dispute.status))}</span>
              <strong>${escapeHtml(labelizeDisputeType(dispute.type))}</strong>
            </div>
          `;
        })
        .join("")
    : renderEmptyCard("Споров по этому сбору пока нет.");

  const auditNode = document.getElementById("collection-audit-log");
  if (auditNode) {
    const auditLog = state.auditLogByCollectionId.get(bundle.collection.id) ?? null;
    auditNode.innerHTML = renderAuditTimeline(auditLog, bundle);
  }
}

function renderPayScreen() {
  const bundle = getSelectedCollectionBundle();
  if (!bundle) {
    return;
  }

  text("pay-subtitle", bundle.collection.title);
  text("pay-balance-main", formatMoney(bundle.userDueMinor));
  text("pay-balance-sub", coveredParticipantsLabel(bundle.coveredParticipants));
  text(
    "pay-submit-button",
    bundle.userDueMinor > 0 ? `Продолжить к подтверждению ${formatMoney(bundle.userDueMinor)}` : "Уже оплачено"
  );
  text("pay-manual-button", bundle.userDueMinor > 0 ? `Пометить ${formatMoney(bundle.userDueMinor)}` : "Ручная оплата не нужна");
  renderPayMethods();

  const confirmNode = document.getElementById("pay-confirmation-panel");
  if (confirmNode) {
    confirmNode.innerHTML = renderPayConfirmationPanel(bundle);
  }

  const manualList = document.getElementById("pay-manual-payments-list");
  const ownManualPayments = bundle.manualPayments.filter((payment) => payment.payerUserId === state.me.id);
  manualList.innerHTML = ownManualPayments.length
    ? ownManualPayments
        .map(
          (payment) => `
            <div class="line-item">
              <span>${escapeHtml(manualPaymentMethodLabel(payment.method))} · ${escapeHtml(manualPaymentStatusLabel(payment.status))}</span>
              <strong>${formatMoney(payment.amountMinor)}</strong>
            </div>
          `
        )
        .join("")
    : renderEmptyCard("Здесь появятся ручные переводы, если ты отметишь оплату.");
}

function renderPayMethods() {
  const list = document.getElementById("pay-methods-list");
  const activeMethods = state.paymentMethods.filter((method) => method.status === "active");
  if (!activeMethods.length) {
    list.innerHTML = renderEmptyCard("Нет активной карты. Демо-привязка создастся автоматически.");
    return;
  }

  list.innerHTML = activeMethods
    .map((method) => {
      const selected = method.id === state.selectedPaymentMethodId;
      return `
        <button class="option-card${selected ? " selected" : ""}" type="button" data-payment-method-id="${method.id}">
          <div>
            <div class="card-title">${escapeHtml(paymentMethodTitle(method))}</div>
            <div class="card-subtitle">${escapeHtml(method.brand.toUpperCase())} · ${method.isDefault ? "основная" : "привязана"}</div>
          </div>
          ${selected ? '<span class="check-dot">✓</span>' : ""}
        </button>
      `;
    })
    .join("");
}

function renderOrganizerScreen() {
  const bundle = getSelectedOrganizerBundle();
  if (!bundle) {
    return;
  }

  text("organizer-title", bundle.collection.title);
  text("organizer-subtitle", `Ты организатор · ${bundle.participants.length} участников`);
  text("organizer-dispute-pill", `${bundle.disputes.length} споров`);
  text("organizer-collected-main", formatMoney(bundle.collectedMinor));
  text("organizer-remaining-main", formatMoney(Math.max(bundle.collection.totalAmountMinor - bundle.collectedMinor, 0)));
  text("organizer-status-note", labelizeCollectionStatus(bundle.collection.status));
  text(
    "organizer-calculate-button",
    bundle.expenses.length ? `Пересчитать (${bundle.expenses.length} расходов)` : "Пересчитать сбор"
  );
  text("organizer-review-button", bundle.calculation ? "Отправить на согласование" : "Сначала пересчитать");

  const attention = document.getElementById("organizer-attention-list");
  const items = [];
  for (const dispute of bundle.disputes) {
    const participant = bundle.participants.find((item) => item.id === dispute.participantId);
    items.push(`
      <div class="line-item">
        <span>${escapeHtml(participant?.displayNameSnapshot ?? "Участник")}: ${escapeHtml(dispute.message)}</span>
        <span class="pill pill-danger">спор</span>
      </div>
    `);
  }
  if (!items.length) {
    const pendingManual = bundle.manualPayments.filter((payment) => payment.status === "submitted");
    if (pendingManual.length) {
      for (const payment of pendingManual) {
        const payerName = displayNameByParticipantId(bundle.participants, payment.payerParticipantId);
        items.push(`
          <div class="line-item">
            <span>${escapeHtml(payerName)} отправил ручную оплату</span>
            <span class="pill pill-warn">подтверждение</span>
          </div>
        `);
      }
    } else {
      items.push(`
        <div class="line-item">
          <span>Все спокойно, споров и ручных подтверждений нет.</span>
          <span class="pill pill-success">ok</span>
        </div>
      `);
    }
  }
  attention.innerHTML = items.join("");

  const organizerDisputes = document.getElementById("organizer-disputes-list");
  organizerDisputes.innerHTML = bundle.disputes.length
    ? bundle.disputes
        .map((dispute) => {
          const participant = bundle.participants.find((item) => item.id === dispute.participantId);
          const actionButtons =
            dispute.status === "created" || dispute.status === "under_review"
              ? `
                  <div class="inline-actions">
                    <button class="mini-action primary" type="button" data-action="accept-dispute" data-dispute-id="${dispute.id}">Принять</button>
                    <button class="mini-action" type="button" data-action="resolve-dispute" data-dispute-id="${dispute.id}">Пересчитать</button>
                    <button class="mini-action danger" type="button" data-action="reject-dispute" data-dispute-id="${dispute.id}">Отклонить</button>
                  </div>
                `
              : "";
          return `
            <div class="dispute-card">
              <div class="line-item">
                <div class="line-item-copy">
                  <span>${escapeHtml(participant?.displayNameSnapshot ?? "Участник")} · ${escapeHtml(labelizeDisputeType(dispute.type))}</span>
                  <div class="section-note">${escapeHtml(dispute.message)}</div>
                </div>
                <strong>${escapeHtml(disputeStatusLabel(dispute.status))}</strong>
              </div>
              ${actionButtons}
            </div>
          `;
        })
        .join("")
    : renderEmptyCard("Активных споров нет.");

  if (organizerFriendSelect) {
    const availableFriends = state.friends.filter(
      (friend) => !bundle.participants.some((participant) => participant.linkedUserId === friend.userId)
    );
    organizerFriendSelect.innerHTML = availableFriends.length
      ? availableFriends
          .map((friend) => `<option value="${friend.userId}">${escapeHtml(friend.displayName)} · ${escapeHtml(friend.phone || "друг")}</option>`)
          .join("")
      : '<option value="">Нет друзей вне этого сбора</option>';
    organizerFriendSelect.disabled = !availableFriends.length;
  }

  if (organizerChildResponsibleSelect) {
    const eligiblePayers = bundle.participants.filter((participant) => participant.participantType !== "child");
    organizerChildResponsibleSelect.innerHTML = eligiblePayers.length
      ? eligiblePayers.map((participant) => `<option value="${participant.id}">${escapeHtml(participant.displayNameSnapshot)}</option>`).join("")
      : '<option value="">Сначала добавь взрослого участника</option>';
    organizerChildResponsibleSelect.disabled = !eligiblePayers.length;
  }

  const organizerParticipants = document.getElementById("organizer-participants-list");
  organizerParticipants.innerHTML = bundle.participants.length
    ? bundle.participants.map((participant) => renderOrganizerParticipantCard(bundle, participant)).join("")
    : renderEmptyCard("Участников пока нет.");

  const organizerExpenses = document.getElementById("organizer-expenses-list");
  organizerExpenses.innerHTML = bundle.expenses.length
    ? bundle.expenses.map((expense) => renderOrganizerExpenseCard(bundle, expense)).join("")
    : renderEmptyCard("Расходов пока нет.");

  renderOrganizerExpenseDraft();

  const organizerTransferPlan = document.getElementById("organizer-transfer-plan");
  organizerTransferPlan.innerHTML = bundle.calculation?.result.transferPlan.length
    ? bundle.calculation.result.transferPlan
        .map((transfer) => {
          const fromName = displayNameByParticipantId(bundle.participants, transfer.fromResponsiblePayerId);
          const toName = displayNameByParticipantId(bundle.participants, transfer.toResponsiblePayerId);
          return `
            <div class="line-item">
              <span>${escapeHtml(fromName)} → ${escapeHtml(toName)}</span>
              <strong>${formatMoney(transfer.amountMinor)}</strong>
            </div>
          `;
        })
        .join("")
    : renderEmptyCard("После расчета здесь появятся переводы.");

  const organizerManualPayments = document.getElementById("organizer-manual-payments-list");
  organizerManualPayments.innerHTML = bundle.manualPayments.length
    ? bundle.manualPayments
        .map((payment) => {
          const payerName = displayNameByParticipantId(bundle.participants, payment.payerParticipantId);
          const receiverName = displayNameByParticipantId(bundle.participants, payment.receiverParticipantId);
          const actions =
            payment.status === "submitted"
              ? `
                  <div class="inline-actions">
                    <button class="mini-action primary" type="button" data-action="confirm-manual-payment" data-manual-payment-id="${payment.id}">Подтвердить</button>
                    <button class="mini-action danger" type="button" data-action="reject-manual-payment" data-manual-payment-id="${payment.id}">Отклонить</button>
                  </div>
                `
              : "";
          return `
            <div class="dispute-card">
              <div class="line-item">
                <div class="line-item-copy">
                  <span>${escapeHtml(payerName)} → ${escapeHtml(receiverName)}</span>
                  <div class="section-note">${escapeHtml(manualPaymentMethodLabel(payment.method))}${payment.comment ? ` · ${escapeHtml(payment.comment)}` : ""}</div>
                </div>
                <strong>${escapeHtml(manualPaymentStatusLabel(payment.status))}</strong>
              </div>
              ${payment.proofUrl ? `<div class="section-note">${escapeHtml(payment.proofUrl)}</div>` : ""}
              ${actions}
            </div>
          `;
        })
        .join("")
    : renderEmptyCard("Ручных оплат пока нет.");

  const autopaySummary = document.getElementById("organizer-autopay-summary");
  const autopayList = document.getElementById("organizer-autopay-list");
  const autopayConfirm = document.getElementById("organizer-autopay-confirmation");
  const preview = state.autopayPreviewByCollectionId.get(bundle.collection.id) ?? [];
  const executionSummary = state.autopayExecutionSummaryByCollectionId.get(bundle.collection.id) ?? null;
  const eligibleCount = preview.filter((item) => item.status === "eligible").length;
  const blockedCount = preview.filter((item) => item.status === "blocked").length;
  const existingCount = preview.filter((item) => item.status === "already_exists").length;

  autopaySummary.innerHTML = `
    <div class="line-item">
      <span>Готово к списанию</span>
      <strong>${eligibleCount}</strong>
    </div>
    <div class="line-item">
      <span>Заблокировано</span>
      <strong>${blockedCount}</strong>
    </div>
    <div class="line-item">
      <span>Уже создано</span>
      <strong>${existingCount}</strong>
    </div>
    ${executionSummary ? `
      <div class="line-item">
        <span>Последний запуск</span>
        <strong>${executionSummary.createdCount} создано / ${executionSummary.skippedCount} пропущено</strong>
      </div>
    ` : ""}
  `;

  autopayList.innerHTML = preview.length
    ? preview
        .map((item) => {
          const participantName = displayNameByParticipantId(bundle.participants, item.participantId);
          const responsibleName = displayNameByParticipantId(bundle.participants, item.responsibleParticipantId);
          const availableAt = item.availableAt ? ` · с ${formatNotificationTime(item.availableAt)}` : "";
          const note =
            item.status === "eligible"
              ? `${item.category ? `${escapeHtml(item.category)} · ` : ""}${escapeHtml(responsibleName)}${availableAt}`
              : `${escapeHtml(autoPaymentReasonLabel(item.reasonCode))}${availableAt}`;
          return `
            <div class="dispute-card">
              <div class="line-item">
                <div class="line-item-copy">
                  <span>${escapeHtml(participantName)} → ${escapeHtml(responsibleName)}</span>
                  <div class="section-note">${note}</div>
                </div>
                <strong>${formatMoney(item.amountMinor)}</strong>
              </div>
              <div class="line-item">
                <span>${escapeHtml(item.reason)}</span>
                <span class="pill ${autoPaymentPreviewPillClass(item.status)}">${escapeHtml(autoPaymentPreviewStatusLabel(item.status))}</span>
              </div>
            </div>
          `;
        })
        .join("")
    : renderEmptyCard("Предпросмотр автоплатежей появится после расчета и настройки правил.");

  if (autopayConfirm) {
    autopayConfirm.innerHTML = renderAutopayConfirmationPanel(bundle, preview);
  }

  const auditNode = document.getElementById("organizer-audit-log");
  if (auditNode) {
    const auditLog = state.auditLogByCollectionId.get(bundle.collection.id) ?? null;
    auditNode.innerHTML = renderAuditTimeline(auditLog, bundle);
  }
}

function renderOrganizerExpenseDraft() {

  const draftNode = document.getElementById("organizer-expense-items-draft");
  if (!draftNode) {
    return;
  }

  if (!state.draftExpenseItems.length) {
    draftNode.innerHTML = renderEmptyCard("Добавь позиции чека, если нужно разделение по позициям.");
    return;
  }

  const totalMinor = state.draftExpenseItems.reduce((sum, item) => sum + item.amountMinor, 0);
  draftNode.innerHTML = `
    <article class="detail-panel">
      <div class="panel-title">Черновик чека по позициям</div>
      ${state.draftExpenseItems
        .map(
          (item) => `
            <div class="line-item">
              <span>${escapeHtml(item.title)}</span>
              <strong>${formatMoney(item.amountMinor)}</strong>
            </div>
          `
        )
        .join("")}
      <div class="line-item">
        <span>Итого по позициям</span>
        <strong>${formatMoney(totalMinor)}</strong>
      </div>
    </article>
  `;
}

function renderOrganizerParticipantCard(bundle, participant) {
  const role = participantRoleLabel(bundle, participant);
  const responsiblePayerName = participant.paymentResponsibleParticipantId
    ? displayNameByParticipantId(bundle.participants, participant.paymentResponsibleParticipantId)
    : null;
  const payerOptions = buildResponsiblePayerOptions(bundle.participants, participant.id);
  const relationshipOptions = buildRelationshipHintOptions(participant.relationshipHint);
  const presetButtons = renderParticipantPresetButtons(participant.id);

  return `
    <div class="dispute-card">
      <div class="line-item">
        <div class="line-item-copy">
          <span>${escapeHtml(participant.displayNameSnapshot)} · ${escapeHtml(role)}</span>
          <div class="section-note">${responsiblePayerName ? `За него платит ${escapeHtml(responsiblePayerName)}` : "Платит сам за себя"}</div>
        </div>
        <strong>${escapeHtml(paymentStatusLabel(participant.paymentStatus))}</strong>
      </div>
      <div class="inline-actions">
        <select id="participant-responsible-${participant.id}" class="text-input compact-select">${payerOptions}</select>
        <button class="mini-action" type="button" data-action="set-responsible-payer" data-participant-id="${participant.id}">Сохранить плательщика</button>
      </div>
      <div class="inline-actions preset-row">
        ${presetButtons}
      </div>
      <div class="inline-actions">
        <select id="participant-relationship-${participant.id}" class="text-input compact-select">${relationshipOptions}</select>
        <input id="participant-weight-${participant.id}" class="text-input compact-select" inputmode="decimal" value="${escapeHtml(String(participant.defaultWeight ?? 1))}" />
        <button class="mini-action primary" type="button" data-action="save-participant-profile" data-participant-id="${participant.id}">Сохранить профиль</button>
      </div>
    </div>
  `;
}

function buildResponsiblePayerOptions(participants, participantId) {
  const current = participants.find((participant) => participant.id === participantId) ?? null;
  const eligible = participants.filter((participant) => participant.id !== participantId && participant.participantType !== "child");
  const selectedId = current?.paymentResponsibleParticipantId ?? "";
  const selfOption = `<option value=""${selectedId === "" ? " selected" : ""}>Платит сам</option>`;
  const payerOptions = eligible
    .map(
      (participant) =>
        `<option value="${participant.id}"${selectedId === participant.id ? " selected" : ""}>${escapeHtml(participant.displayNameSnapshot)}</option>`
    )
    .join("");
  return selfOption + payerOptions;
}

function renderParticipantPresetButtons(participantId) {
  const presets = [
    { label: "Ребенок 0.5", relationshipHint: "child", defaultWeight: "0.5" },
    { label: "Партнер 1", relationshipHint: "partner", defaultWeight: "1" },
    { label: "Гость 1", relationshipHint: "guest", defaultWeight: "1" },
    { label: "Семья 1", relationshipHint: "family", defaultWeight: "1" }
  ];

  return presets
    .map(
      (preset) =>
        `<button class="mini-action" type="button" data-action="apply-participant-preset" data-participant-id="${participantId}" data-relationship-hint="${preset.relationshipHint}" data-default-weight="${preset.defaultWeight}">${escapeHtml(preset.label)}</button>`
    )
    .join("");
}

function buildRelationshipHintOptions(selected) {
  const options = [
    ["self", "Сам"],
    ["partner", "Партнер"],
    ["child", "Ребенок"],
    ["guest", "Гость"],
    ["family", "Семья"],
    ["colleague", "Коллега"],
    ["other", "Другое"]
  ];
  return options
    .map(([value, label]) => `<option value="${value}"${selected === value ? " selected" : ""}>${escapeHtml(label)}</option>`)
    .join("");
}

function participantRoleLabel(bundle, participant) {
  if (participant.linkedUserId === bundle.collection.organizerId) {
    return "Организатор";
  }
  if (participant.participantType === "child") {
    return "Ребенок";
  }
  if (participant.participantType === "guest") {
    return "Гость";
  }
  return "Участник";
}

function renderOrganizerExpenseCard(bundle, expense) {
  const expenseItems = expense.items ?? [];
  const shareRules = expense.shareRules ?? [];
  const participantOptions = bundle.participants
    .map((participant) => `<option value="${participant.id}">${escapeHtml(participant.displayNameSnapshot)}</option>`)
    .join("");
  const itemsMarkup = expenseItems.length
    ? expenseItems
        .map((item) => {
          const exclusions = shareRules.filter((rule) => rule.expenseItemId === item.id && rule.splitMode === "excluded");
          return `
            <div class="mini-section">
              <div class="line-item">
                <span>${escapeHtml(item.title)}</span>
                <strong>${formatMoney(item.amountMinor)}</strong>
              </div>
              ${
                exclusions.length
                  ? exclusions
                      .map(
                        (rule) => `
                          <div class="line-item muted">
                            <span>${escapeHtml(displayNameByParticipantId(bundle.participants, rule.participantId))}</span>
                            <em>${escapeHtml(rule.reason ?? "excluded")}</em>
                          </div>
                        `
                      )
                      .join("")
                  : '<div class="line-item muted"><span>Без item-level исключений</span><em>ok</em></div>'
              }
              <button class="mini-action" type="button" data-action="exclude-expense-item" data-expense-id="${expense.id}" data-expense-item-id="${item.id}">Исключить для выбранного</button>
            </div>
          `;
        })
        .join("")
    : '<div class="line-item muted"><span>Позиции чека не заданы</span><em>равное деление</em></div>';

  return `
    <article class="detail-panel bottom-gap">
      <div class="line-item">
        <div class="line-item-copy">
          <span>${escapeHtml(expense.title)}</span>
          <div class="section-note">${expenseItems.length ? `${expenseItems.length} позиций` : "без itemization"}</div>
        </div>
        <strong>${formatMoney(expense.amountMinor)}</strong>
      </div>
      ${itemsMarkup}
      <div class="mini-section">
        <label class="field-label" for="expense-item-title-${expense.id}">Новая позиция</label>
        <input id="expense-item-title-${expense.id}" class="text-input" placeholder="Например, десерт" />
      </div>
      <div class="mini-section">
        <label class="field-label" for="expense-item-amount-${expense.id}">Сумма позиции, ₽</label>
        <input id="expense-item-amount-${expense.id}" class="text-input" inputmode="decimal" placeholder="300" />
      </div>
      <button class="secondary-button" type="button" data-action="add-expense-item" data-expense-id="${expense.id}">Добавить позицию</button>
      ${
        expenseItems.length
          ? `
            <div class="mini-section">
              <label class="field-label" for="expense-rule-participant-${expense.id}">Исключить участника из выбранной позиции</label>
              <select id="expense-rule-participant-${expense.id}" class="text-input">${participantOptions}</select>
            </div>
            <div class="mini-section">
              <label class="field-label" for="expense-rule-reason-${expense.id}">Причина</label>
              <input id="expense-rule-reason-${expense.id}" class="text-input" placeholder="Например, не пил вино" />
            </div>
          `
          : ""
      }
    </article>
  `;
}

function renderFriendsScreen() {
  const list = document.getElementById("friends-list");
  list.innerHTML = state.friends.length
    ? state.friends
        .map(
          (friend, index) => `
            <div class="friend-row">
              <div class="avatar ${avatarTone(index)}">${escapeHtml(initials(friend.displayName))}</div>
              <div class="person-meta">
                <div class="person-name">${escapeHtml(friend.displayName)}</div>
                <div class="person-sub">${friend.sharedCollections} общих сборов</div>
              </div>
              <span class="${index === 0 ? "status-chip online" : "pill pill-muted"}">${index === 0 ? "" : "готово"}</span>
            </div>
          `
        )
        .join("")
    : renderEmptyCard("Пока нет друзей. Демо-участники будут добавлены автоматически.");
}

function renderGroupsScreen() {
  const list = document.getElementById("groups-list");
  list.innerHTML = state.groups.length
    ? state.groups
        .map(
          (group, index) => `
            <button class="group-card" type="button">
              <div class="group-icon ${groupTone(index)}">${escapeHtml(initials(group.title))}</div>
              <div class="group-copy">
                <div class="group-name">${escapeHtml(group.title)}</div>
                <div class="group-sub">${escapeHtml(labelizeGroupType(group.groupType))}</div>
              </div>
              ${index === 0 ? '<span class="pill pill-danger">live</span>' : ""}
            </button>
          `
        )
        .join("")
    : renderEmptyCard("Групп пока нет.");
}

function renderProfileScreen() {
  text("profile-avatar", initials(state.me?.displayName ?? "Алексей"));
  text("profile-name", state.me?.displayName ?? "Алексей");
  text("profile-phone", state.me?.phone ?? "");

  const profilePanels = [...document.querySelectorAll('[data-screen="profile"] .detail-panel')];
  const paymentPanel = profilePanels[0];
  const frequentPanel = profilePanels[1];
  const autopayPanel = profilePanels[2];

  if (paymentPanel) {
    paymentPanel.innerHTML = `
      <div class="panel-title">Оплата</div>
      <div id="profile-payment-methods-list">
        ${renderProfilePaymentMethods()}
      </div>
      <div class="form-block">
        <label class="field-label" for="profile-card-mask">Тестовая карта</label>
        <input class="text-input" id="profile-card-mask" placeholder="2200 **** **** 4821" />
      </div>
      <div class="chip-wrap">
        <button class="chip is-selected" type="button" data-card-brand="mir">Mir</button>
        <button class="chip" type="button" data-card-brand="visa">Visa</button>
        <button class="chip" type="button" data-card-brand="mastercard">Mastercard</button>
      </div>
      <button class="secondary-button" type="button" data-action="create-payment-setup">Начать привязку</button>
    `;
  }

  if (frequentPanel) {
    frequentPanel.innerHTML = `
      <div class="panel-title">Часто участвующие</div>
      <div id="profile-frequent-list">
        ${renderProfileFrequentPeople()}
      </div>
    `;
  }

  if (autopayPanel) {
    const globalRule = getGlobalAutopayRule();
    autopayPanel.innerHTML = `
        <div class="panel-title">Автоплата</div>
        <div id="profile-autopay-rules-list">
          ${renderProfileAutopayRules()}
        </div>
        <div class="setting-row">
          <div>
            <div class="setting-title">Включить правило</div>
            <div class="setting-sub">Общее правило для новых сборов</div>
          </div>
          <button class="switch${globalRule?.enabled ? " is-on" : ""}" id="profile-autopay-enabled" type="button"><span></span></button>
        </div>
        <div class="consent-card">
          <div class="setting-row">
            <div class="switch-copy">
              <div class="setting-title">Согласие на автосписания</div>
              <div class="setting-sub">Разрешаю запускать автоматические списания после окна возражений и в пределах лимита.</div>
            </div>
            <button class="switch${globalRule?.enabled ? " is-on" : ""}" id="profile-autopay-consent" type="button"><span></span></button>
          </div>
        </div>
        <div class="form-block">
          <label class="field-label" for="profile-autopay-limit">Лимит на сбор, ₽</label>
          <input class="text-input" id="profile-autopay-limit" inputmode="decimal" value="${escapeHtml(String((globalRule?.singleCollectionLimitMinor ?? 150000) / 100))}" />
        </div>
        <div class="form-block">
          <label class="field-label" for="profile-autopay-window">Окно возражений, часы</label>
          <input class="text-input" id="profile-autopay-window" inputmode="numeric" value="${escapeHtml(String(globalRule?.objectionWindowHours ?? 24))}" />
        </div>
        <button class="secondary-button" type="button" data-action="save-autopay-rule">Сохранить правило</button>
      `;
    }
  }

async function submitPayment() {
  const bundle = getSelectedCollectionBundle();
  if (!bundle || !bundle.currentParticipant || bundle.userDueMinor <= 0) {
    return;
  }

  const confirmed = document.getElementById("pay-confirm-switch")?.classList.contains("is-on") ?? false;
  if (!confirmed) {
    setStatus("Подтверди списание перед оплатой", false);
    haptic("warning");
    return;
  }

  let paymentMethodId = state.selectedPaymentMethodId;
  if (!paymentMethodId) {
    const createdMethod = await fetchJson("/payment-methods/mock-bind", {
      method: "POST",
      token: state.session.accessToken,
      body: {
        provider: "bank",
        maskedPan: "2200 **** **** 4821",
        brand: "mir",
        setAsDefault: true
      }
    });
    paymentMethodId = createdMethod.id;
  }

  const payment = await fetchJson(`/collections/${bundle.collection.id}/payments/mock-intents`, {
    method: "POST",
    token: state.session.accessToken,
    body: {
      participantId: bundle.currentParticipant.id,
      amountMinor: bundle.userDueMinor,
      paymentMethodId,
      provider: "bank",
      idempotencyKey: `frontend-pay-${bundle.collection.id}-${bundle.currentParticipant.id}`
    }
  });

  await fetchJson(`/payments/${payment.id}/simulate-success`, {
    method: "POST",
    token: state.session.accessToken
  });

  state.pendingPayConfirmationCollectionId = null;
  state.lastPaymentSummary = {
    collectionTitle: bundle.collection.title,
    amountMinor: bundle.userDueMinor
  };

  await refreshAppData();
  renderAll();

  const updatedBundle = getSelectedCollectionBundle();
  if (updatedBundle) {
    text("paid-success-copy", `${formatMoney(state.lastPaymentSummary.amountMinor)} переведены по сбору «${state.lastPaymentSummary.collectionTitle}».`);
    text("paid-progress-copy", `${formatMoney(updatedBundle.collectedMinor)} / ${formatMoney(updatedBundle.collection.totalAmountMinor)}`);
    text("paid-progress-tail", updatedBundle.progressPercent === 100 ? "Сбор закрыт" : `Осталось ${formatMoney(updatedBundle.collection.totalAmountMinor - updatedBundle.collectedMinor)}`);
    setProgress("paid-progress-fill", updatedBundle.progressPercent);
  }

  setActiveScreen("paid", "home");
}

async function submitDispute() {

  const bundle = getSelectedCollectionBundle();
  const message = disputeCommentInput?.value?.trim();
  if (!bundle || !bundle.currentParticipant || !message) {
    return;
  }

  await fetchJson(`/collections/${bundle.collection.id}/disputes`, {
    method: "POST",
    token: state.session.accessToken,
    body: {
      participantId: bundle.currentParticipant.id,
      type: getSelectedDisputeType(),
      message
    }
  });

  disputeCommentInput.value = "";
  await refreshAppData();
  renderAll();
  setActiveScreen("dispute-sent", "home");
}

async function deprecatedConfirmCurrentParticipantReview() {
  const bundle = getSelectedCollectionBundle();
  if (!bundle?.currentParticipant) {
    return;
  }

  await fetchJson(`/collections/${bundle.collection.id}/participants/${bundle.currentParticipant.id}/confirm-review`, {
    method: "POST",
    token: state.session.accessToken
  });

  await refreshAppData();
  renderAll();
  renderScreenDependents();
  setStatus("Review подтвержден", true);
  return;
  if (draftItems.length) {
    setStatus(`Расход по позициям «${title}» добавлен`, true);
    return;
  }
  setStatus("Review подтвержден", true);
}

async function markManualPaymentFromUi() {
  const bundle = getSelectedCollectionBundle();
  const transferPlan = getCurrentUserTransfers(bundle);
  if (!bundle?.currentParticipant || !transferPlan.length) {
    setStatus("Нет ручного перевода для подтверждения", false);
    return;
  }

  const method = getSelectedManualPaymentMethod();
  const proofUrl = payManualProofUrlInput?.value?.trim() || null;
  const comment = payManualCommentInput?.value?.trim() || null;

  for (const [index, transfer] of transferPlan.entries()) {
    await fetchJson(`/collections/${bundle.collection.id}/manual-payments/mark-paid`, {
      method: "POST",
      token: state.session.accessToken,
      body: {
        payerParticipantId: bundle.currentParticipant.id,
        receiverParticipantId: transfer.toResponsiblePayerId,
        amountMinor: transfer.amountMinor,
        method,
        comment,
        proofUrl,
        idempotencyKey: `frontend-manual-${bundle.collection.id}-${bundle.currentParticipant.id}-${transfer.toResponsiblePayerId}-${index}`
      }
    });
  }

  if (payManualProofUrlInput) {
    payManualProofUrlInput.value = "";
  }
  if (payManualCommentInput) {
    payManualCommentInput.value = "";
  }

  await refreshAppData();
  renderAll();
  renderScreenDependents();
  setStatus("Ручная оплата отправлена на подтверждение", true);
}

async function createCollectionFromForm() {
  const title = collectionNameInput?.value?.trim();
  if (!title) {
    setStatus("Укажи название сбора", false);
    return;
  }

  const createdCollection = await fetchJson("/collections", {
    method: "POST",
    token: state.session.accessToken,
    body: {
      title,
      type: getSelectedCollectionType(),
      paymentMode: "manual"
    }
  });

  await fetchJson(`/collections/${createdCollection.id}/participants`, {
    method: "POST",
    token: state.session.accessToken,
    body: {
      linkedUserId: state.me.id,
      displayName: state.me.displayName
    }
  });

  if (collectionNameInput) {
    collectionNameInput.value = "";
  }

  await refreshAppData();
  state.selectedCollectionId = createdCollection.id;
  state.selectedOrganizerCollectionId = createdCollection.id;
  renderAll();
  setActiveScreen("organizer", "collections");
  renderScreenDependents();
  setStatus(`Создан сбор «${createdCollection.title}»`, true);
  triggerCompletionFeedback();
}

async function inviteFriendFromForm() {
  const phone = friendPhoneInput?.value?.trim();
  if (!phone) {
    setStatus("Укажи номер друга", false);
    return;
  }

  const friendship = await fetchJson("/friends/invite", {
    method: "POST",
    token: state.session.accessToken,
    body: { phone }
  });

  const matchedActor = Object.entries(DEMO).find(([, actor]) => actor.phone === phone);
  if (matchedActor) {
    const [actorKey] = matchedActor;
    await fetchJson(`/friends/${friendship.id}/accept`, {
      method: "POST",
      token: state.actors[actorKey].accessToken
    });
  }

  if (friendPhoneInput) {
    friendPhoneInput.value = "";
  }

  await refreshAppData();
  renderAll();
  setStatus(matchedActor ? "Друг добавлен и подтвержден" : "Приглашение другу отправлено", true);
}

async function createGroupFromForm() {
  const title = groupNameInput?.value?.trim();
  if (!title) {
    setStatus("Укажи название группы", false);
    return;
  }

  const group = await fetchJson("/groups", {
    method: "POST",
    token: state.session.accessToken,
    body: {
      title,
      groupType: "other"
    }
  });

  if (groupNameInput) {
    groupNameInput.value = "";
  }

  await refreshAppData();
  renderAll();
  setStatus(`Создана группа «${group.title}»`, true);
}

async function addCollectionFriend() {
  const bundle = getSelectedOrganizerBundle();
  const linkedUserId = organizerFriendSelect?.value;
  if (!bundle || !linkedUserId) {
    setStatus("Выбери друга для добавления", false);
    return;
  }

  const friend = state.friends.find((item) => item.userId === linkedUserId);
  await fetchJson(`/collections/${bundle.collection.id}/participants`, {
    method: "POST",
    token: state.session.accessToken,
    body: {
      linkedUserId,
      displayName: friend?.displayName ?? "Участник"
    }
  });

  await refreshAppData();
  renderAll();
  renderScreenDependents();
  setStatus(friend ? `${friend.displayName} добавлен в сбор` : "Участник добавлен", true);
}

async function addCollectionGuest() {
  const bundle = getSelectedOrganizerBundle();
  const displayName = organizerGuestNameInput?.value?.trim();
  if (!bundle || !displayName) {
    setStatus("Укажи имя гостя", false);
    return;
  }

  await fetchJson(`/collections/${bundle.collection.id}/participants/add-guest`, {
    method: "POST",
    token: state.session.accessToken,
    body: { displayName }
  });

  if (organizerGuestNameInput) {
    organizerGuestNameInput.value = "";
  }

  await refreshAppData();
  renderAll();
  renderScreenDependents();
  setStatus(`Гость «${displayName}» добавлен`, true);
}

async function addCollectionChild() {
  const bundle = getSelectedOrganizerBundle();
  const displayName = organizerChildNameInput?.value?.trim();
  const responsiblePayerParticipantId = organizerChildResponsibleSelect?.value;
  if (!bundle || !displayName || !responsiblePayerParticipantId) {
    setStatus("Укажи ребенка и кто за него платит", false);
    return;
  }

  await fetchJson(`/collections/${bundle.collection.id}/participants/add-child`, {
    method: "POST",
    token: state.session.accessToken,
    body: {
      displayName,
      responsiblePayerParticipantId
    }
  });

  if (organizerChildNameInput) {
    organizerChildNameInput.value = "";
  }

  await refreshAppData();
  renderAll();
  renderScreenDependents();
  setStatus(`Ребенок «${displayName}» добавлен`, true);
}

async function setResponsiblePayerFromAction(source) {
  const bundle = getSelectedOrganizerBundle();
  const participantId = source?.getAttribute("data-participant-id");
  if (!bundle || !participantId) {
    return;
  }

  const select = document.getElementById(`participant-responsible-${participantId}`);
  const responsiblePayerParticipantId = select?.value || null;

  await fetchJson(`/collections/${bundle.collection.id}/participants/${participantId}/set-responsible-payer`, {
    method: "POST",
    token: state.session.accessToken,
    body: {
      responsiblePayerParticipantId
    }
  });

  await refreshAppData();
  renderAll();
  renderScreenDependents();
  setStatus("Ответственный плательщик обновлен", true);
}

async function updateParticipantProfileFromAction(source) {
  const bundle = getSelectedOrganizerBundle();
  const participantId = source?.getAttribute("data-participant-id");
  if (!bundle || !participantId) {
    return;
  }

  const relationshipSelect = document.getElementById(`participant-relationship-${participantId}`);
  const weightInput = document.getElementById(`participant-weight-${participantId}`);
  const relationshipHint = relationshipSelect?.value ?? "other";
  const defaultWeight = parseNumberInput(weightInput?.value, 1);
  if (!Number.isFinite(defaultWeight) || defaultWeight <= 0) {
    setStatus("Вес участника должен быть больше нуля", false);
    return;
  }

  await fetchJson(`/collections/${bundle.collection.id}/participants/${participantId}`, {
    method: "PATCH",
    token: state.session.accessToken,
    body: {
      relationshipHint,
      defaultWeight
    }
  });

  await refreshAppData();
  renderAll();
  renderScreenDependents();
  setStatus(`Профиль участника обновлен: ${relationshipHint}, вес ${defaultWeight}`, true);
}

async function applyParticipantPresetFromAction(source) {
  const participantId = source?.getAttribute("data-participant-id");
  const relationshipHint = source?.getAttribute("data-relationship-hint");
  const defaultWeight = source?.getAttribute("data-default-weight");
  if (!participantId || !relationshipHint || !defaultWeight) {
    return;
  }

  const relationshipSelect = document.getElementById(`participant-relationship-${participantId}`);
  const weightInput = document.getElementById(`participant-weight-${participantId}`);
  if (relationshipSelect) {
    relationshipSelect.value = relationshipHint;
  }
  if (weightInput) {
    weightInput.value = defaultWeight;
  }

  await updateParticipantProfileFromAction(source);
}

async function addCollectionExpense() {
  const bundle = getSelectedOrganizerBundle();
  const title = organizerExpenseTitleInput?.value?.trim();
  const draftItems = state.draftExpenseItems;
  const amountMinor = draftItems.length
    ? draftItems.reduce((sum, item) => sum + item.amountMinor, 0)
    : parseMoneyToMinor(organizerExpenseAmountInput?.value ?? "");
  if (!bundle || !title || amountMinor <= 0) {
    setStatus("Заполни название и сумму расхода", false);
    return;
  }

  await fetchJson(`/collections/${bundle.collection.id}/expenses`, {
    method: "POST",
    token: state.session.accessToken,
    body: {
      title,
      amountMinor,
      expenseType: "expense",
      items: draftItems.length
        ? draftItems.map((item) => ({
            title: item.title,
            amountMinor: item.amountMinor
          }))
        : undefined
    }
  });

  if (organizerExpenseTitleInput) {
    organizerExpenseTitleInput.value = "";
  }
  if (organizerExpenseAmountInput) {
    organizerExpenseAmountInput.value = "";
  }
  clearDraftExpenseItems({ silent: true });

  await refreshAppData();
  renderAll();
  renderScreenDependents();
  setStatus(`Расход «${title}» добавлен`, true);
}

function addDraftExpenseItem() {
  const title = organizerExpenseItemTitleInput?.value?.trim();
  const amountMinor = parseMoneyToMinor(organizerExpenseItemAmountInput?.value ?? "");
  if (!title || amountMinor <= 0) {
    setStatus("Заполни название и сумму позиции", false);
    return;
  }

  state.draftExpenseItems.push({
    id: `draft-${Date.now()}-${state.draftExpenseItems.length + 1}`,
    title,
    amountMinor
  });

  if (organizerExpenseItemTitleInput) {
    organizerExpenseItemTitleInput.value = "";
  }
  if (organizerExpenseItemAmountInput) {
    organizerExpenseItemAmountInput.value = "";
  }

  syncDraftExpenseAmount();
  renderOrganizerExpenseDraft();
  setStatus(`Позиция «${title}» добавлена в черновик`, true);
}

function clearDraftExpenseItems(options = {}) {
  state.draftExpenseItems = [];
  if (organizerExpenseItemTitleInput) {
    organizerExpenseItemTitleInput.value = "";
  }
  if (organizerExpenseItemAmountInput) {
    organizerExpenseItemAmountInput.value = "";
  }
  if (organizerExpenseAmountInput && !options.keepAmount) {
    organizerExpenseAmountInput.value = "";
  }
  renderOrganizerExpenseDraft();
  if (!options.silent) {
    setStatus("Черновик чека по позициям очищен", true);
  }
}

async function addExpenseItemToExistingExpense(source) {
  const expenseId = source?.getAttribute("data-expense-id");
  if (!expenseId) {
    return;
  }

  const titleInput = document.getElementById(`expense-item-title-${expenseId}`);
  const amountInput = document.getElementById(`expense-item-amount-${expenseId}`);
  const title = titleInput?.value?.trim();
  const amountMinor = parseMoneyToMinor(amountInput?.value ?? "");
  if (!title || amountMinor <= 0) {
    setStatus("Заполни название и сумму новой позиции", false);
    return;
  }

  await fetchJson(`/expenses/${expenseId}/items`, {
    method: "POST",
    token: state.session.accessToken,
    body: {
      title,
      amountMinor
    }
  });

  await refreshAppData();
  renderAll();
  renderScreenDependents();
  setStatus(`Позиция «${title}» добавлена в расход`, true);
}

async function excludeExpenseItemForParticipant(source) {
  const expenseId = source?.getAttribute("data-expense-id");
  const expenseItemId = source?.getAttribute("data-expense-item-id");
  if (!expenseId || !expenseItemId) {
    return;
  }

  const participantSelect = document.getElementById(`expense-rule-participant-${expenseId}`);
  const reasonInput = document.getElementById(`expense-rule-reason-${expenseId}`);
  const participantId = participantSelect?.value;
  if (!participantId) {
    setStatus("Выбери участника для item-level rule", false);
    return;
  }

  await fetchJson(`/expenses/${expenseId}/share-rules`, {
    method: "POST",
    token: state.session.accessToken,
    body: {
      participantId,
      expenseItemId,
      splitMode: "excluded",
      reason: reasonInput?.value?.trim() || "Исключено из сценария чека по позициям"
    }
  });

  await refreshAppData();
  renderAll();
  renderScreenDependents();
  setStatus("Item-level exclusion правило добавлено", true);
}

async function calculateSelectedCollection() {
  const bundle = getSelectedOrganizerBundle();
  if (!bundle) {
    return;
  }

  await fetchJson(`/collections/${bundle.collection.id}/calculate`, {
    method: "POST",
    token: state.session.accessToken
  });

  await refreshAppData();
  renderAll();
  renderScreenDependents();
  setStatus("Сбор пересчитан", true);
}

async function sendCollectionToReview() {
  const bundle = getSelectedOrganizerBundle();
  if (!bundle) {
    return;
  }

  if (!bundle.calculation) {
    setStatus("Сначала пересчитай сбор", false);
    return;
  }

  await fetchJson(`/collections/${bundle.collection.id}/send-to-review`, {
    method: "POST",
    token: state.session.accessToken
  });

  await refreshAppData();
  renderAll();
  renderScreenDependents();
  setStatus("Сбор отправлен на согласование", true);
}

async function updateDisputeFromAction(source, action) {
  const disputeId = source?.getAttribute("data-dispute-id");
  if (!disputeId) {
    return;
  }

  const pathByAction = {
    accept: `/disputes/${disputeId}/accept`,
    reject: `/disputes/${disputeId}/reject`,
    resolve: `/disputes/${disputeId}/resolve`
  };

  await fetchJson(pathByAction[action], {
    method: "POST",
    token: state.session.accessToken,
    body: {
      resolutionComment:
        action === "accept"
          ? "Organizer accepted from frontend"
          : action === "reject"
            ? "Organizer rejected from frontend"
            : "Organizer recalculated from frontend"
    }
  });

  await refreshAppData();
  renderAll();
  renderScreenDependents();
  setStatus(
    action === "accept" ? "Спор принят" : action === "reject" ? "Спор отклонен" : "Сбор пересчитан по спору",
    true
  );
}

async function updateManualPaymentFromAction(source, action) {
  const paymentId = source?.getAttribute("data-manual-payment-id");
  if (!paymentId) {
    return;
  }

  const pathByAction = {
    confirm: `/manual-payments/${paymentId}/confirm`,
    reject: `/manual-payments/${paymentId}/reject`
  };

  await fetchJson(pathByAction[action], {
    method: "POST",
    token: state.session.accessToken
  });

  await refreshAppData();
  renderAll();
  renderScreenDependents();
  setStatus(action === "confirm" ? "Ручная оплата подтверждена" : "Ручная оплата отклонена", true);
}

async function createPaymentMethodSetup() {
  const maskedPan = document.getElementById("profile-card-mask")?.value?.trim();
  if (!maskedPan) {
    setStatus("Укажи тестовую карту", false);
    return;
  }

  await fetchJson("/payment-methods/mock-setup-intents", {
    method: "POST",
    token: state.session.accessToken,
    body: {
      provider: "bank",
      setAsDefault: true
    }
  });

  await refreshAppData();
  renderAll();
  setStatus("Заявка на привязку создана. Подтверди ее ниже.", true);
}

async function updatePaymentMethodSetup(source, action) {
  const methodId = source?.getAttribute("data-method-id");
  if (!methodId) {
    return;
  }

  if (action === "confirm") {
    const maskedPan = document.getElementById("profile-card-mask")?.value?.trim();
    if (!maskedPan) {
      setStatus("Укажи тестовую карту для подтверждения", false);
      return;
    }

    await fetchJson(`/payment-methods/${methodId}/confirm-setup`, {
      method: "POST",
      token: state.session.accessToken,
      body: {
        maskedPan,
        brand: getSelectedCardBrand(),
        setAsDefault: true
      }
    });
  } else {
    await fetchJson(`/payment-methods/${methodId}/fail-setup`, {
      method: "POST",
      token: state.session.accessToken,
      body: {
        errorCode: "frontend_mock_failure",
        reason: "Ошибка из сценария профиля"
      }
    });
  }

  await refreshAppData();
  renderAll();
  setStatus(action === "confirm" ? "Привязка подтверждена" : "Привязка переведена в ошибку", true);
}

async function revokePaymentMethodFromAction(source) {
  const methodId = source?.getAttribute("data-method-id");
  if (!methodId) {
    return;
  }

  await fetchJson(`/payment-methods/${methodId}/revoke`, {
    method: "POST",
    token: state.session.accessToken
  });

  await refreshAppData();
  renderAll();
  setStatus("Карта отвязана", true);
}

async function saveAutopayRule() {
  const globalRule = getGlobalAutopayRule();
  const enabled = document.getElementById("profile-autopay-enabled")?.classList.contains("is-on") ?? false;
  const consentEnabled = document.getElementById("profile-autopay-consent")?.classList.contains("is-on") ?? Boolean(globalRule?.enabled);
  const limitMinor = parseMoneyToMinor(document.getElementById("profile-autopay-limit")?.value ?? "");
  const objectionWindowHours = parseIntegerInput(document.getElementById("profile-autopay-window")?.value, 24);

  if (enabled && !consentEnabled) {
    setStatus("Для автоплатежей нужно явное согласие", false);
    haptic("warning");
    return;
  }

  const payload = {
    enabled,
    category: null,
    collectionId: null,
    groupId: null,
    singleCollectionLimitMinor: limitMinor || 150000,
    requiresObjectionWindow: true,
    objectionWindowHours,
    allowGuests: true,
    allowChildren: true,
    allowPartner: true,
    maxCoveredParticipants: 6
  };

  if (globalRule) {
    await fetchJson(`/autopay-rules/${globalRule.id}`, {
      method: "PATCH",
      token: state.session.accessToken,
      body: payload
    });
  } else {
    await fetchJson("/autopay-rules", {
      method: "POST",
      token: state.session.accessToken,
      body: payload
    });
  }

  await refreshAppData();
  renderAll();
  setStatus(enabled ? "Правило автоплатежей сохранено и активировано" : "Правило автоплатежей сохранено", true);
}

async function syncOrganizerAutopayPreview(options = {}) {

  const collectionId = options.collectionId ?? state.selectedOrganizerCollectionId;
  if (!collectionId) {
    return [];
  }

  const preview = await fetchJson(`/collections/${collectionId}/autopay/preview`, {
    token: state.session.accessToken
  });
  state.autopayPreviewByCollectionId.set(collectionId, preview);

  if (state.currentScreen === "organizer" && state.selectedOrganizerCollectionId === collectionId) {
    renderOrganizerScreen();
  }
  if (!options.silent) {
    const eligibleCount = preview.filter((item) => item.status === "eligible").length;
    setStatus(`Предпросмотр автоплатежей обновлен: готово к списанию ${eligibleCount}`, true);
  }
  return preview;
}

async function executeOrganizerAutopay() {
  const bundle = getSelectedOrganizerBundle();
  if (!bundle) {
    throw new Error("Organizer collection not selected");
  }

  const rule = getGlobalAutopayRule();
  const confirmed = document.getElementById("organizer-autopay-confirm-switch")?.classList.contains("is-on") ?? false;
  const preview = state.autopayPreviewByCollectionId.get(bundle.collection.id) ?? [];
  const eligibleCount = preview.filter((item) => item.status === "eligible").length;

  if (!rule?.enabled) {
    setStatus("Сначала включи и сохрани правило автоплатежей", false);
    haptic("warning");
    return;
  }
  if (!eligibleCount) {
    setStatus("Нет готовых автоплатежей для запуска", false);
    haptic("warning");
    return;
  }
  if (!confirmed) {
    setStatus("Подтверди массовый запуск автоплатежей", false);
    haptic("warning");
    return;
  }

  const result = await fetchJson(`/collections/${bundle.collection.id}/autopay/execute`, {
    method: "POST",
    token: state.session.accessToken
  });

  state.pendingAutopayConfirmationCollectionId = null;
  state.autopayExecutionSummaryByCollectionId.set(bundle.collection.id, {
    createdCount: result.createdPayments.length,
    skippedCount: result.skipped.length,
    previewCount: result.preview.length,
    updatedAt: new Date().toISOString()
  });
  state.autopayPreviewByCollectionId.set(bundle.collection.id, result.preview);

  await refreshAppData();
  renderAll();
  setStatus(`Автоплатежи: создано ${result.createdPayments.length}, пропущено ${result.skipped.length}`, true);
}

function openNotification(notificationId) {

  const notification = state.notifications.find((item) => item.id === notificationId);
  if (!notification?.collectionId) {
    setActiveScreen("inbox", "home");
    renderScreenDependents();
    return;
  }

  const bundle = state.collectionBundles.find((item) => item.collection.id === notification.collectionId);
  if (!bundle) {
    setStatus("Сбор из уведомления не найден", false);
    return;
  }

  state.selectedCollectionId = bundle.collection.id;
  state.selectedOrganizerCollectionId = bundle.collection.id;

  const organizerTypes = new Set(["participant_confirmed", "dispute_created", "manual_payment_submitted"]);
  const shouldOpenOrganizer = bundle.collection.organizerId === state.me.id && organizerTypes.has(notification.type);
  setActiveScreen(shouldOpenOrganizer ? "organizer" : "collection", shouldOpenOrganizer ? "collections" : "home");
  renderScreenDependents();
  if (shouldOpenOrganizer) {
    void syncOrganizerAutopayPreview({ collectionId: bundle.collection.id, silent: true });
  }
}

function getSelectedCollectionBundle() {
  return state.collectionBundles.find((bundle) => bundle.collection.id === state.selectedCollectionId) ?? state.collectionBundles[0] ?? null;
}

function getSelectedOrganizerBundle() {
  return state.organizerBundles.find((bundle) => bundle.collection.id === state.selectedOrganizerCollectionId) ?? state.organizerBundles[0] ?? null;
}

function getSelectedCollectionType() {
  return document.querySelector('[data-screen="new"] [data-collection-type].is-selected')?.getAttribute("data-collection-type") ?? "picnic";
}

function getSelectedDisputeType() {
  return document.querySelector('[data-screen="dispute"] [data-dispute-type].is-selected')?.getAttribute("data-dispute-type") ?? "other";
}

function getSelectedManualPaymentMethod() {
  return document.querySelector('[data-screen="pay"] [data-manual-method].is-selected')?.getAttribute("data-manual-method") ?? "sbp";
}

function getSelectedCardBrand() {
  return document.querySelector('[data-screen="profile"] [data-card-brand].is-selected')?.getAttribute("data-card-brand") ?? "mir";
}

function getCurrentUserTransfers(bundle) {
  if (!bundle?.currentParticipant || !bundle.calculation) {
    return [];
  }
  return bundle.calculation.result.transferPlan.filter((item) => item.fromResponsiblePayerId === bundle.currentParticipant.id);
}

function syncDraftExpenseAmount() {
  if (!organizerExpenseAmountInput) {
    return;
  }
  const totalMinor = state.draftExpenseItems.reduce((sum, item) => sum + item.amountMinor, 0);
  organizerExpenseAmountInput.value = totalMinor > 0 ? String(totalMinor / 100) : "";
}

function renderCollectionCard(bundle, options) {
  const isOrganizer = options.variant === "organizer";
  const dueText = bundle.userDueMinor > 0 ? formatMoney(bundle.userDueMinor) : formatMoney(Math.max(bundle.collection.totalAmountMinor - bundle.collectedMinor, 0));
  const noteBase = isOrganizer
    ? `${bundle.disputes.length} споров · ${bundle.participants.length} участников`
    : coveredParticipantsLabel(bundle.coveredParticipants);
  const note = `${labelizeCollectionStatus(bundle.collection.status)} · ${noteBase}`;
  const metaRight = isOrganizer
    ? `${bundle.disputes.length ? "есть спор" : "без споров"}`
    : `${bundle.payments.filter((payment) => payment.status === "succeeded").length + bundle.manualPayments.filter((payment) => payment.status === "confirmed").length} оплат`;
  const pill = isOrganizer
    ? `<span class="pill ${bundle.disputes.length ? "pill-danger" : "pill-muted"}">${bundle.disputes.length ? "Возражение" : "Организатор"}</span>`
    : `<span class="amount-main">${dueText}</span>`;
  const dataAttr = isOrganizer ? `data-organizer-collection-id="${bundle.collection.id}"` : `data-collection-id="${bundle.collection.id}"`;

  return `
    <button class="collection-card${options.variant === "organizer" ? " organizer" : options.variant === "neutral" ? " compact" : ""}" type="button" ${dataAttr} data-go="${options.go}" data-nav="${options.nav}">
      <div class="card-row">
        <div>
          <div class="card-title">${escapeHtml(bundle.collection.title)}</div>
          <div class="card-subtitle">${escapeHtml(note)}</div>
        </div>
        ${pill}
      </div>
      <div class="progress-bar"><span style="width:${bundle.progressPercent}%"></span></div>
      <div class="progress-meta">
        <span>${formatMoney(bundle.collectedMinor)} / ${formatMoney(bundle.collection.totalAmountMinor)}</span>
        <span>${escapeHtml(metaRight)}</span>
      </div>
    </button>
  `;
}

function renderNotificationCard(notification, options = {}) {
  const compact = options.compact === true;
  const kindLabel = notificationTypeLabel(notification.type);
  const scopeLabel = notification.collectionId
    ? state.collections.find((collection) => collection.id === notification.collectionId)?.title ?? "Сбор"
    : "Система";

  return `
    <button class="notification-card${notification.readAt ? "" : " unread"}" type="button" data-notification-id="${notification.id}">
      <div class="notification-top">
        <div class="line-item-copy">
          <div class="card-title">${escapeHtml(notification.title)}</div>
          ${compact ? "" : `<div class="notification-body">${escapeHtml(notification.body)}</div>`}
        </div>
        <span class="pill ${notificationPillClass(notification.type)}">${escapeHtml(kindLabel)}</span>
      </div>
      <div class="notification-tail">
        <span>${escapeHtml(scopeLabel)}</span>
        <span>${escapeHtml(formatNotificationTime(notification.createdAt))}</span>
      </div>
    </button>
  `;
}

function renderProfilePaymentMethods() {
  if (!state.paymentMethods.length) {
    return renderEmptyCard("Платежных методов пока нет.");
  }

  return state.paymentMethods
    .map((method) => {
      const actions =
        method.status === "requires_confirmation"
          ? `
            <div class="inline-actions">
              <button class="mini-action primary" type="button" data-action="confirm-payment-setup" data-method-id="${method.id}">Подтвердить</button>
              <button class="mini-action danger" type="button" data-action="fail-payment-setup" data-method-id="${method.id}">Ошибка</button>
            </div>
          `
          : method.status === "active"
            ? `
              <div class="inline-actions">
                <button class="mini-action danger" type="button" data-action="revoke-payment-method" data-method-id="${method.id}">Отвязать</button>
              </div>
            `
            : "";

      return `
        <div class="dispute-card">
          <div class="line-item">
            <div class="line-item-copy">
              <span>${escapeHtml(paymentMethodTitle(method))}</span>
              <div class="section-note">${escapeHtml(method.brand.toUpperCase())}${method.providerSetupId ? ` · привязка ${escapeHtml(method.providerSetupId)}` : ""}</div>
            </div>
            <strong>${escapeHtml(paymentMethodStatusLabel(method.status))}${method.isDefault ? " · основная" : ""}</strong>
          </div>
          ${method.lastSetupErrorMessage ? `<div class="section-note">${escapeHtml(method.lastSetupErrorMessage)}</div>` : ""}
          ${actions}
        </div>
      `;
    })
    .join("");
}

function renderProfileFrequentPeople() {
  if (!state.friends.length) {
    return renderEmptyCard("Друзья появятся после приглашения.");
  }

  return state.friends
    .slice(0, 3)
    .map(
      (friend, index) => `
        <div class="person-row compact">
          <div class="avatar ${avatarTone(index)}">${escapeHtml(initials(friend.displayName))}</div>
          <div class="person-meta">
            <div class="person-name">${escapeHtml(friend.displayName)}</div>
            <div class="person-sub">${friend.sharedCollections} общих сборов</div>
          </div>
        </div>
      `
    )
    .join("");
}

function renderProfileAutopayRules() {
  if (!state.autopayRules.length) {
    return renderEmptyCard("Правила автоплатежей пока не настроены.");
  }

  return state.autopayRules
    .map(
      (rule) => `
        <div class="line-item">
          <span>${rule.collectionId ? "сбор" : rule.groupId ? "группа" : "общее правило"} · ${rule.enabled ? "включено" : "выключено"}</span>
          <strong>${formatMoney(rule.singleCollectionLimitMinor)}</strong>
        </div>
      `
    )
    .join("");
}

function getGlobalAutopayRule() {
  return state.autopayRules.find((rule) => !rule.collectionId && !rule.groupId && !rule.category) ?? null;
}

function armPaymentConfirmation() {
  const bundle = getSelectedCollectionBundle();
  if (!bundle || bundle.userDueMinor <= 0) {
    return;
  }
  state.pendingPayConfirmationCollectionId = bundle.collection.id;
  renderPayScreen();
}

async function armAutopayConfirmation() {
  const bundle = getSelectedOrganizerBundle();
  if (!bundle) {
    return;
  }
  await syncOrganizerAutopayPreview({ collectionId: bundle.collection.id, silent: true });
  state.pendingAutopayConfirmationCollectionId = bundle.collection.id;
  renderOrganizerScreen();
}

function renderCollectionSection(title, bundles, note) {

  if (!bundles.length) {
    return "";
  }

  return `
    <section class="section-block">
      <div class="section-head">
        <h2>${escapeHtml(title)}</h2>
        <span class="section-note">${escapeHtml(note)}</span>
      </div>
      ${bundles
        .map((bundle) =>
          renderCollectionCard(bundle, {
            variant: bundle.collection.organizerId === state.me.id ? "organizer" : bundle.userDueMinor > 0 ? "due" : "neutral",
            go: bundle.collection.organizerId === state.me.id ? "organizer" : "collection",
            nav: bundle.collection.organizerId === state.me.id ? "collections" : "home"
          })
        )
        .join("")}
    </section>
  `;
}

function sortBundles(bundles) {
  return [...bundles].sort((left, right) => {
    const rightDate = new Date(right.collection.updatedAt ?? right.collection.createdAt).getTime();
    const leftDate = new Date(left.collection.updatedAt ?? left.collection.createdAt).getTime();
    return rightDate - leftDate;
  });
}

function isHistoricalCollectionBundle(bundle) {
  return ["paid", "closed", "cancelled"].includes(bundle.collection.status);
}

function isActionableCollectionBundle(bundle) {
  const needsReviewConfirmation =
    bundle.collection.status === "review" &&
    bundle.currentParticipant &&
    bundle.currentParticipant.status !== "confirmed";
  const hasOwnPendingDispute = bundle.disputes.some(
    (dispute) => dispute.createdByUserId === state.me.id && ["created", "under_review"].includes(dispute.status)
  );
  const hasOwnSubmittedManualPayment = bundle.manualPayments.some(
    (payment) => payment.payerUserId === state.me.id && payment.status === "submitted"
  );
  return bundle.userDueMinor > 0 || needsReviewConfirmation || hasOwnPendingDispute || hasOwnSubmittedManualPayment;
}

function renderParticipantRow(participant, subLabel) {
  return `
    <div class="person-row">
      <div class="avatar ${avatarToneByHint(participant.relationshipHint)}">${escapeHtml(initials(participant.displayNameSnapshot))}</div>
      <div class="person-meta">
        <div class="person-name">${escapeHtml(participant.displayNameSnapshot)}${participant.linkedUserId === state.me.id ? " (ты)" : ""}</div>
        ${subLabel ? `<div class="person-sub">${escapeHtml(subLabel)}</div>` : ""}
      </div>
      <span class="pill ${paymentStatusPillClass(participant.paymentStatus)}">${escapeHtml(paymentStatusLabel(participant.paymentStatus))}</span>
    </div>
  `;
}

function renderExplanation(bundle) {
  if (!bundle.calculation || !bundle.coveredParticipants.length) {
    return '<div class="line-item"><span>Расчет еще не готов.</span><strong>—</strong></div>';
  }

  const lines = bundle.coveredParticipants
    .map((participant) => {
      const calc = bundle.calculation.result.participantCalculations.find((item) => item.participantId === participant.id);
      if (!calc) {
        return "";
      }

      const included = calc.explanation.included
        .map((line) => `<div class="line-item"><span>${escapeHtml(line.expenseTitle)}</span><strong>${formatMoney(line.amountMinor)}</strong></div>`)
        .join("");
      const excluded = calc.explanation.excluded
        .map(
          (line) =>
            `<div class="line-item muted"><span>${escapeHtml(line.expenseTitle)}</span><em>${escapeHtml(line.reason ?? "исключено из расчета")}</em></div>`
        )
        .join("");

      return `
        <div class="mini-section">
          <div class="mini-heading">${escapeHtml(participant.displayNameSnapshot)} — ${formatMoney(calc.owesAmountMinor)}</div>
          ${included || '<div class="line-item"><span>Равномерное распределение</span><strong>включено</strong></div>'}
          ${excluded}
        </div>
      `;
    })
    .filter(Boolean)
    .join('<div class="divider"></div>');

  return lines || '<div class="line-item"><span>Подробности появятся после пересчета.</span><strong>—</strong></div>';
}

function renderEmptyCard(message) {
  return `
    <article class="detail-panel">
      <div class="line-item">
        <span>${escapeHtml(message)}</span>
        <strong>—</strong>
      </div>
    </article>
  `;
}

function renderPayConfirmationPanel(bundle) {
  const selectedMethod = state.paymentMethods.find((method) => method.id === state.selectedPaymentMethodId) ?? null;
  const isOpen = state.pendingPayConfirmationCollectionId === bundle.collection.id;

  if (!isOpen) {
    return renderEmptyCard("Перед списанием покажем итог, карту и последнее подтверждение.");
  }

  return `
    <article class="detail-panel confirmation-panel">
      <div class="panel-title">Финальное подтверждение</div>
      <div class="confirmation-grid">
        <div class="line-item">
          <span>Сбор</span>
          <strong>${escapeHtml(bundle.collection.title)}</strong>
        </div>
        <div class="line-item">
          <span>Сумма</span>
          <strong>${formatMoney(bundle.userDueMinor)}</strong>
        </div>
        <div class="line-item">
          <span>Карта</span>
          <strong>${escapeHtml(selectedMethod ? paymentMethodTitle(selectedMethod) : "Будет создана тестовая карта")}</strong>
        </div>
      </div>
      <div class="consent-card">
        <div class="setting-row">
          <div class="switch-copy">
            <div class="setting-title">Подтверждаю списание</div>
            <div class="setting-sub">Сумма и получатели проверены, можно создавать платеж.</div>
          </div>
          <button class="switch" id="pay-confirm-switch" type="button" aria-label="Подтвердить списание"><span></span></button>
        </div>
      </div>
      <div class="inline-actions stacked-actions">
        <button class="primary-button" type="button" data-action="confirm-pay-now">Подтвердить оплату</button>
        <button class="secondary-button" type="button" data-action="cancel-pay-confirm">Вернуться и проверить</button>
      </div>
    </article>
  `;
}

function renderAutopayConfirmationPanel(bundle, preview) {
  const rule = getGlobalAutopayRule();
  const eligibleCount = preview.filter((item) => item.status === "eligible").length;
  const totalMinor = preview.filter((item) => item.status === "eligible").reduce((sum, item) => sum + item.amountMinor, 0);
  const isOpen = state.pendingAutopayConfirmationCollectionId === bundle.collection.id;

  if (!isOpen) {
    return renderEmptyCard("Здесь появится контрольный шаг перед массовым запуском автоплатежей.");
  }

  const consentState = rule?.enabled ? "Согласие активно" : "Сначала включи и сохрани правило автоплатежей";
  const consentClass = rule?.enabled ? "pill-success" : "pill-danger";

  return `
    <article class="detail-panel confirmation-panel">
      <div class="panel-title">Контроль перед запуском</div>
      <div class="line-item">
        <span>Готовых участников</span>
        <strong>${eligibleCount}</strong>
      </div>
      <div class="line-item">
        <span>Сумма к запуску</span>
        <strong>${formatMoney(totalMinor)}</strong>
      </div>
      <div class="line-item">
        <span>Лимит правила</span>
        <strong>${formatMoney(rule?.singleCollectionLimitMinor ?? 0)}</strong>
      </div>
      <div class="line-item">
        <span>Статус согласия</span>
        <span class="pill ${consentClass}">${consentState}</span>
      </div>
      <div class="consent-card">
        <div class="setting-row">
          <div class="switch-copy">
            <div class="setting-title">Запустить списания по готовым участникам</div>
            <div class="setting-sub">Будут созданы только те платежи, которые уже прошли все ограничения и окно возражений.</div>
          </div>
          <button class="switch" id="organizer-autopay-confirm-switch" type="button" aria-label="Подтвердить запуск автоплатежей"><span></span></button>
        </div>
      </div>
      <div class="inline-actions stacked-actions">
        <button class="primary-button" type="button" data-action="confirm-execute-autopay">Подтвердить запуск</button>
        <button class="secondary-button" type="button" data-action="cancel-autopay-confirm">Отмена</button>
      </div>
    </article>
  `;
}

function renderAuditTimeline(auditLog, bundle) {
  if (auditLog === null) {
    return renderEmptyCard("Журнал действий загружается.");
  }
  if (!auditLog.length) {
    return renderEmptyCard("По этому сбору еще нет событий.");
  }

  return `
    <div class="timeline-list">
      ${auditLog
        .slice()
        .reverse()
        .map((entry) => {
          const actor = entry.actorUserId ? state.userDirectory.get(entry.actorUserId)?.displayName ?? "Участник" : "Система";
          const title = auditActionLabel(entry);
          const details = auditMetaLabel(entry, bundle);
          return `
            <article class="timeline-item">
              <div class="timeline-dot"></div>
              <div class="timeline-copy">
                <div class="timeline-top">
                  <strong>${escapeHtml(title)}</strong>
                  <span>${escapeHtml(formatNotificationTime(entry.createdAt))}</span>
                </div>
                <div class="timeline-body">${escapeHtml(actor)}${details ? ` · ${escapeHtml(details)}` : ""}</div>
              </div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function auditActionLabel(entry) {
  const labels = {
    "collection:created": "Сбор создан",
    "collection:updated": "Сбор обновлен",
    "collection:recalculated": "Сбор пересчитан",
    "collection:sent_to_review": "Расчет отправлен на согласование",
    "payment:created": "Платеж создан",
    "payment:paid": "Платеж проведен",
    "payment:updated": "Платеж обновлен",
    "participant:confirmed": "Участник подтвердил расчет",
    "dispute:disputed": "Создан спор",
    "dispute:accepted": "Спор принят",
    "dispute:rejected": "Спор отклонен",
    "dispute:recalculated": "Спор закрыт пересчетом",
    "manual_payment:paid": "Ручная оплата отмечена",
    "manual_payment:confirmed": "Ручная оплата подтверждена",
    "manual_payment:rejected": "Ручная оплата отклонена",
    "notification:read": "Уведомление прочитано"
  };
  return labels[`${entry.entityType}:${entry.action}`] ?? `${entry.entityType} · ${entry.action}`;
}

function auditMetaLabel(entry, bundle) {
  const metadata = entry.metadata ?? {};
  if (typeof metadata.amountMinor === "number") {
    return formatMoney(metadata.amountMinor);
  }
  if (metadata.status) {
    return String(metadata.status);
  }
  if (metadata.participantId && bundle?.participants) {
    return displayNameByParticipantId(bundle.participants, metadata.participantId);
  }
  if (metadata.reason) {
    return String(metadata.reason);
  }
  return "";
}

function coveredParticipantsLabel(participants) {

  if (!participants.length) {
    return "Персональная доля";
  }
  if (participants.length === 1) {
    return `За ${participants[0].displayNameSnapshot}`;
  }
  return participants.map((participant) => participant.displayNameSnapshot).join(" + ");
}

function displayNameByParticipantId(participants, participantId) {
  return participants.find((participant) => participant.id === participantId)?.displayNameSnapshot ?? "другого участника";
}

function paymentMethodTitle(method) {
  return `Карта ${method.maskedPan}`;
}

function labelizeCollectionType(type) {
  const labels = {
    picnic: "пикник",
    restaurant: "ужин",
    gift: "подарок",
    trip: "поездка",
    office: "офис",
    rent: "аренда",
    kids: "дети",
    dacha: "дача",
    other: "сбор"
  };
  return labels[type] ?? type;
}

function labelizeGroupType(type) {
  const labels = {
    friends: "друзья",
    family: "семья",
    work: "работа",
    trip: "поездка",
    event: "ивент",
    other: "другое"
  };
  return labels[type] ?? type;
}

function labelizeCollectionStatus(status) {
  const labels = {
    draft: "draft",
    participants_selected: "участники",
    expenses_added: "расходы",
    rules_configured: "правила",
    review: "согласование",
    dispute_pending: "спор",
    finalized: "итог",
    payment_pending: "к оплате",
    partially_paid: "частично оплачено",
    paid: "оплачено",
    closed: "закрыт",
    cancelled: "отменен",
    blocked: "заблокировано"
  };
  return labels[status] ?? status;
}

function labelizeDisputeType(type) {
  const labels = {
    not_eat: "не ел",
    not_drink: "не пил",
    partial_time: "не все время",
    already_paid: "уже платил",
    bought_something: "купил отдельно",
    absent: "отсутствовал",
    guest_absent: "гость отсутствовал",
    payer_changed: "другой плательщик",
    other: "другое"
  };
  return labels[type] ?? type;
}

function disputeStatusLabel(status) {
  const labels = {
    created: "создан",
    under_review: "на рассмотрении",
    accepted: "принят",
    rejected: "отклонен",
    resolved_by_recalculation: "решен пересчетом",
    cancelled: "отменен"
  };
  return labels[status] ?? status;
}

function manualPaymentMethodLabel(method) {
  const labels = {
    sbp: "СБП",
    cash: "Наличные",
    card: "Карта",
    other: "Другое"
  };
  return labels[method] ?? method;
}

function manualPaymentStatusLabel(status) {
  const labels = {
    submitted: "ждет подтверждения",
    confirmed: "подтверждено",
    rejected: "отклонено"
  };
  return labels[status] ?? status;
}

async function confirmCurrentParticipantReview() {
  const bundle = getSelectedCollectionBundle();
  if (!bundle?.currentParticipant) {
    return;
  }

  await fetchJson(`/collections/${bundle.collection.id}/participants/${bundle.currentParticipant.id}/confirm-review`, {
    method: "POST",
    token: state.session.accessToken
  });

  await refreshAppData();
  renderAll();
  renderScreenDependents();
  setStatus("Согласование подтверждено", true);
}

function renderOrganizerExpenseCard(bundle, expense) {
  const expenseItems = expense.items ?? [];
  const shareRules = expense.shareRules ?? [];
  const participantOptions = bundle.participants
    .map((participant) => `<option value="${participant.id}">${escapeHtml(participant.displayNameSnapshot)}</option>`)
    .join("");

  const itemsMarkup = expenseItems.length
    ? expenseItems
        .map((item) => {
          const itemRules = shareRules.filter((rule) => rule.expenseItemId === item.id);
          return `
            <div class="mini-section">
              <div class="line-item">
                <span>${escapeHtml(item.title)}</span>
                <strong>${formatMoney(item.amountMinor)}</strong>
              </div>
              ${
                itemRules.length
                  ? itemRules
                      .map(
                        (rule) => `
                          <div class="line-item muted">
                            <span>${escapeHtml(displayNameByParticipantId(bundle.participants, rule.participantId))} · ${escapeHtml(rule.splitMode)}</span>
                            <em>${escapeHtml(describeShareRule(rule))}</em>
                          </div>
                        `
                      )
                      .join("")
                  : '<div class="line-item muted"><span>Нет правил по позициям</span><em>готово</em></div>'
              }
              <button class="mini-action" type="button" data-action="add-expense-rule" data-expense-id="${expense.id}" data-expense-item-id="${item.id}">Применить правило</button>
            </div>
          `;
        })
        .join("")
    : '<div class="line-item muted"><span>Позиции чека пока не добавлены</span><em>равное деление</em></div>';

  return `
    <article class="detail-panel bottom-gap">
      <div class="line-item">
        <div class="line-item-copy">
          <span>${escapeHtml(expense.title)}</span>
          <div class="section-note">${expenseItems.length ? `${expenseItems.length} items` : "no itemization"}</div>
        </div>
        <strong>${formatMoney(expense.amountMinor)}</strong>
      </div>
      ${itemsMarkup}
      <div class="mini-section">
        <label class="field-label" for="expense-item-title-${expense.id}">New item</label>
        <input id="expense-item-title-${expense.id}" class="text-input" placeholder="For example, dessert" />
      </div>
      <div class="mini-section">
        <label class="field-label" for="expense-item-amount-${expense.id}">Item amount, ₽</label>
        <input id="expense-item-amount-${expense.id}" class="text-input" inputmode="decimal" placeholder="300" />
      </div>
      <button class="secondary-button" type="button" data-action="add-expense-item" data-expense-id="${expense.id}">Add item</button>
      ${
        expenseItems.length
          ? `
            <div class="mini-section">
              <label class="field-label" for="expense-rule-participant-${expense.id}">Participant</label>
              <select id="expense-rule-participant-${expense.id}" class="text-input">${participantOptions}</select>
            </div>
            <div class="mini-section">
              <label class="field-label" for="expense-rule-mode-${expense.id}">Rule mode</label>
              <select id="expense-rule-mode-${expense.id}" class="text-input">
                <option value="excluded">excluded</option>
                <option value="weights">weights</option>
                <option value="fixed">fixed</option>
                <option value="percent">percent</option>
              </select>
            </div>
            <div class="mini-section">
              <label class="field-label" for="expense-rule-value-${expense.id}">Rule value</label>
              <input id="expense-rule-value-${expense.id}" class="text-input" inputmode="decimal" placeholder="For fixed / percent / weights" />
            </div>
            <div class="mini-section">
              <label class="field-label" for="expense-rule-reason-${expense.id}">Comment</label>
              <input id="expense-rule-reason-${expense.id}" class="text-input" placeholder="For example, did not drink wine" />
            </div>
          `
          : ""
      }
    </article>
  `;
}

function describeShareRule(rule) {
  if (rule.splitMode === "excluded") {
    return rule.reason ?? "excluded";
  }
  if (rule.splitMode === "fixed") {
    return `${formatMoney(rule.fixedAmountMinor ?? 0)}${rule.reason ? ` · ${rule.reason}` : ""}`;
  }
  if (rule.splitMode === "percent") {
    return `${rule.percent ?? 0}%${rule.reason ? ` · ${rule.reason}` : ""}`;
  }
  if (rule.splitMode === "weights") {
    return `weight ${rule.weight ?? 1}${rule.reason ? ` · ${rule.reason}` : ""}`;
  }
  return rule.reason ?? rule.splitMode;
}

async function addExpenseRuleForParticipant(source) {
  const expenseId = source?.getAttribute("data-expense-id");
  const expenseItemId = source?.getAttribute("data-expense-item-id");
  if (!expenseId || !expenseItemId) {
    return;
  }

  const participantSelect = document.getElementById(`expense-rule-participant-${expenseId}`);
  const modeSelect = document.getElementById(`expense-rule-mode-${expenseId}`);
  const valueInput = document.getElementById(`expense-rule-value-${expenseId}`);
  const reasonInput = document.getElementById(`expense-rule-reason-${expenseId}`);
  const participantId = participantSelect?.value;
  const splitMode = modeSelect?.value ?? "excluded";
  if (!participantId) {
    setStatus("Select a participant for item-level rule", false);
    return;
  }

  const payload = {
    participantId,
    expenseItemId,
    splitMode,
    reason: reasonInput?.value?.trim() || null,
    weight: splitMode === "weights" ? parseNumberInput(valueInput?.value, 1) : null,
    fixedAmountMinor: splitMode === "fixed" ? parseMoneyToMinor(valueInput?.value ?? "") : null,
    percent: splitMode === "percent" ? parseNumberInput(valueInput?.value, 0) : null
  };

  await fetchJson(`/expenses/${expenseId}/share-rules`, {
    method: "POST",
    token: state.session.accessToken,
    body: payload
  });

  await refreshAppData();
  renderAll();
  renderScreenDependents();
  setStatus(`Правило по позиции добавлено: ${splitMode}`, true);
}

function paymentMethodStatusLabel(status) {
  const labels = {
    pending_binding: "ожидает",
    requires_confirmation: "нужно подтверждение",
    active: "активна",
    failed: "ошибка",
    expired: "истекла",
    revoked: "отвязана"
  };
  return labels[status] ?? status;
}

function autoPaymentPreviewStatusLabel(status) {
  const labels = {
    eligible: "готово",
    blocked: "заблокировано",
    already_exists: "уже создано"
  };
  return labels[status] ?? status;
}

function autoPaymentPreviewPillClass(status) {
  if (status === "eligible") {
    return "pill-success";
  }
  if (status === "already_exists") {
    return "pill-muted";
  }
  return "pill-danger";
}

function autoPaymentReasonLabel(reasonCode) {
  const labels = {
    eligible: "Готово к списанию",
    no_rule: "Нет правила",
    rule_disabled: "Правило выключено",
    missing_payment_method: "Нет активного метода",
    objection_window_open: "Открыто окно возражений",
    participant_type_not_allowed: "Тип участника не покрывается",
    covered_participant_limit: "Превышен лимит участников",
    collection_limit_exceeded: "Превышен лимит на сбор",
    daily_limit_exceeded: "Превышен дневной лимит",
    monthly_limit_exceeded: "Превышен месячный лимит",
    existing_payment: "Платеж уже существует",
    unlinked_responsible_user: "Нет связанного пользователя"
  };
  return labels[reasonCode] ?? reasonCode;
}

function notificationTypeLabel(type) {
  const labels = {
    collection_review_requested: "согласование",
    participant_confirmed: "подтверждено",
    dispute_created: "спор",
    dispute_updated: "обновление",
    manual_payment_submitted: "подтверждение",
    manual_payment_confirmed: "ручная оплата",
    manual_payment_rejected: "отклонено"
  };
  return labels[type] ?? type;
}

function notificationPillClass(type) {
  if (type === "dispute_created" || type === "manual_payment_rejected") {
    return "pill-danger";
  }
  if (type === "participant_confirmed" || type === "manual_payment_confirmed") {
    return "pill-success";
  }
  return "pill-warn";
}

function paymentStatusLabel(status) {
  const labels = {
    pending: "ждет оплаты",
    paid: "оплачено",
    partial: "частично",
    disputed: "спор",
    failed: "ошибка"
  };
  return labels[status] ?? status;
}

function paymentStatusPillClass(status) {
  if (status === "paid") {
    return "pill-success";
  }
  if (status === "disputed" || status === "failed") {
    return "pill-danger";
  }
  return "pill-warn";
}

function avatarTone(index) {
  return ["teal", "blue", "orange", "violet"][index % 4];
}

function groupTone(index) {
  return ["violet-soft", "teal-soft", "amber-soft"][index % 3];
}

function avatarToneByHint(hint) {
  switch (hint) {
    case "family":
    case "partner":
      return "coral";
    case "guest":
      return "teal";
    case "child":
      return "orange";
    case "colleague":
      return "blue";
    default:
      return "violet";
  }
}

function formatMoney(amountMinor) {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format((amountMinor ?? 0) / 100);
}

function formatNotificationTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "сейчас";
  }
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function initials(value) {
  return (value ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "--";
}

function text(id, value) {
  const node = document.getElementById(id);
  if (node) {
    node.textContent = value;
  }
}

function setProgress(id, percent) {
  const node = document.getElementById(id);
  if (node) {
    node.style.width = `${percent}%`;
  }
}

function setCollectionBalancePill(id, dueMinor) {
  const node = document.getElementById(id);
  if (!node) {
    return;
  }
  node.textContent = dueMinor > 0 ? "Не оплачено" : "Оплачено";
  node.classList.toggle("pill-warn", dueMinor > 0);
  node.classList.toggle("pill-success", dueMinor <= 0);
}

function setStatus(message, ready) {
  if (statusDot) {
    statusDot.classList.toggle("is-ready", ready);
  }
  if (apiStatusText) {
    apiStatusText.textContent = message;
  }
}

function haptic(type = "tap") {
  if (!("vibrate" in navigator)) {
    return;
  }

  const patterns = {
    tap: 8,
    success: [12, 28, 18],
    warning: [18, 24, 18]
  };
  navigator.vibrate(patterns[type] ?? patterns.tap);
}

function triggerCompletionFeedback() {
  haptic("success");
  document.body.classList.remove("is-celebrating");
  requestAnimationFrame(() => {
    document.body.classList.add("is-celebrating");
  });
}

function parseMoneyToMinor(value) {
  const normalized = String(value).trim().replace(/\s+/g, "").replace(",", ".");
  if (!normalized) {
    return 0;
  }
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0;
  }
  return Math.round(amount * 100);
}

function parseIntegerInput(value, fallback = 0) {
  const parsed = Number.parseInt(String(value).trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNumberInput(value, fallback = 0) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function fetchJson(path, options = {}) {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (options.allow404 && response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const payload = await safeJson(response);
    throw new Error(payload?.message ?? `HTTP ${response.status}`);
  }

  return await safeJson(response);
}

async function safeJson(response) {
  const textContent = await response.text();
  return textContent ? JSON.parse(textContent) : null;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

bootstrap().catch((error) => {
  console.error(error);
  document.body.classList.remove("is-booting");
  haptic("warning");
  setStatus(error instanceof Error ? error.message : "Фронтенд не запустился", false);
});
