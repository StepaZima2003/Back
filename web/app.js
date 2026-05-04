const DEMO = {
  alex: { key: "alex", phone: "+79990030001", displayName: "Алексей" },
  sasha: { key: "sasha", phone: "+79990030002", displayName: "Саша" },
  dima: { key: "dima", phone: "+79990030003", displayName: "Дима" },
  masha: { key: "masha", phone: "+79990030004", displayName: "Маша" }
};

const BROKEN_TEXT_FIXUPS = new Map([
  ["РђР»РµРєСЃРµР№", "Алексей"],
  ["РЎР°С€Р°", "Саша"],
  ["Р”РёРјР°", "Дима"],
  ["РњР°С€Р°", "Маша"],
  ["РСЂР°", "Ира"],
  ["РР»СЊСЏ", "Илья"],
  ["РљР°С‚СЏ", "Катя"],
  ["РћР»РµРі", "Олег"],
  ["РђРЅСЏ", "Аня"],
  ["РЈС‡Р°СЃС‚РЅРёРє", "Участник"],
  ["РЁР°С€Р»С‹РєРё РІ СЃСѓР±Р±РѕС‚Сѓ", "Шашлыки в субботу"],
  ["Р”Р°С‡Р°", "Дача"],
  ["Р”Р°С‡Р° РЅР° РјР°Р№СЃРєРёРµ", "Шашлыки на даче"],
  ["Дача РЅР° РјР°Р№СЃРєРёРµ", "Шашлыки на даче"],
  ["РџРѕРґР°СЂРѕРє РСЂРµ", "Подарок Ире"],
  ["РџСЂРѕРґСѓРєС‚С‹ Рё Р±РµСЃРµРґРєР°", "Продукты и беседка"],
  ["РђСЂРµРЅРґР° РґРѕРјР°", "Мясо для шашлыка"],
  ["РџРѕРґР°СЂРѕС‡РЅС‹Р№ СЃРµСЂС‚РёС„РёРєР°С‚", "Подарочный сертификат"],
  ["РњРµРЅСЏ РЅРµ Р±С‹Р»Рѕ РЅР° СѓР¶РёРЅРµ Рё Р±Р°РЅРµ.", "Меня не было на ужине и в бане."]
]);

const ENGLISH_TEXT_FIXUPS = new Map([
  ["New dispute", "Новый спор"],
  ["Calculation sent to review", "Расчет отправлен на согласование"],
  ["Participant confirmed calculation", "Расчет подтвержден"],
  ["Dispute accepted", "Спор принят"],
  ["Dispute rejected", "Спор отклонен"],
  ["Dispute resolved", "Спор решен"],
  ["Manual payment submitted", "Ручная оплата отправлена"],
  ["Manual payment confirmed", "Ручная оплата подтверждена"],
  ["Manual payment rejected", "Ручная оплата отклонена"],
  ["Organizer sent the collection calculation to review.", "Организатор отправил расчет сбора на согласование."],
  ["Organizer accepted your dispute.", "Организатор принял ваш спор."],
  ["Organizer rejected your dispute.", "Организатор отклонил ваш спор."],
  ["Organizer recalculated the collection after dispute review.", "Организатор пересчитал сбор после разбора спора."],
  ["A participant marked a manual payment as paid.", "Участник отметил ручную оплату как выполненную."],
  ["Your manual payment was confirmed.", "Ваша ручная оплата подтверждена."],
  ["Your manual payment proof was rejected.", "Подтверждение ручной оплаты отклонено."]
]);

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

function fixBrokenText(value) {
  if (typeof value !== "string" || !value) {
    return value;
  }

  let next = value;
  for (const [broken, fixed] of BROKEN_TEXT_FIXUPS.entries()) {
    next = next.split(broken).join(fixed);
  }
  for (const [english, russian] of ENGLISH_TEXT_FIXUPS.entries()) {
    next = next.split(english).join(russian);
  }

  let decoded = decodeUtf8Mojibake(next);
  decoded = decoded.replace(/(.+?) disputed the calculation\./g, (_, name) => `${name} оспорил расчет.`);
  decoded = decoded.replace(/(.+?) confirmed the calculation\./g, (_, name) => `${name} подтвердил расчет.`);
  return decoded;
}

function decodeUtf8Mojibake(value) {
  if (typeof value !== "string" || !value) {
    return value;
  }

  let suspiciousPairs = 0;
  for (let index = 0; index < value.length - 1; index += 1) {
    const current = value[index];
    const next = value[index + 1];
    if ((current === "Р" || current === "С" || current === "В") && isCyrillicChar(next)) {
      suspiciousPairs += 1;
    }
  }

  if (!suspiciousPairs) {
    return value;
  }

  const bytes = [];
  for (const char of value) {
    const byte = cp1251ByteFromChar(char);
    if (byte === null) {
      return value;
    }
    bytes.push(byte);
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return value;
  }
}

function cp1251ByteFromChar(char) {
  const code = char.charCodeAt(0);
  if (code <= 0x7f) {
    return code;
  }
  if (code >= 0x0410 && code <= 0x044f) {
    return code - 0x0350;
  }

  const specialMap = {
    0x0401: 0xa8,
    0x0402: 0x80,
    0x0403: 0x81,
    0x0404: 0xaa,
    0x0405: 0xbd,
    0x0406: 0xb2,
    0x0407: 0xaf,
    0x0408: 0xa3,
    0x0409: 0x8a,
    0x040a: 0x8c,
    0x040b: 0x8e,
    0x040c: 0x8d,
    0x040e: 0xa1,
    0x040f: 0x8f,
    0x0451: 0xb8,
    0x0452: 0x90,
    0x0453: 0x83,
    0x0454: 0xba,
    0x0455: 0xbe,
    0x0456: 0xb3,
    0x0457: 0xbf,
    0x0458: 0xbc,
    0x0459: 0x9a,
    0x045a: 0x9c,
    0x045b: 0x9e,
    0x045c: 0x9d,
    0x045e: 0xa2,
    0x045f: 0x9f,
    0x0490: 0xa5,
    0x0491: 0xb4,
    0x00a0: 0xa0,
    0x00a4: 0xa4,
    0x00a6: 0xa6,
    0x00a7: 0xa7,
    0x00a9: 0xa9,
    0x00ab: 0xab,
    0x00ac: 0xac,
    0x00ad: 0xad,
    0x00ae: 0xae,
    0x00b0: 0xb0,
    0x00b1: 0xb1,
    0x00b5: 0xb5,
    0x00b6: 0xb6,
    0x00b7: 0xb7,
    0x00bb: 0xbb,
    0x2013: 0x96,
    0x2014: 0x97,
    0x2018: 0x91,
    0x2019: 0x92,
    0x201a: 0x82,
    0x201c: 0x93,
    0x201d: 0x94,
    0x201e: 0x84,
    0x2020: 0x86,
    0x2021: 0x87,
    0x2022: 0x95,
    0x2026: 0x85,
    0x2030: 0x89,
    0x2039: 0x8b,
    0x203a: 0x9b,
    0x20ac: 0x88,
    0x2116: 0xb9,
    0x2122: 0x99
  };

  return specialMap[code] ?? null;
}

function isCyrillicChar(char) {
  const code = char.charCodeAt(0);
  return (code >= 0x0400 && code <= 0x04ff) || code === 0x2116;
}

function repairVisibleText(root = document.body) {
  if (!root) {
    return;
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.parentElement?.tagName !== "SCRIPT" && node.parentElement?.tagName !== "STYLE") {
      const fixed = fixBrokenText(node.textContent);
      if (fixed !== node.textContent) {
        node.textContent = fixed;
      }
    }
    node = walker.nextNode();
  }

  root.querySelectorAll("[placeholder], [title], [aria-label], img[alt]").forEach((element) => {
    ["placeholder", "title", "aria-label", "alt"].forEach((attribute) => {
      const value = element.getAttribute(attribute);
      if (!value) {
        return;
      }
      const fixed = fixBrokenText(value);
      if (fixed !== value) {
        element.setAttribute(attribute, fixed);
      }
    });
  });
}

function normalizeStateLabels() {
  if (state.me) {
    state.me.displayName = fixBrokenText(state.me.displayName);
  }

  state.collections.forEach((collection) => {
    collection.title = fixBrokenText(collection.title);
  });

  state.notifications.forEach((notification) => {
    notification.title = fixBrokenText(notification.title);
    notification.body = fixBrokenText(notification.body);
  });

  state.friends.forEach((friend) => {
    friend.displayName = fixBrokenText(friend.displayName);
  });

  state.groups.forEach((group) => {
    group.title = fixBrokenText(group.title);
  });

  for (const user of state.userDirectory.values()) {
    user.displayName = fixBrokenText(user.displayName);
  }

  state.collectionBundles.forEach((bundle) => {
    bundle.collection.title = fixBrokenText(bundle.collection.title);
    bundle.participants.forEach((participant) => {
      participant.displayNameSnapshot = fixBrokenText(participant.displayNameSnapshot);
    });
    bundle.expenses.forEach((expense) => {
      expense.title = fixBrokenText(expense.title);
      (expense.items ?? []).forEach((item) => {
        item.title = fixBrokenText(item.title);
      });
    });
    bundle.disputes.forEach((dispute) => {
      dispute.message = fixBrokenText(dispute.message);
    });
  });
}
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
    setStatus(error instanceof Error ? error.message : "Р”РµР№СЃС‚РІРёРµ РЅРµ РІС‹РїРѕР»РЅРµРЅРѕ", false);
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
  setStatus("Р”РµРјРѕ-РґР°РЅРЅС‹Рµ РіРѕС‚РѕРІС‹", true);
  renderAll();
  document.body.classList.remove("is-booting");
}

async function pingHealth() {
  const response = await fetch("/health");
  if (!response.ok) {
    throw new Error(`РџСЂРѕРІРµСЂРєР° API РЅРµ РїСЂРѕС€Р»Р°: ${response.status}`);
  }
  const health = await response.json();
  setStatus(`${health.service} РѕРЅР»Р°Р№РЅ`, true);
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
  const titleSet = new Set(alexCollections.map((collection) => fixBrokenText(collection.title)));

  if ((await fetchJson("/friends", { token: state.actors.alex.accessToken })).filter((item) => item.status === "accepted").length === 0) {
    await seedFriendships();
  }

  let dachaGroup = (await fetchJson("/groups", { token: state.actors.alex.accessToken })).find((group) => fixBrokenText(group.title) === "Дача");
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

  if (!titleSet.has("Шашлыки на даче")) {
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
    body: { title: "Шашлыки на даче", type: "trip", groupId }
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
      title: "Мясо для шашлыка",
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
      message: "Меня не было на ужине и в бане."
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
  normalizeStateLabels();

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
      displayName: friend?.displayName ?? "РЈС‡Р°СЃС‚РЅРёРє",
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
  repairVisibleText();
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
    const receiptItems = bundle.expenses.length
      ? bundle.expenses.slice(0, 6).map((expense, index) => {
          const quantity = showcaseReceiptQuantity(expense.title, index);
          const unitMinor = quantity > 0 ? Math.max(100, Math.round(expense.amountMinor / quantity)) : expense.amountMinor;
          return `
            <div class="receipt-line receipt-line-item">
              <div>
                <span class="receipt-item-title">${escapeHtml(truncateText(expense.title, 24))}</span>
                <span class="receipt-item-meta">${quantity} x ${formatMoney(unitMinor)}</span>
              </div>
              <span>${formatMoney(expense.amountMinor)}</span>
            </div>
          `;
        })
      : [
          `
            <div class="receipt-line receipt-line-item">
              <div>
                <span class="receipt-item-title">Нет распознанных позиций</span>
                <span class="receipt-item-meta">Добавьте первый расход</span>
              </div>
              <span>0 ₽</span>
            </div>
          `
        ];
    const serviceFeeMinor = remainingMinor > 0 ? 0 : Math.round(bundle.collection.totalAmountMinor * 0.02);
    const subtotalMinor = Math.max(bundle.collection.totalAmountMinor - serviceFeeMinor, 0);
    receiptPaper.innerHTML = `
      <div class="receipt-brand">
        <div class="receipt-store">Гриль Хаус</div>
        <div class="receipt-substore">Чек распознан в Вместе</div>
      </div>
      <div class="receipt-date">${escapeHtml(formatNotificationTime(bundle.collection.updatedAt ?? bundle.collection.createdAt ?? new Date().toISOString()))}</div>
      <div class="receipt-meta-grid">
        <span>Сбор</span>
        <span>${escapeHtml(truncateText(bundle.collection.title, 18))}</span>
        <span>Касса</span>
        <span>№ 03 / 1284</span>
        <span>Оплата</span>
        <span>Карта •• 4242</span>
      </div>
      <div class="receipt-divider"></div>
      ${receiptItems.join("")}
      <div class="receipt-divider"></div>
      <div class="receipt-line">
        <span>Подытог</span>
        <span>${formatMoney(subtotalMinor)}</span>
      </div>
      <div class="receipt-line">
        <span>Сервис</span>
        <span>${formatMoney(serviceFeeMinor)}</span>
      </div>
      <div class="receipt-line receipt-line-total">
        <span>ИТОГО</span>
        <span>${formatMoney(bundle.collection.totalAmountMinor)}</span>
      </div>
      <div class="receipt-footer">
        <span>Спасибо за покупку</span>
        <span>Вместе подготовит распределение автоматически</span>
      </div>
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
  const { asset, tone } = showcaseExpenseVisual(expense.title);
  return `
    <article class="showcase-expense-row">
      <span class="showcase-expense-icon ${tone}">
        <img src="${asset}" alt="${escapeHtml(category)}" />
      </span>
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
  const value = fixBrokenText(String(title ?? "")).toLowerCase();
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
  const value = fixBrokenText(String(title ?? "")).toLowerCase();
  if (value.includes("мяс") || value.includes("шашлык")) {
    return { asset: "/assets/expense-steak.png", tone: "tone-steak" };
  }
  if (value.includes("овощ") || value.includes("зел")) {
    return { asset: "/assets/expense-vegetables.png", tone: "tone-vegetables" };
  }
  if (value.includes("напит") || value.includes("сок") || value.includes("вода")) {
    return { asset: "/assets/expense-drink.png", tone: "tone-drink" };
  }
  if (value.includes("уголь") || value.includes("розжиг")) {
    return { asset: "/assets/expense-charcoal.png", tone: "tone-charcoal" };
  }
  if (value.includes("соус") || value.includes("спец")) {
    return { asset: "/assets/expense-sauces.png", tone: "tone-sauces" };
  }
  if (value.includes("хлеб") || value.includes("лаваш")) {
    return { asset: "/assets/expense-bread.png", tone: "tone-bread" };
  }
  return { asset: "/assets/expense-steak.png", tone: "tone-steak" };
}

function truncateText(value, length) {
  const source = String(value ?? "");
  if (source.length <= length) {
    return source;
  }
  return `${source.slice(0, Math.max(0, length - 1))}…`;
}

function showcaseReceiptQuantity(title, index) {
  const value = fixBrokenText(String(title ?? "")).toLowerCase();
  if (value.includes("мяс") || value.includes("шашлык")) {
    return 2;
  }
  if (value.includes("напит")) {
    return 5;
  }
  if (value.includes("овощ") || value.includes("хлеб")) {
    return 3;
  }
  if (value.includes("соус")) {
    return 2;
  }
  if (value.includes("уголь") || value.includes("розжиг")) {
    return 1;
  }
  return (index % 3) + 1;
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
  repairVisibleText();
}

function renderHome() {
  text("home-user-name", state.me?.displayName ?? "РђР»РµРєСЃРµР№");
  text("home-user-avatar", initials(state.me?.displayName ?? "РђР»РµРєСЃРµР№"));
  text("home-due-note", `${state.dueBundles.length} Р°РєС‚РёРІРЅС‹С… СЃР±РѕСЂРѕРІ`);
  text("home-organizer-note", `${state.organizerBundles.length} СЃР±РѕСЂРѕРІ РїРѕРґ РєРѕРЅС‚СЂРѕР»РµРј`);

  renderHomeBento();

  const dueList = document.getElementById("home-due-list");
  dueList.innerHTML = state.dueBundles.length
    ? state.dueBundles.slice(0, 2).map((bundle) => renderCollectionCard(bundle, { variant: "due", go: "collection", nav: "home" })).join("")
    : renderEmptyCard("РќРµС‚ СЃР±РѕСЂРѕРІ, РіРґРµ РЅСѓР¶РЅРѕ РїР»Р°С‚РёС‚СЊ.");

  const organizerList = document.getElementById("home-organizer-list");
  organizerList.innerHTML = state.organizerBundles.length
    ? state.organizerBundles.slice(0, 2).map((bundle) => renderCollectionCard(bundle, { variant: "organizer", go: "organizer", nav: "collections" })).join("")
    : renderEmptyCard("РћСЂРіР°РЅРёР·Р°С‚РѕСЂСЃРєРёС… СЃР±РѕСЂРѕРІ РїРѕРєР° РЅРµС‚.");

  const homeNotifications = document.getElementById("home-notifications-list");
  homeNotifications.innerHTML = state.notifications.length
    ? state.notifications
        .slice(0, 3)
        .map((notification) => renderNotificationCard(notification, { compact: true }))
        .join("")
    : renderEmptyCard("Р’С…РѕРґСЏС‰РёРµ РїРѕРєР° РїСѓСЃС‚С‹.");
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
      <span>Рљ РѕРїР»Р°С‚Рµ</span>
      <strong>${formatMoney(dueTotalMinor)}</strong>
      <em>${state.dueBundles.length} Р°РєС‚РёРІРЅС‹С… СЃР±РѕСЂРѕРІ</em>
    </article>
    <article class="bento-item">
      <span>РЎРѕР±СЂР°РЅРѕ</span>
      <strong>${collectedPercent}%</strong>
      <em>${formatMoney(collectedMinor)}</em>
    </article>
    <article class="bento-item ${openDisputes ? "bento-item-alert" : "bento-item-calm"}">
      <span>РЎРїРѕСЂС‹</span>
      <strong>${openDisputes}</strong>
      <em>${openDisputes ? "РЅСѓР¶РЅР° СЂРµР°РєС†РёСЏ" : "С‡РёСЃС‚Рѕ"}</em>
    </article>
  `;
}

function renderInboxScreen() {
  const list = document.getElementById("inbox-list");
  list.innerHTML = state.notifications.length
    ? state.notifications.map((notification) => renderNotificationCard(notification)).join("")
    : renderEmptyCard("РЈРІРµРґРѕРјР»РµРЅРёР№ РїРѕРєР° РЅРµС‚.");
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
      <div class="panel-title">РЎСЂРµР·</div>
      <div class="line-item"><span>РђРєС‚РёРІРЅС‹Рµ</span><strong>${activeParticipantBundles.length}</strong></div>
      <div class="line-item"><span>РСЃС‚РѕСЂРёСЏ</span><strong>${historyParticipantBundles.length}</strong></div>
      <div class="line-item"><span>РћСЂРіР°РЅРёР·СѓСЋ</span><strong>${organizerBundles.length}</strong></div>
    </article>
  `;

  if (state.collectionsFilter === "active") {
    list.innerHTML =
      renderCollectionSection("РўСЂРµР±СѓСЋС‚ РґРµР№СЃС‚РІРёСЏ", actionableBundles, "РћРїР»Р°С‚Р°, СЃРѕРіР»Р°СЃРѕРІР°РЅРёРµ Рё РѕР¶РёРґР°СЋС‰РёРµ РґРµР№СЃС‚РІРёСЏ") +
      renderCollectionSection("РЎРїРѕРєРѕР№РЅС‹Рµ", sortBundles(passiveBundles), "Р‘РµР· СЃСЂРѕС‡РЅС‹С… РґРµР№СЃС‚РІРёР№");
    if (!actionableBundles.length && !passiveBundles.length) {
      list.innerHTML = renderEmptyCard("РќРµС‚ Р°РєС‚РёРІРЅС‹С… СЃР±РѕСЂРѕРІ.");
    }
    return;
  }

  if (state.collectionsFilter === "history") {
    const paidBundles = historyParticipantBundles.filter((bundle) => bundle.collection.status === "paid" || bundle.collection.status === "closed");
    const cancelledBundles = historyParticipantBundles.filter((bundle) => bundle.collection.status === "cancelled");
    list.innerHTML =
      renderCollectionSection("Р—Р°РІРµСЂС€РµРЅРЅС‹Рµ", sortBundles(paidBundles), "РћРїР»Р°С‡РµРЅРЅС‹Рµ Рё Р·Р°РєСЂС‹С‚С‹Рµ") +
      renderCollectionSection("РћС‚РјРµРЅРµРЅРЅС‹Рµ", sortBundles(cancelledBundles), "РЎРѕС…СЂР°РЅРµРЅС‹ РґР»СЏ РёСЃС‚РѕСЂРёРё");
    if (!paidBundles.length && !cancelledBundles.length) {
      list.innerHTML = renderEmptyCard("РСЃС‚РѕСЂРёСЏ РїРѕРєР° РїСѓСЃС‚Р°СЏ.");
    }
    return;
  }

  list.innerHTML =
    renderCollectionSection("Р–РёРІС‹Рµ СЃР±РѕСЂС‹", sortBundles(liveOrganizerBundles), "РўС‹ СѓРїСЂР°РІР»СЏРµС€СЊ РїСЂРѕС†РµСЃСЃРѕРј") +
    renderCollectionSection("РђСЂС…РёРІ РѕСЂРіР°РЅРёР·Р°С‚РѕСЂР°", sortBundles(archivedOrganizerBundles), "Р—Р°РєСЂС‹С‚С‹Рµ Рё Р·Р°РІРµСЂС€РµРЅРЅС‹Рµ");
  if (!liveOrganizerBundles.length && !archivedOrganizerBundles.length) {
    list.innerHTML = renderEmptyCard("РћСЂРіР°РЅРёР·Р°С‚РѕСЂСЃРєРёС… СЃР±РѕСЂРѕРІ РїРѕРєР° РЅРµС‚.");
  }
}

function renderCollectionScreen() {
  const bundle = getSelectedCollectionBundle();
  if (!bundle) {
    return;
  }

  const organizerName = state.userDirectory.get(bundle.collection.organizerId)?.displayName ?? "РћСЂРіР°РЅРёР·Р°С‚РѕСЂ";
  text("collection-title", bundle.collection.title);
  text("collection-subtitle", `РћСЂРіР°РЅРёР·Р°С‚РѕСЂ ${organizerName} В· ${bundle.participants.length} СѓС‡Р°СЃС‚РЅРёРєРѕРІ`);
  text("collection-type-pill", labelizeCollectionType(bundle.collection.type));
  text("collection-balance-main", formatMoney(bundle.userDueMinor));
  text("collection-balance-sub", coveredParticipantsLabel(bundle.coveredParticipants));
  text("collection-progress-copy", `${formatMoney(bundle.collectedMinor)} / ${formatMoney(bundle.collection.totalAmountMinor)}`);
  text("collection-progress-percent", `${bundle.progressPercent}%`);
  text("collection-pay-button", bundle.userDueMinor > 0 ? `РћРїР»Р°С‚РёС‚СЊ ${formatMoney(bundle.userDueMinor)}` : "РЈР¶Рµ РѕРїР»Р°С‡РµРЅРѕ");
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
            ? `РџР»Р°С‚РёС‚ ${displayNameByParticipantId(bundle.participants, participant.paymentResponsibleParticipantId)}`
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
    reviewButton.textContent = canConfirmReview ? `РџРѕРґС‚РІРµСЂРґРёС‚СЊ ${formatMoney(bundle.userDueMinor || 0)}` : "РџРѕРґС‚РІРµСЂР¶РґРµРЅРѕ";
  }

  const disputesList = document.getElementById("collection-disputes-list");
  disputesList.innerHTML = bundle.disputes.length
    ? bundle.disputes
        .map((dispute) => {
          const disputeParticipant = bundle.participants.find((participant) => participant.id === dispute.participantId);
          return `
            <div class="line-item">
              <span>${escapeHtml(disputeParticipant?.displayNameSnapshot ?? "РЈС‡Р°СЃС‚РЅРёРє")}: ${escapeHtml(disputeStatusLabel(dispute.status))}</span>
              <strong>${escapeHtml(labelizeDisputeType(dispute.type))}</strong>
            </div>
          `;
        })
        .join("")
    : renderEmptyCard("РЎРїРѕСЂРѕРІ РїРѕ СЌС‚РѕРјСѓ СЃР±РѕСЂСѓ РїРѕРєР° РЅРµС‚.");

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
    bundle.userDueMinor > 0 ? `РџСЂРѕРґРѕР»Р¶РёС‚СЊ Рє РїРѕРґС‚РІРµСЂР¶РґРµРЅРёСЋ ${formatMoney(bundle.userDueMinor)}` : "РЈР¶Рµ РѕРїР»Р°С‡РµРЅРѕ"
  );
  text("pay-manual-button", bundle.userDueMinor > 0 ? `РџРѕРјРµС‚РёС‚СЊ ${formatMoney(bundle.userDueMinor)}` : "Р СѓС‡РЅР°СЏ РѕРїР»Р°С‚Р° РЅРµ РЅСѓР¶РЅР°");
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
              <span>${escapeHtml(manualPaymentMethodLabel(payment.method))} В· ${escapeHtml(manualPaymentStatusLabel(payment.status))}</span>
              <strong>${formatMoney(payment.amountMinor)}</strong>
            </div>
          `
        )
        .join("")
    : renderEmptyCard("Р—РґРµСЃСЊ РїРѕСЏРІСЏС‚СЃСЏ СЂСѓС‡РЅС‹Рµ РїРµСЂРµРІРѕРґС‹, РµСЃР»Рё С‚С‹ РѕС‚РјРµС‚РёС€СЊ РѕРїР»Р°С‚Сѓ.");
}

function renderPayMethods() {
  const list = document.getElementById("pay-methods-list");
  const activeMethods = state.paymentMethods.filter((method) => method.status === "active");
  if (!activeMethods.length) {
    list.innerHTML = renderEmptyCard("РќРµС‚ Р°РєС‚РёРІРЅРѕР№ РєР°СЂС‚С‹. Р”РµРјРѕ-РїСЂРёРІСЏР·РєР° СЃРѕР·РґР°СЃС‚СЃСЏ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё.");
    return;
  }

  list.innerHTML = activeMethods
    .map((method) => {
      const selected = method.id === state.selectedPaymentMethodId;
      return `
        <button class="option-card${selected ? " selected" : ""}" type="button" data-payment-method-id="${method.id}">
          <div>
            <div class="card-title">${escapeHtml(paymentMethodTitle(method))}</div>
            <div class="card-subtitle">${escapeHtml(method.brand.toUpperCase())} В· ${method.isDefault ? "РѕСЃРЅРѕРІРЅР°СЏ" : "РїСЂРёРІСЏР·Р°РЅР°"}</div>
          </div>
          ${selected ? '<span class="check-dot">вњ“</span>' : ""}
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
  text("organizer-subtitle", `РўС‹ РѕСЂРіР°РЅРёР·Р°С‚РѕСЂ В· ${bundle.participants.length} СѓС‡Р°СЃС‚РЅРёРєРѕРІ`);
  text("organizer-dispute-pill", `${bundle.disputes.length} СЃРїРѕСЂРѕРІ`);
  text("organizer-collected-main", formatMoney(bundle.collectedMinor));
  text("organizer-remaining-main", formatMoney(Math.max(bundle.collection.totalAmountMinor - bundle.collectedMinor, 0)));
  text("organizer-status-note", labelizeCollectionStatus(bundle.collection.status));
  text(
    "organizer-calculate-button",
    bundle.expenses.length ? `РџРµСЂРµСЃС‡РёС‚Р°С‚СЊ (${bundle.expenses.length} СЂР°СЃС…РѕРґРѕРІ)` : "РџРµСЂРµСЃС‡РёС‚Р°С‚СЊ СЃР±РѕСЂ"
  );
  text("organizer-review-button", bundle.calculation ? "РћС‚РїСЂР°РІРёС‚СЊ РЅР° СЃРѕРіР»Р°СЃРѕРІР°РЅРёРµ" : "РЎРЅР°С‡Р°Р»Р° РїРµСЂРµСЃС‡РёС‚Р°С‚СЊ");

  const attention = document.getElementById("organizer-attention-list");
  const items = [];
  for (const dispute of bundle.disputes) {
    const participant = bundle.participants.find((item) => item.id === dispute.participantId);
    items.push(`
      <div class="line-item">
        <span>${escapeHtml(participant?.displayNameSnapshot ?? "РЈС‡Р°СЃС‚РЅРёРє")}: ${escapeHtml(dispute.message)}</span>
        <span class="pill pill-danger">СЃРїРѕСЂ</span>
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
            <span>${escapeHtml(payerName)} РѕС‚РїСЂР°РІРёР» СЂСѓС‡РЅСѓСЋ РѕРїР»Р°С‚Сѓ</span>
            <span class="pill pill-warn">РїРѕРґС‚РІРµСЂР¶РґРµРЅРёРµ</span>
          </div>
        `);
      }
    } else {
      items.push(`
        <div class="line-item">
          <span>Все СЃРїРѕРєРѕР№РЅРѕ, СЃРїРѕСЂРѕРІ Рё СЂСѓС‡РЅС‹С… РїРѕРґС‚РІРµСЂР¶РґРµРЅРёР№ РЅРµС‚.</span>
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
                    <button class="mini-action primary" type="button" data-action="accept-dispute" data-dispute-id="${dispute.id}">РџСЂРёРЅСЏС‚СЊ</button>
                    <button class="mini-action" type="button" data-action="resolve-dispute" data-dispute-id="${dispute.id}">РџРµСЂРµСЃС‡РёС‚Р°С‚СЊ</button>
                    <button class="mini-action danger" type="button" data-action="reject-dispute" data-dispute-id="${dispute.id}">РћС‚РєР»РѕРЅРёС‚СЊ</button>
                  </div>
                `
              : "";
          return `
            <div class="dispute-card">
              <div class="line-item">
                <div class="line-item-copy">
                  <span>${escapeHtml(participant?.displayNameSnapshot ?? "РЈС‡Р°СЃС‚РЅРёРє")} В· ${escapeHtml(labelizeDisputeType(dispute.type))}</span>
                  <div class="section-note">${escapeHtml(dispute.message)}</div>
                </div>
                <strong>${escapeHtml(disputeStatusLabel(dispute.status))}</strong>
              </div>
              ${actionButtons}
            </div>
          `;
        })
        .join("")
    : renderEmptyCard("РђРєС‚РёРІРЅС‹С… СЃРїРѕСЂРѕРІ РЅРµС‚.");

  if (organizerFriendSelect) {
    const availableFriends = state.friends.filter(
      (friend) => !bundle.participants.some((participant) => participant.linkedUserId === friend.userId)
    );
    organizerFriendSelect.innerHTML = availableFriends.length
      ? availableFriends
          .map((friend) => `<option value="${friend.userId}">${escapeHtml(friend.displayName)} В· ${escapeHtml(friend.phone || "РґСЂСѓРі")}</option>`)
          .join("")
      : '<option value="">РќРµС‚ РґСЂСѓР·РµР№ РІРЅРµ СЌС‚РѕРіРѕ СЃР±РѕСЂР°</option>';
    organizerFriendSelect.disabled = !availableFriends.length;
  }

  if (organizerChildResponsibleSelect) {
    const eligiblePayers = bundle.participants.filter((participant) => participant.participantType !== "child");
    organizerChildResponsibleSelect.innerHTML = eligiblePayers.length
      ? eligiblePayers.map((participant) => `<option value="${participant.id}">${escapeHtml(participant.displayNameSnapshot)}</option>`).join("")
      : '<option value="">РЎРЅР°С‡Р°Р»Р° РґРѕР±Р°РІСЊ РІР·СЂРѕСЃР»РѕРіРѕ СѓС‡Р°СЃС‚РЅРёРєР°</option>';
    organizerChildResponsibleSelect.disabled = !eligiblePayers.length;
  }

  const organizerParticipants = document.getElementById("organizer-participants-list");
  organizerParticipants.innerHTML = bundle.participants.length
    ? bundle.participants.map((participant) => renderOrganizerParticipantCard(bundle, participant)).join("")
    : renderEmptyCard("РЈС‡Р°СЃС‚РЅРёРєРѕРІ РїРѕРєР° РЅРµС‚.");

  const organizerExpenses = document.getElementById("organizer-expenses-list");
  organizerExpenses.innerHTML = bundle.expenses.length
    ? bundle.expenses.map((expense) => renderOrganizerExpenseCard(bundle, expense)).join("")
    : renderEmptyCard("Р Р°СЃС…РѕРґРѕРІ РїРѕРєР° РЅРµС‚.");

  renderOrganizerExpenseDraft();

  const organizerTransferPlan = document.getElementById("organizer-transfer-plan");
  organizerTransferPlan.innerHTML = bundle.calculation?.result.transferPlan.length
    ? bundle.calculation.result.transferPlan
        .map((transfer) => {
          const fromName = displayNameByParticipantId(bundle.participants, transfer.fromResponsiblePayerId);
          const toName = displayNameByParticipantId(bundle.participants, transfer.toResponsiblePayerId);
          return `
            <div class="line-item">
              <span>${escapeHtml(fromName)} в†’ ${escapeHtml(toName)}</span>
              <strong>${formatMoney(transfer.amountMinor)}</strong>
            </div>
          `;
        })
        .join("")
    : renderEmptyCard("РџРѕСЃР»Рµ СЂР°СЃС‡РµС‚Р° Р·РґРµСЃСЊ РїРѕСЏРІСЏС‚СЃСЏ РїРµСЂРµРІРѕРґС‹.");

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
                    <button class="mini-action primary" type="button" data-action="confirm-manual-payment" data-manual-payment-id="${payment.id}">РџРѕРґС‚РІРµСЂРґРёС‚СЊ</button>
                    <button class="mini-action danger" type="button" data-action="reject-manual-payment" data-manual-payment-id="${payment.id}">РћС‚РєР»РѕРЅРёС‚СЊ</button>
                  </div>
                `
              : "";
          return `
            <div class="dispute-card">
              <div class="line-item">
                <div class="line-item-copy">
                  <span>${escapeHtml(payerName)} в†’ ${escapeHtml(receiverName)}</span>
                  <div class="section-note">${escapeHtml(manualPaymentMethodLabel(payment.method))}${payment.comment ? ` В· ${escapeHtml(payment.comment)}` : ""}</div>
                </div>
                <strong>${escapeHtml(manualPaymentStatusLabel(payment.status))}</strong>
              </div>
              ${payment.proofUrl ? `<div class="section-note">${escapeHtml(payment.proofUrl)}</div>` : ""}
              ${actions}
            </div>
          `;
        })
        .join("")
    : renderEmptyCard("Р СѓС‡РЅС‹С… РѕРїР»Р°С‚ РїРѕРєР° РЅРµС‚.");

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
      <span>Р“РѕС‚РѕРІРѕ Рє СЃРїРёСЃР°РЅРёСЋ</span>
      <strong>${eligibleCount}</strong>
    </div>
    <div class="line-item">
      <span>Р—Р°Р±Р»РѕРєРёСЂРѕРІР°РЅРѕ</span>
      <strong>${blockedCount}</strong>
    </div>
    <div class="line-item">
      <span>РЈР¶Рµ СЃРѕР·РґР°РЅРѕ</span>
      <strong>${existingCount}</strong>
    </div>
    ${executionSummary ? `
      <div class="line-item">
        <span>РџРѕСЃР»РµРґРЅРёР№ Р·Р°РїСѓСЃРє</span>
        <strong>${executionSummary.createdCount} СЃРѕР·РґР°РЅРѕ / ${executionSummary.skippedCount} РїСЂРѕРїСѓС‰РµРЅРѕ</strong>
      </div>
    ` : ""}
  `;

  autopayList.innerHTML = preview.length
    ? preview
        .map((item) => {
          const participantName = displayNameByParticipantId(bundle.participants, item.participantId);
          const responsibleName = displayNameByParticipantId(bundle.participants, item.responsibleParticipantId);
          const availableAt = item.availableAt ? ` В· СЃ ${formatNotificationTime(item.availableAt)}` : "";
          const note =
            item.status === "eligible"
              ? `${item.category ? `${escapeHtml(item.category)} В· ` : ""}${escapeHtml(responsibleName)}${availableAt}`
              : `${escapeHtml(autoPaymentReasonLabel(item.reasonCode))}${availableAt}`;
          return `
            <div class="dispute-card">
              <div class="line-item">
                <div class="line-item-copy">
                  <span>${escapeHtml(participantName)} в†’ ${escapeHtml(responsibleName)}</span>
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
    : renderEmptyCard("РџСЂРµРґРїСЂРѕСЃРјРѕС‚СЂ Р°РІС‚РѕРїР»Р°С‚РµР¶РµР№ РїРѕСЏРІРёС‚СЃСЏ РїРѕСЃР»Рµ СЂР°СЃС‡РµС‚Р° Рё РЅР°СЃС‚СЂРѕР№РєРё РїСЂР°РІРёР».");

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
    draftNode.innerHTML = renderEmptyCard("Р”РѕР±Р°РІСЊ РїРѕР·РёС†РёРё С‡РµРєР°, РµСЃР»Рё РЅСѓР¶РЅРѕ СЂР°Р·РґРµР»РµРЅРёРµ РїРѕ РїРѕР·РёС†РёСЏРј.");
    return;
  }

  const totalMinor = state.draftExpenseItems.reduce((sum, item) => sum + item.amountMinor, 0);
  draftNode.innerHTML = `
    <article class="detail-panel">
      <div class="panel-title">Р§РµСЂРЅРѕРІРёРє С‡РµРєР° РїРѕ РїРѕР·РёС†РёСЏРј</div>
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
        <span>РС‚РѕРіРѕ РїРѕ РїРѕР·РёС†РёСЏРј</span>
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
          <span>${escapeHtml(participant.displayNameSnapshot)} В· ${escapeHtml(role)}</span>
          <div class="section-note">${responsiblePayerName ? `Р—Р° РЅРµРіРѕ РїР»Р°С‚РёС‚ ${escapeHtml(responsiblePayerName)}` : "РџР»Р°С‚РёС‚ СЃР°Рј Р·Р° СЃРµР±СЏ"}</div>
        </div>
        <strong>${escapeHtml(paymentStatusLabel(participant.paymentStatus))}</strong>
      </div>
      <div class="inline-actions">
        <select id="participant-responsible-${participant.id}" class="text-input compact-select">${payerOptions}</select>
        <button class="mini-action" type="button" data-action="set-responsible-payer" data-participant-id="${participant.id}">РЎРѕС…СЂР°РЅРёС‚СЊ РїР»Р°С‚РµР»СЊС‰РёРєР°</button>
      </div>
      <div class="inline-actions preset-row">
        ${presetButtons}
      </div>
      <div class="inline-actions">
        <select id="participant-relationship-${participant.id}" class="text-input compact-select">${relationshipOptions}</select>
        <input id="participant-weight-${participant.id}" class="text-input compact-select" inputmode="decimal" value="${escapeHtml(String(participant.defaultWeight ?? 1))}" />
        <button class="mini-action primary" type="button" data-action="save-participant-profile" data-participant-id="${participant.id}">РЎРѕС…СЂР°РЅРёС‚СЊ РїСЂРѕС„РёР»СЊ</button>
      </div>
    </div>
  `;
}

function buildResponsiblePayerOptions(participants, participantId) {
  const current = participants.find((participant) => participant.id === participantId) ?? null;
  const eligible = participants.filter((participant) => participant.id !== participantId && participant.participantType !== "child");
  const selectedId = current?.paymentResponsibleParticipantId ?? "";
  const selfOption = `<option value=""${selectedId === "" ? " selected" : ""}>РџР»Р°С‚РёС‚ СЃР°Рј</option>`;
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
    { label: "Р РµР±РµРЅРѕРє 0.5", relationshipHint: "child", defaultWeight: "0.5" },
    { label: "РџР°СЂС‚РЅРµСЂ 1", relationshipHint: "partner", defaultWeight: "1" },
    { label: "Р“РѕСЃС‚СЊ 1", relationshipHint: "guest", defaultWeight: "1" },
    { label: "РЎРµРјСЊСЏ 1", relationshipHint: "family", defaultWeight: "1" }
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
    ["self", "РЎР°Рј"],
    ["partner", "РџР°СЂС‚РЅРµСЂ"],
    ["child", "Р РµР±РµРЅРѕРє"],
    ["guest", "Р“РѕСЃС‚СЊ"],
    ["family", "РЎРµРјСЊСЏ"],
    ["colleague", "РљРѕР»Р»РµРіР°"],
    ["other", "Р”СЂСѓРіРѕРµ"]
  ];
  return options
    .map(([value, label]) => `<option value="${value}"${selected === value ? " selected" : ""}>${escapeHtml(label)}</option>`)
    .join("");
}

function participantRoleLabel(bundle, participant) {
  if (participant.linkedUserId === bundle.collection.organizerId) {
    return "РћСЂРіР°РЅРёР·Р°С‚РѕСЂ";
  }
  if (participant.participantType === "child") {
    return "Р РµР±РµРЅРѕРє";
  }
  if (participant.participantType === "guest") {
    return "Р“РѕСЃС‚СЊ";
  }
  return "РЈС‡Р°СЃС‚РЅРёРє";
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
                  : '<div class="line-item muted"><span>Р‘РµР· item-level РёСЃРєР»СЋС‡РµРЅРёР№</span><em>ok</em></div>'
              }
              <button class="mini-action" type="button" data-action="exclude-expense-item" data-expense-id="${expense.id}" data-expense-item-id="${item.id}">РСЃРєР»СЋС‡РёС‚СЊ РґР»СЏ РІС‹Р±СЂР°РЅРЅРѕРіРѕ</button>
            </div>
          `;
        })
        .join("")
    : '<div class="line-item muted"><span>РџРѕР·РёС†РёРё С‡РµРєР° РЅРµ Р·Р°РґР°РЅС‹</span><em>СЂР°РІРЅРѕРµ РґРµР»РµРЅРёРµ</em></div>';

  return `
    <article class="detail-panel bottom-gap">
      <div class="line-item">
        <div class="line-item-copy">
          <span>${escapeHtml(expense.title)}</span>
          <div class="section-note">${expenseItems.length ? `${expenseItems.length} позиций` : "без детализации"}</div>
        </div>
        <strong>${formatMoney(expense.amountMinor)}</strong>
      </div>
      ${itemsMarkup}
      <div class="mini-section">
        <label class="field-label" for="expense-item-title-${expense.id}">РќРѕРІР°СЏ РїРѕР·РёС†РёСЏ</label>
        <input id="expense-item-title-${expense.id}" class="text-input" placeholder="РќР°РїСЂРёРјРµСЂ, РґРµСЃРµСЂС‚" />
      </div>
      <div class="mini-section">
        <label class="field-label" for="expense-item-amount-${expense.id}">РЎСѓРјРјР° РїРѕР·РёС†РёРё, в‚Ѕ</label>
        <input id="expense-item-amount-${expense.id}" class="text-input" inputmode="decimal" placeholder="300" />
      </div>
      <button class="secondary-button" type="button" data-action="add-expense-item" data-expense-id="${expense.id}">Р”РѕР±Р°РІРёС‚СЊ РїРѕР·РёС†РёСЋ</button>
      ${
        expenseItems.length
          ? `
            <div class="mini-section">
              <label class="field-label" for="expense-rule-participant-${expense.id}">Исключить участника из выбранной позиции</label>
              <select id="expense-rule-participant-${expense.id}" class="text-input">${participantOptions}</select>
            </div>
            <div class="mini-section">
              <label class="field-label" for="expense-rule-reason-${expense.id}">РџСЂРёС‡РёРЅР°</label>
              <input id="expense-rule-reason-${expense.id}" class="text-input" placeholder="РќР°РїСЂРёРјРµСЂ, РЅРµ РїРёР» РІРёРЅРѕ" />
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
                <div class="person-sub">${friend.sharedCollections} РѕР±С‰РёС… СЃР±РѕСЂРѕРІ</div>
              </div>
              <span class="${index === 0 ? "status-chip online" : "pill pill-muted"}">${index === 0 ? "" : "РіРѕС‚РѕРІРѕ"}</span>
            </div>
          `
        )
        .join("")
    : renderEmptyCard("РџРѕРєР° РЅРµС‚ РґСЂСѓР·РµР№. Р”РµРјРѕ-СѓС‡Р°СЃС‚РЅРёРєРё Р±СѓРґСѓС‚ РґРѕР±Р°РІР»РµРЅС‹ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё.");
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
    : renderEmptyCard("Р“СЂСѓРїРї РїРѕРєР° РЅРµС‚.");
}

function renderProfileScreen() {
  text("profile-avatar", initials(state.me?.displayName ?? "РђР»РµРєСЃРµР№"));
  text("profile-name", state.me?.displayName ?? "РђР»РµРєСЃРµР№");
  text("profile-phone", state.me?.phone ?? "");

  const profilePanels = [...document.querySelectorAll('[data-screen="profile"] .detail-panel')];
  const paymentPanel = profilePanels[0];
  const frequentPanel = profilePanels[1];
  const autopayPanel = profilePanels[2];

  if (paymentPanel) {
    paymentPanel.innerHTML = `
      <div class="panel-title">РћРїР»Р°С‚Р°</div>
      <div id="profile-payment-methods-list">
        ${renderProfilePaymentMethods()}
      </div>
      <div class="form-block">
        <label class="field-label" for="profile-card-mask">РўРµСЃС‚РѕРІР°СЏ РєР°СЂС‚Р°</label>
        <input class="text-input" id="profile-card-mask" placeholder="2200 **** **** 4821" />
      </div>
      <div class="chip-wrap">
        <button class="chip is-selected" type="button" data-card-brand="mir">Mir</button>
        <button class="chip" type="button" data-card-brand="visa">Visa</button>
        <button class="chip" type="button" data-card-brand="mastercard">Mastercard</button>
      </div>
      <button class="secondary-button" type="button" data-action="create-payment-setup">РќР°С‡Р°С‚СЊ РїСЂРёРІСЏР·РєСѓ</button>
    `;
  }

  if (frequentPanel) {
    frequentPanel.innerHTML = `
      <div class="panel-title">Р§Р°СЃС‚Рѕ СѓС‡Р°СЃС‚РІСѓСЋС‰РёРµ</div>
      <div id="profile-frequent-list">
        ${renderProfileFrequentPeople()}
      </div>
    `;
  }

  if (autopayPanel) {
    const globalRule = getGlobalAutopayRule();
    autopayPanel.innerHTML = `
        <div class="panel-title">РђРІС‚РѕРїР»Р°С‚Р°</div>
        <div id="profile-autopay-rules-list">
          ${renderProfileAutopayRules()}
        </div>
        <div class="setting-row">
          <div>
            <div class="setting-title">Р’РєР»СЋС‡РёС‚СЊ РїСЂР°РІРёР»Рѕ</div>
            <div class="setting-sub">РћР±С‰РµРµ РїСЂР°РІРёР»Рѕ РґР»СЏ РЅРѕРІС‹С… СЃР±РѕСЂРѕРІ</div>
          </div>
          <button class="switch${globalRule?.enabled ? " is-on" : ""}" id="profile-autopay-enabled" type="button"><span></span></button>
        </div>
        <div class="consent-card">
          <div class="setting-row">
            <div class="switch-copy">
              <div class="setting-title">РЎРѕРіР»Р°СЃРёРµ РЅР° Р°РІС‚РѕСЃРїРёСЃР°РЅРёСЏ</div>
              <div class="setting-sub">Р Р°Р·СЂРµС€Р°СЋ Р·Р°РїСѓСЃРєР°С‚СЊ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРёРµ СЃРїРёСЃР°РЅРёСЏ РїРѕСЃР»Рµ РѕРєРЅР° РІРѕР·СЂР°Р¶РµРЅРёР№ Рё РІ РїСЂРµРґРµР»Р°С… Р»РёРјРёС‚Р°.</div>
            </div>
            <button class="switch${globalRule?.enabled ? " is-on" : ""}" id="profile-autopay-consent" type="button"><span></span></button>
          </div>
        </div>
        <div class="form-block">
          <label class="field-label" for="profile-autopay-limit">Р›РёРјРёС‚ РЅР° СЃР±РѕСЂ, в‚Ѕ</label>
          <input class="text-input" id="profile-autopay-limit" inputmode="decimal" value="${escapeHtml(String((globalRule?.singleCollectionLimitMinor ?? 150000) / 100))}" />
        </div>
        <div class="form-block">
          <label class="field-label" for="profile-autopay-window">РћРєРЅРѕ РІРѕР·СЂР°Р¶РµРЅРёР№, С‡Р°СЃС‹</label>
          <input class="text-input" id="profile-autopay-window" inputmode="numeric" value="${escapeHtml(String(globalRule?.objectionWindowHours ?? 24))}" />
        </div>
        <button class="secondary-button" type="button" data-action="save-autopay-rule">РЎРѕС…СЂР°РЅРёС‚СЊ РїСЂР°РІРёР»Рѕ</button>
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
    setStatus("РџРѕРґС‚РІРµСЂРґРё СЃРїРёСЃР°РЅРёРµ РїРµСЂРµРґ РѕРїР»Р°С‚РѕР№", false);
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
    text("paid-success-copy", `${formatMoney(state.lastPaymentSummary.amountMinor)} РїРµСЂРµРІРµРґРµРЅС‹ РїРѕ СЃР±РѕСЂСѓ В«${state.lastPaymentSummary.collectionTitle}В».`);
    text("paid-progress-copy", `${formatMoney(updatedBundle.collectedMinor)} / ${formatMoney(updatedBundle.collection.totalAmountMinor)}`);
    text("paid-progress-tail", updatedBundle.progressPercent === 100 ? "РЎР±РѕСЂ Р·Р°РєСЂС‹С‚" : `РћСЃС‚Р°Р»РѕСЃСЊ ${formatMoney(updatedBundle.collection.totalAmountMinor - updatedBundle.collectedMinor)}`);
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
  setStatus("Review РїРѕРґС‚РІРµСЂР¶РґРµРЅ", true);
  return;
  if (draftItems.length) {
    setStatus(`Р Р°СЃС…РѕРґ РїРѕ РїРѕР·РёС†РёСЏРј В«${title}В» РґРѕР±Р°РІР»РµРЅ`, true);
    return;
  }
  setStatus("Review РїРѕРґС‚РІРµСЂР¶РґРµРЅ", true);
}

async function markManualPaymentFromUi() {
  const bundle = getSelectedCollectionBundle();
  const transferPlan = getCurrentUserTransfers(bundle);
  if (!bundle?.currentParticipant || !transferPlan.length) {
    setStatus("РќРµС‚ СЂСѓС‡РЅРѕРіРѕ РїРµСЂРµРІРѕРґР° РґР»СЏ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёСЏ", false);
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
  setStatus("Р СѓС‡РЅР°СЏ РѕРїР»Р°С‚Р° РѕС‚РїСЂР°РІР»РµРЅР° РЅР° РїРѕРґС‚РІРµСЂР¶РґРµРЅРёРµ", true);
}

async function createCollectionFromForm() {
  const title = collectionNameInput?.value?.trim();
  if (!title) {
    setStatus("РЈРєР°Р¶Рё РЅР°Р·РІР°РЅРёРµ СЃР±РѕСЂР°", false);
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
  setStatus(`РЎРѕР·РґР°РЅ СЃР±РѕСЂ В«${createdCollection.title}В»`, true);
  triggerCompletionFeedback();
}

async function inviteFriendFromForm() {
  const phone = friendPhoneInput?.value?.trim();
  if (!phone) {
    setStatus("РЈРєР°Р¶Рё РЅРѕРјРµСЂ РґСЂСѓРіР°", false);
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
  setStatus(matchedActor ? "Р”СЂСѓРі РґРѕР±Р°РІР»РµРЅ Рё РїРѕРґС‚РІРµСЂР¶РґРµРЅ" : "РџСЂРёРіР»Р°С€РµРЅРёРµ РґСЂСѓРіСѓ РѕС‚РїСЂР°РІР»РµРЅРѕ", true);
}

async function createGroupFromForm() {
  const title = groupNameInput?.value?.trim();
  if (!title) {
    setStatus("РЈРєР°Р¶Рё РЅР°Р·РІР°РЅРёРµ РіСЂСѓРїРїС‹", false);
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
  setStatus(`РЎРѕР·РґР°РЅР° РіСЂСѓРїРїР° В«${group.title}В»`, true);
}

async function addCollectionFriend() {
  const bundle = getSelectedOrganizerBundle();
  const linkedUserId = organizerFriendSelect?.value;
  if (!bundle || !linkedUserId) {
    setStatus("Р’С‹Р±РµСЂРё РґСЂСѓРіР° РґР»СЏ РґРѕР±Р°РІР»РµРЅРёСЏ", false);
    return;
  }

  const friend = state.friends.find((item) => item.userId === linkedUserId);
  await fetchJson(`/collections/${bundle.collection.id}/participants`, {
    method: "POST",
    token: state.session.accessToken,
    body: {
      linkedUserId,
      displayName: friend?.displayName ?? "РЈС‡Р°СЃС‚РЅРёРє"
    }
  });

  await refreshAppData();
  renderAll();
  renderScreenDependents();
  setStatus(friend ? `${friend.displayName} РґРѕР±Р°РІР»РµРЅ РІ СЃР±РѕСЂ` : "РЈС‡Р°СЃС‚РЅРёРє РґРѕР±Р°РІР»РµРЅ", true);
}

async function addCollectionGuest() {
  const bundle = getSelectedOrganizerBundle();
  const displayName = organizerGuestNameInput?.value?.trim();
  if (!bundle || !displayName) {
    setStatus("РЈРєР°Р¶Рё РёРјСЏ РіРѕСЃС‚СЏ", false);
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
  setStatus(`Р“РѕСЃС‚СЊ В«${displayName}В» РґРѕР±Р°РІР»РµРЅ`, true);
}

async function addCollectionChild() {
  const bundle = getSelectedOrganizerBundle();
  const displayName = organizerChildNameInput?.value?.trim();
  const responsiblePayerParticipantId = organizerChildResponsibleSelect?.value;
  if (!bundle || !displayName || !responsiblePayerParticipantId) {
    setStatus("РЈРєР°Р¶Рё СЂРµР±РµРЅРєР° Рё РєС‚Рѕ Р·Р° РЅРµРіРѕ РїР»Р°С‚РёС‚", false);
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
  setStatus(`Р РµР±РµРЅРѕРє В«${displayName}В» РґРѕР±Р°РІР»РµРЅ`, true);
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
  setStatus("РћС‚РІРµС‚СЃС‚РІРµРЅРЅС‹Р№ РїР»Р°С‚РµР»СЊС‰РёРє РѕР±РЅРѕРІР»РµРЅ", true);
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
    setStatus("Р’РµСЃ СѓС‡Р°СЃС‚РЅРёРєР° РґРѕР»Р¶РµРЅ Р±С‹С‚СЊ Р±РѕР»СЊС€Рµ РЅСѓР»СЏ", false);
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
  setStatus(`РџСЂРѕС„РёР»СЊ СѓС‡Р°СЃС‚РЅРёРєР° РѕР±РЅРѕРІР»РµРЅ: ${relationshipHint}, РІРµСЃ ${defaultWeight}`, true);
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
    setStatus("Р—Р°РїРѕР»РЅРё РЅР°Р·РІР°РЅРёРµ Рё СЃСѓРјРјСѓ СЂР°СЃС…РѕРґР°", false);
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
  setStatus(`Р Р°СЃС…РѕРґ В«${title}В» РґРѕР±Р°РІР»РµРЅ`, true);
}

function addDraftExpenseItem() {
  const title = organizerExpenseItemTitleInput?.value?.trim();
  const amountMinor = parseMoneyToMinor(organizerExpenseItemAmountInput?.value ?? "");
  if (!title || amountMinor <= 0) {
    setStatus("Р—Р°РїРѕР»РЅРё РЅР°Р·РІР°РЅРёРµ Рё СЃСѓРјРјСѓ РїРѕР·РёС†РёРё", false);
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
  setStatus(`РџРѕР·РёС†РёСЏ В«${title}В» РґРѕР±Р°РІР»РµРЅР° РІ С‡РµСЂРЅРѕРІРёРє`, true);
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
    setStatus("Р§РµСЂРЅРѕРІРёРє С‡РµРєР° РїРѕ РїРѕР·РёС†РёСЏРј РѕС‡РёС‰РµРЅ", true);
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
    setStatus("Р—Р°РїРѕР»РЅРё РЅР°Р·РІР°РЅРёРµ Рё СЃСѓРјРјСѓ РЅРѕРІРѕР№ РїРѕР·РёС†РёРё", false);
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
  setStatus(`РџРѕР·РёС†РёСЏ В«${title}В» РґРѕР±Р°РІР»РµРЅР° РІ СЂР°СЃС…РѕРґ`, true);
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
    setStatus("Р’С‹Р±РµСЂРё СѓС‡Р°СЃС‚РЅРёРєР° РґР»СЏ item-level rule", false);
    return;
  }

  await fetchJson(`/expenses/${expenseId}/share-rules`, {
    method: "POST",
    token: state.session.accessToken,
    body: {
      participantId,
      expenseItemId,
      splitMode: "excluded",
      reason: reasonInput?.value?.trim() || "РСЃРєР»СЋС‡РµРЅРѕ из СЃС†РµРЅР°СЂРёСЏ С‡РµРєР° РїРѕ РїРѕР·РёС†РёСЏРј"
    }
  });

  await refreshAppData();
  renderAll();
  renderScreenDependents();
  setStatus("Item-level exclusion РїСЂР°РІРёР»Рѕ РґРѕР±Р°РІР»РµРЅРѕ", true);
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
  setStatus("РЎР±РѕСЂ РїРµСЂРµСЃС‡РёС‚Р°РЅ", true);
}

async function sendCollectionToReview() {
  const bundle = getSelectedOrganizerBundle();
  if (!bundle) {
    return;
  }

  if (!bundle.calculation) {
    setStatus("РЎРЅР°С‡Р°Р»Р° РїРµСЂРµСЃС‡РёС‚Р°Р№ СЃР±РѕСЂ", false);
    return;
  }

  await fetchJson(`/collections/${bundle.collection.id}/send-to-review`, {
    method: "POST",
    token: state.session.accessToken
  });

  await refreshAppData();
  renderAll();
  renderScreenDependents();
  setStatus("РЎР±РѕСЂ РѕС‚РїСЂР°РІР»РµРЅ РЅР° СЃРѕРіР»Р°СЃРѕРІР°РЅРёРµ", true);
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
          ? "Принято организатором из интерфейса"
          : action === "reject"
            ? "Отклонено организатором из интерфейса"
            : "Пересчитано организатором из интерфейса"
    }
  });

  await refreshAppData();
  renderAll();
  renderScreenDependents();
  setStatus(
    action === "accept" ? "РЎРїРѕСЂ РїСЂРёРЅСЏС‚" : action === "reject" ? "РЎРїРѕСЂ РѕС‚РєР»РѕРЅРµРЅ" : "РЎР±РѕСЂ РїРµСЂРµСЃС‡РёС‚Р°РЅ РїРѕ СЃРїРѕСЂСѓ",
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
  setStatus(action === "confirm" ? "Р СѓС‡РЅР°СЏ РѕРїР»Р°С‚Р° РїРѕРґС‚РІРµСЂР¶РґРµРЅР°" : "Р СѓС‡РЅР°СЏ РѕРїР»Р°С‚Р° РѕС‚РєР»РѕРЅРµРЅР°", true);
}

async function createPaymentMethodSetup() {
  const maskedPan = document.getElementById("profile-card-mask")?.value?.trim();
  if (!maskedPan) {
    setStatus("РЈРєР°Р¶Рё С‚РµСЃС‚РѕРІСѓСЋ РєР°СЂС‚Сѓ", false);
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
  setStatus("Р—Р°СЏРІРєР° РЅР° РїСЂРёРІСЏР·РєСѓ СЃРѕР·РґР°РЅР°. РџРѕРґС‚РІРµСЂРґРё РµРµ РЅРёР¶Рµ.", true);
}

async function updatePaymentMethodSetup(source, action) {
  const methodId = source?.getAttribute("data-method-id");
  if (!methodId) {
    return;
  }

  if (action === "confirm") {
    const maskedPan = document.getElementById("profile-card-mask")?.value?.trim();
    if (!maskedPan) {
      setStatus("РЈРєР°Р¶Рё С‚РµСЃС‚РѕРІСѓСЋ РєР°СЂС‚Сѓ РґР»СЏ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёСЏ", false);
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
        reason: "РћС€РёР±РєР° из СЃС†РµРЅР°СЂРёСЏ РїСЂРѕС„РёР»СЏ"
      }
    });
  }

  await refreshAppData();
  renderAll();
  setStatus(action === "confirm" ? "РџСЂРёРІСЏР·РєР° РїРѕРґС‚РІРµСЂР¶РґРµРЅР°" : "РџСЂРёРІСЏР·РєР° РїРµСЂРµРІРµРґРµРЅР° РІ РѕС€РёР±РєСѓ", true);
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
  setStatus("РљР°СЂС‚Р° РѕС‚РІСЏР·Р°РЅР°", true);
}

async function saveAutopayRule() {
  const globalRule = getGlobalAutopayRule();
  const enabled = document.getElementById("profile-autopay-enabled")?.classList.contains("is-on") ?? false;
  const consentEnabled = document.getElementById("profile-autopay-consent")?.classList.contains("is-on") ?? Boolean(globalRule?.enabled);
  const limitMinor = parseMoneyToMinor(document.getElementById("profile-autopay-limit")?.value ?? "");
  const objectionWindowHours = parseIntegerInput(document.getElementById("profile-autopay-window")?.value, 24);

  if (enabled && !consentEnabled) {
    setStatus("Р”Р»СЏ Р°РІС‚РѕРїР»Р°С‚РµР¶РµР№ РЅСѓР¶РЅРѕ СЏРІРЅРѕРµ СЃРѕРіР»Р°СЃРёРµ", false);
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
  setStatus(enabled ? "РџСЂР°РІРёР»Рѕ Р°РІС‚РѕРїР»Р°С‚РµР¶РµР№ СЃРѕС…СЂР°РЅРµРЅРѕ Рё Р°РєС‚РёРІРёСЂРѕРІР°РЅРѕ" : "РџСЂР°РІРёР»Рѕ Р°РІС‚РѕРїР»Р°С‚РµР¶РµР№ СЃРѕС…СЂР°РЅРµРЅРѕ", true);
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
    setStatus(`РџСЂРµРґРїСЂРѕСЃРјРѕС‚СЂ Р°РІС‚РѕРїР»Р°С‚РµР¶РµР№ РѕР±РЅРѕРІР»РµРЅ: РіРѕС‚РѕРІРѕ Рє СЃРїРёСЃР°РЅРёСЋ ${eligibleCount}`, true);
  }
  return preview;
}

async function executeOrganizerAutopay() {
  const bundle = getSelectedOrganizerBundle();
  if (!bundle) {
    throw new Error("Сбор организатора не выбран");
  }

  const rule = getGlobalAutopayRule();
  const confirmed = document.getElementById("organizer-autopay-confirm-switch")?.classList.contains("is-on") ?? false;
  const preview = state.autopayPreviewByCollectionId.get(bundle.collection.id) ?? [];
  const eligibleCount = preview.filter((item) => item.status === "eligible").length;

  if (!rule?.enabled) {
    setStatus("РЎРЅР°С‡Р°Р»Р° РІРєР»СЋС‡Рё Рё СЃРѕС…СЂР°РЅРё РїСЂР°РІРёР»Рѕ Р°РІС‚РѕРїР»Р°С‚РµР¶РµР№", false);
    haptic("warning");
    return;
  }
  if (!eligibleCount) {
    setStatus("РќРµС‚ РіРѕС‚РѕРІС‹С… Р°РІС‚РѕРїР»Р°С‚РµР¶РµР№ РґР»СЏ Р·Р°РїСѓСЃРєР°", false);
    haptic("warning");
    return;
  }
  if (!confirmed) {
    setStatus("РџРѕРґС‚РІРµСЂРґРё РјР°СЃСЃРѕРІС‹Р№ Р·Р°РїСѓСЃРє Р°РІС‚РѕРїР»Р°С‚РµР¶РµР№", false);
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
  setStatus(`РђРІС‚РѕРїР»Р°С‚РµР¶Рё: СЃРѕР·РґР°РЅРѕ ${result.createdPayments.length}, РїСЂРѕРїСѓС‰РµРЅРѕ ${result.skipped.length}`, true);
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
    setStatus("РЎР±РѕСЂ из СѓРІРµРґРѕРјР»РµРЅРёСЏ РЅРµ РЅР°Р№РґРµРЅ", false);
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
    ? `${bundle.disputes.length} СЃРїРѕСЂРѕРІ В· ${bundle.participants.length} СѓС‡Р°СЃС‚РЅРёРєРѕРІ`
    : coveredParticipantsLabel(bundle.coveredParticipants);
  const note = `${labelizeCollectionStatus(bundle.collection.status)} В· ${noteBase}`;
  const metaRight = isOrganizer
    ? `${bundle.disputes.length ? "РµСЃС‚СЊ СЃРїРѕСЂ" : "Р±РµР· СЃРїРѕСЂРѕРІ"}`
    : `${bundle.payments.filter((payment) => payment.status === "succeeded").length + bundle.manualPayments.filter((payment) => payment.status === "confirmed").length} РѕРїР»Р°С‚`;
  const pill = isOrganizer
    ? `<span class="pill ${bundle.disputes.length ? "pill-danger" : "pill-muted"}">${bundle.disputes.length ? "Р’РѕР·СЂР°Р¶РµРЅРёРµ" : "РћСЂРіР°РЅРёР·Р°С‚РѕСЂ"}</span>`
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
    ? state.collections.find((collection) => collection.id === notification.collectionId)?.title ?? "РЎР±РѕСЂ"
    : "РЎРёСЃС‚РµРјР°";

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
    return renderEmptyCard("РџР»Р°С‚РµР¶РЅС‹С… РјРµС‚РѕРґРѕРІ РїРѕРєР° РЅРµС‚.");
  }

  return state.paymentMethods
    .map((method) => {
      const actions =
        method.status === "requires_confirmation"
          ? `
            <div class="inline-actions">
              <button class="mini-action primary" type="button" data-action="confirm-payment-setup" data-method-id="${method.id}">РџРѕРґС‚РІРµСЂРґРёС‚СЊ</button>
              <button class="mini-action danger" type="button" data-action="fail-payment-setup" data-method-id="${method.id}">РћС€РёР±РєР°</button>
            </div>
          `
          : method.status === "active"
            ? `
              <div class="inline-actions">
                <button class="mini-action danger" type="button" data-action="revoke-payment-method" data-method-id="${method.id}">РћС‚РІСЏР·Р°С‚СЊ</button>
              </div>
            `
            : "";

      return `
        <div class="dispute-card">
          <div class="line-item">
            <div class="line-item-copy">
              <span>${escapeHtml(paymentMethodTitle(method))}</span>
              <div class="section-note">${escapeHtml(method.brand.toUpperCase())}${method.providerSetupId ? ` В· РїСЂРёРІСЏР·РєР° ${escapeHtml(method.providerSetupId)}` : ""}</div>
            </div>
            <strong>${escapeHtml(paymentMethodStatusLabel(method.status))}${method.isDefault ? " В· РѕСЃРЅРѕРІРЅР°СЏ" : ""}</strong>
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
    return renderEmptyCard("Р”СЂСѓР·СЊСЏ РїРѕСЏРІСЏС‚СЃСЏ РїРѕСЃР»Рµ РїСЂРёРіР»Р°С€РµРЅРёСЏ.");
  }

  return state.friends
    .slice(0, 3)
    .map(
      (friend, index) => `
        <div class="person-row compact">
          <div class="avatar ${avatarTone(index)}">${escapeHtml(initials(friend.displayName))}</div>
          <div class="person-meta">
            <div class="person-name">${escapeHtml(friend.displayName)}</div>
            <div class="person-sub">${friend.sharedCollections} РѕР±С‰РёС… СЃР±РѕСЂРѕРІ</div>
          </div>
        </div>
      `
    )
    .join("");
}

function renderProfileAutopayRules() {
  if (!state.autopayRules.length) {
    return renderEmptyCard("РџСЂР°РІРёР»Р° Р°РІС‚РѕРїР»Р°С‚РµР¶РµР№ РїРѕРєР° РЅРµ РЅР°СЃС‚СЂРѕРµРЅС‹.");
  }

  return state.autopayRules
    .map(
      (rule) => `
        <div class="line-item">
          <span>${rule.collectionId ? "СЃР±РѕСЂ" : rule.groupId ? "РіСЂСѓРїРїР°" : "РѕР±С‰РµРµ РїСЂР°РІРёР»Рѕ"} В· ${rule.enabled ? "РІРєР»СЋС‡РµРЅРѕ" : "РІС‹РєР»СЋС‡РµРЅРѕ"}</span>
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
        <div class="person-name">${escapeHtml(participant.displayNameSnapshot)}${participant.linkedUserId === state.me.id ? " (С‚С‹)" : ""}</div>
        ${subLabel ? `<div class="person-sub">${escapeHtml(subLabel)}</div>` : ""}
      </div>
      <span class="pill ${paymentStatusPillClass(participant.paymentStatus)}">${escapeHtml(paymentStatusLabel(participant.paymentStatus))}</span>
    </div>
  `;
}

function renderExplanation(bundle) {
  if (!bundle.calculation || !bundle.coveredParticipants.length) {
    return '<div class="line-item"><span>Р Р°СЃС‡РµС‚ РµС‰Рµ РЅРµ РіРѕС‚РѕРІ.</span><strong>вЂ”</strong></div>';
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
            `<div class="line-item muted"><span>${escapeHtml(line.expenseTitle)}</span><em>${escapeHtml(line.reason ?? "РёСЃРєР»СЋС‡РµРЅРѕ из СЂР°СЃС‡РµС‚Р°")}</em></div>`
        )
        .join("");

      return `
        <div class="mini-section">
          <div class="mini-heading">${escapeHtml(participant.displayNameSnapshot)} вЂ” ${formatMoney(calc.owesAmountMinor)}</div>
          ${included || '<div class="line-item"><span>Р Р°РІРЅРѕРјРµСЂРЅРѕРµ СЂР°СЃРїСЂРµРґРµР»РµРЅРёРµ</span><strong>РІРєР»СЋС‡РµРЅРѕ</strong></div>'}
          ${excluded}
        </div>
      `;
    })
    .filter(Boolean)
    .join('<div class="divider"></div>');

  return lines || '<div class="line-item"><span>РџРѕРґСЂРѕР±РЅРѕСЃС‚Рё РїРѕСЏРІСЏС‚СЃСЏ РїРѕСЃР»Рµ РїРµСЂРµСЃС‡РµС‚Р°.</span><strong>вЂ”</strong></div>';
}

function renderEmptyCard(message) {
  return `
    <article class="detail-panel">
      <div class="line-item">
        <span>${escapeHtml(message)}</span>
        <strong>вЂ”</strong>
      </div>
    </article>
  `;
}

function renderPayConfirmationPanel(bundle) {
  const selectedMethod = state.paymentMethods.find((method) => method.id === state.selectedPaymentMethodId) ?? null;
  const isOpen = state.pendingPayConfirmationCollectionId === bundle.collection.id;

  if (!isOpen) {
    return renderEmptyCard("РџРµСЂРµРґ СЃРїРёСЃР°РЅРёРµРј РїРѕРєР°Р¶РµРј РёС‚РѕРі, РєР°СЂС‚Сѓ Рё РїРѕСЃР»РµРґРЅРµРµ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёРµ.");
  }

  return `
    <article class="detail-panel confirmation-panel">
      <div class="panel-title">Р¤РёРЅР°Р»СЊРЅРѕРµ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёРµ</div>
      <div class="confirmation-grid">
        <div class="line-item">
          <span>РЎР±РѕСЂ</span>
          <strong>${escapeHtml(bundle.collection.title)}</strong>
        </div>
        <div class="line-item">
          <span>РЎСѓРјРјР°</span>
          <strong>${formatMoney(bundle.userDueMinor)}</strong>
        </div>
        <div class="line-item">
          <span>РљР°СЂС‚Р°</span>
          <strong>${escapeHtml(selectedMethod ? paymentMethodTitle(selectedMethod) : "Р‘СѓРґРµС‚ СЃРѕР·РґР°РЅР° С‚РµСЃС‚РѕРІР°СЏ РєР°СЂС‚Р°")}</strong>
        </div>
      </div>
      <div class="consent-card">
        <div class="setting-row">
          <div class="switch-copy">
            <div class="setting-title">РџРѕРґС‚РІРµСЂР¶РґР°СЋ СЃРїРёСЃР°РЅРёРµ</div>
            <div class="setting-sub">РЎСѓРјРјР° Рё РїРѕР»СѓС‡Р°С‚РµР»Рё РїСЂРѕРІРµСЂРµРЅС‹, РјРѕР¶РЅРѕ СЃРѕР·РґР°РІР°С‚СЊ РїР»Р°С‚РµР¶.</div>
          </div>
          <button class="switch" id="pay-confirm-switch" type="button" aria-label="РџРѕРґС‚РІРµСЂРґРёС‚СЊ СЃРїРёСЃР°РЅРёРµ"><span></span></button>
        </div>
      </div>
      <div class="inline-actions stacked-actions">
        <button class="primary-button" type="button" data-action="confirm-pay-now">РџРѕРґС‚РІРµСЂРґРёС‚СЊ РѕРїР»Р°С‚Сѓ</button>
        <button class="secondary-button" type="button" data-action="cancel-pay-confirm">Р’РµСЂРЅСѓС‚СЊСЃСЏ Рё РїСЂРѕРІРµСЂРёС‚СЊ</button>
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
    return renderEmptyCard("Р—РґРµСЃСЊ РїРѕСЏРІРёС‚СЃСЏ РєРѕРЅС‚СЂРѕР»СЊРЅС‹Р№ С€Р°Рі РїРµСЂРµРґ РјР°СЃСЃРѕРІС‹Рј Р·Р°РїСѓСЃРєРѕРј Р°РІС‚РѕРїР»Р°С‚РµР¶РµР№.");
  }

  const consentState = rule?.enabled ? "РЎРѕРіР»Р°СЃРёРµ Р°РєС‚РёРІРЅРѕ" : "РЎРЅР°С‡Р°Р»Р° РІРєР»СЋС‡Рё Рё СЃРѕС…СЂР°РЅРё РїСЂР°РІРёР»Рѕ Р°РІС‚РѕРїР»Р°С‚РµР¶РµР№";
  const consentClass = rule?.enabled ? "pill-success" : "pill-danger";

  return `
    <article class="detail-panel confirmation-panel">
      <div class="panel-title">РљРѕРЅС‚СЂРѕР»СЊ РїРµСЂРµРґ Р·Р°РїСѓСЃРєРѕРј</div>
      <div class="line-item">
        <span>Р“РѕС‚РѕРІС‹С… СѓС‡Р°СЃС‚РЅРёРєРѕРІ</span>
        <strong>${eligibleCount}</strong>
      </div>
      <div class="line-item">
        <span>РЎСѓРјРјР° Рє Р·Р°РїСѓСЃРєСѓ</span>
        <strong>${formatMoney(totalMinor)}</strong>
      </div>
      <div class="line-item">
        <span>Р›РёРјРёС‚ РїСЂР°РІРёР»Р°</span>
        <strong>${formatMoney(rule?.singleCollectionLimitMinor ?? 0)}</strong>
      </div>
      <div class="line-item">
        <span>РЎС‚Р°С‚СѓСЃ СЃРѕРіР»Р°СЃРёСЏ</span>
        <span class="pill ${consentClass}">${consentState}</span>
      </div>
      <div class="consent-card">
        <div class="setting-row">
          <div class="switch-copy">
            <div class="setting-title">Р—Р°РїСѓСЃС‚РёС‚СЊ СЃРїРёСЃР°РЅРёСЏ РїРѕ РіРѕС‚РѕРІС‹Рј СѓС‡Р°СЃС‚РЅРёРєР°Рј</div>
            <div class="setting-sub">Р‘СѓРґСѓС‚ СЃРѕР·РґР°РЅС‹ С‚РѕР»СЊРєРѕ С‚Рµ РїР»Р°С‚РµР¶Рё, РєРѕС‚РѕСЂС‹Рµ СѓР¶Рµ РїСЂРѕС€Р»Рё РІСЃРµ РѕРіСЂР°РЅРёС‡РµРЅРёСЏ Рё РѕРєРЅРѕ РІРѕР·СЂР°Р¶РµРЅРёР№.</div>
          </div>
          <button class="switch" id="organizer-autopay-confirm-switch" type="button" aria-label="РџРѕРґС‚РІРµСЂРґРёС‚СЊ Р·Р°РїСѓСЃРє Р°РІС‚РѕРїР»Р°С‚РµР¶РµР№"><span></span></button>
        </div>
      </div>
      <div class="inline-actions stacked-actions">
        <button class="primary-button" type="button" data-action="confirm-execute-autopay">РџРѕРґС‚РІРµСЂРґРёС‚СЊ Р·Р°РїСѓСЃРє</button>
        <button class="secondary-button" type="button" data-action="cancel-autopay-confirm">РћС‚РјРµРЅР°</button>
      </div>
    </article>
  `;
}

function renderAuditTimeline(auditLog, bundle) {
  if (auditLog === null) {
    return renderEmptyCard("Р–СѓСЂРЅР°Р» РґРµР№СЃС‚РІРёР№ Р·Р°РіСЂСѓР¶Р°РµС‚СЃСЏ.");
  }
  if (!auditLog.length) {
    return renderEmptyCard("РџРѕ СЌС‚РѕРјСѓ СЃР±РѕСЂСѓ РµС‰Рµ РЅРµС‚ СЃРѕР±С‹С‚РёР№.");
  }

  return `
    <div class="timeline-list">
      ${auditLog
        .slice()
        .reverse()
        .map((entry) => {
          const actor = entry.actorUserId ? state.userDirectory.get(entry.actorUserId)?.displayName ?? "РЈС‡Р°СЃС‚РЅРёРє" : "РЎРёСЃС‚РµРјР°";
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
                <div class="timeline-body">${escapeHtml(actor)}${details ? ` В· ${escapeHtml(details)}` : ""}</div>
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
    "collection:created": "РЎР±РѕСЂ СЃРѕР·РґР°РЅ",
    "collection:updated": "РЎР±РѕСЂ РѕР±РЅРѕРІР»РµРЅ",
    "collection:recalculated": "РЎР±РѕСЂ РїРµСЂРµСЃС‡РёС‚Р°РЅ",
    "collection:sent_to_review": "Р Р°СЃС‡РµС‚ РѕС‚РїСЂР°РІР»РµРЅ РЅР° СЃРѕРіР»Р°СЃРѕРІР°РЅРёРµ",
    "payment:created": "РџР»Р°С‚РµР¶ СЃРѕР·РґР°РЅ",
    "payment:paid": "РџР»Р°С‚РµР¶ РїСЂРѕРІРµРґРµРЅ",
    "payment:updated": "РџР»Р°С‚РµР¶ РѕР±РЅРѕРІР»РµРЅ",
    "participant:confirmed": "РЈС‡Р°СЃС‚РЅРёРє РїРѕРґС‚РІРµСЂРґРёР» СЂР°СЃС‡РµС‚",
    "dispute:disputed": "РЎРѕР·РґР°РЅ СЃРїРѕСЂ",
    "dispute:accepted": "РЎРїРѕСЂ РїСЂРёРЅСЏС‚",
    "dispute:rejected": "РЎРїРѕСЂ РѕС‚РєР»РѕРЅРµРЅ",
    "dispute:recalculated": "РЎРїРѕСЂ Р·Р°РєСЂС‹С‚ РїРµСЂРµСЃС‡РµС‚РѕРј",
    "manual_payment:paid": "Р СѓС‡РЅР°СЏ РѕРїР»Р°С‚Р° РѕС‚РјРµС‡РµРЅР°",
    "manual_payment:confirmed": "Р СѓС‡РЅР°СЏ РѕРїР»Р°С‚Р° РїРѕРґС‚РІРµСЂР¶РґРµРЅР°",
    "manual_payment:rejected": "Р СѓС‡РЅР°СЏ РѕРїР»Р°С‚Р° РѕС‚РєР»РѕРЅРµРЅР°",
    "notification:read": "РЈРІРµРґРѕРјР»РµРЅРёРµ РїСЂРѕС‡РёС‚Р°РЅРѕ"
  };
  return labels[`${entry.entityType}:${entry.action}`] ?? `${entry.entityType} В· ${entry.action}`;
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
    return "РџРµСЂСЃРѕРЅР°Р»СЊРЅР°СЏ РґРѕР»СЏ";
  }
  if (participants.length === 1) {
    return `Р—Р° ${participants[0].displayNameSnapshot}`;
  }
  return participants.map((participant) => participant.displayNameSnapshot).join(" + ");
}

function displayNameByParticipantId(participants, participantId) {
  return participants.find((participant) => participant.id === participantId)?.displayNameSnapshot ?? "РґСЂСѓРіРѕРіРѕ СѓС‡Р°СЃС‚РЅРёРєР°";
}

function paymentMethodTitle(method) {
  return `РљР°СЂС‚Р° ${method.maskedPan}`;
}

function labelizeCollectionType(type) {
  const labels = {
    picnic: "РїРёРєРЅРёРє",
    restaurant: "СѓР¶РёРЅ",
    gift: "РїРѕРґР°СЂРѕРє",
    trip: "РїРѕРµР·РґРєР°",
    office: "РѕС„РёСЃ",
    rent: "Р°СЂРµРЅРґР°",
    kids: "РґРµС‚Рё",
    dacha: "РґР°С‡Р°",
    other: "СЃР±РѕСЂ"
  };
  return labels[type] ?? type;
}

function labelizeGroupType(type) {
  const labels = {
    friends: "РґСЂСѓР·СЊСЏ",
    family: "СЃРµРјСЊСЏ",
    work: "СЂР°Р±РѕС‚Р°",
    trip: "РїРѕРµР·РґРєР°",
    event: "РёРІРµРЅС‚",
    other: "РґСЂСѓРіРѕРµ"
  };
  return labels[type] ?? type;
}

function labelizeCollectionStatus(status) {
  const labels = {
    draft: "черновик",
    participants_selected: "СѓС‡Р°СЃС‚РЅРёРєРё",
    expenses_added: "СЂР°СЃС…РѕРґС‹",
    rules_configured: "РїСЂР°РІРёР»Р°",
    review: "СЃРѕРіР»Р°СЃРѕРІР°РЅРёРµ",
    dispute_pending: "СЃРїРѕСЂ",
    finalized: "РёС‚РѕРі",
    payment_pending: "к оплате",
    partially_paid: "С‡Р°СЃС‚РёС‡РЅРѕ РѕРїР»Р°С‡РµРЅРѕ",
    paid: "РѕРїР»Р°С‡РµРЅРѕ",
    closed: "Р·Р°РєСЂС‹С‚",
    cancelled: "РѕС‚РјРµРЅРµРЅ",
    blocked: "Р·Р°Р±Р»РѕРєРёСЂРѕРІР°РЅРѕ"
  };
  return labels[status] ?? status;
}

function labelizeDisputeType(type) {
  const labels = {
    not_eat: "РЅРµ РµР»",
    not_drink: "РЅРµ РїРёР»",
    partial_time: "РЅРµ РІСЃРµ РІСЂРµРјСЏ",
    already_paid: "СѓР¶Рµ РїР»Р°С‚РёР»",
    bought_something: "РєСѓРїРёР» РѕС‚РґРµР»СЊРЅРѕ",
    absent: "РѕС‚СЃСѓС‚СЃС‚РІРѕРІР°Р»",
    guest_absent: "РіРѕСЃС‚СЊ РѕС‚СЃСѓС‚СЃС‚РІРѕРІР°Р»",
    payer_changed: "РґСЂСѓРіРѕР№ РїР»Р°С‚РµР»СЊС‰РёРє",
    other: "РґСЂСѓРіРѕРµ"
  };
  return labels[type] ?? type;
}

function disputeStatusLabel(status) {
  const labels = {
    created: "СЃРѕР·РґР°РЅ",
    under_review: "РЅР° СЂР°СЃСЃРјРѕС‚СЂРµРЅРёРё",
    accepted: "РїСЂРёРЅСЏС‚",
    rejected: "РѕС‚РєР»РѕРЅРµРЅ",
    resolved_by_recalculation: "СЂРµС€РµРЅ РїРµСЂРµСЃС‡РµС‚РѕРј",
    cancelled: "РѕС‚РјРµРЅРµРЅ"
  };
  return labels[status] ?? status;
}

function manualPaymentMethodLabel(method) {
  const labels = {
    sbp: "РЎР‘Рџ",
    cash: "РќР°Р»РёС‡РЅС‹Рµ",
    card: "РљР°СЂС‚Р°",
    other: "Р”СЂСѓРіРѕРµ"
  };
  return labels[method] ?? method;
}

function manualPaymentStatusLabel(status) {
  const labels = {
    submitted: "Р¶РґРµС‚ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёСЏ",
    confirmed: "РїРѕРґС‚РІРµСЂР¶РґРµРЅРѕ",
    rejected: "РѕС‚РєР»РѕРЅРµРЅРѕ"
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
  setStatus("РЎРѕРіР»Р°СЃРѕРІР°РЅРёРµ РїРѕРґС‚РІРµСЂР¶РґРµРЅРѕ", true);
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
                            <span>${escapeHtml(displayNameByParticipantId(bundle.participants, rule.participantId))} В· ${escapeHtml(shareRuleModeLabel(rule.splitMode))}</span>
                            <em>${escapeHtml(describeShareRule(rule))}</em>
                          </div>
                        `
                      )
                      .join("")
                  : '<div class="line-item muted"><span>РќРµС‚ РїСЂР°РІРёР» РїРѕ РїРѕР·РёС†РёСЏРј</span><em>РіРѕС‚РѕРІРѕ</em></div>'
              }
              <button class="mini-action" type="button" data-action="add-expense-rule" data-expense-id="${expense.id}" data-expense-item-id="${item.id}">РџСЂРёРјРµРЅРёС‚СЊ РїСЂР°РІРёР»Рѕ</button>
            </div>
          `;
        })
        .join("")
    : '<div class="line-item muted"><span>РџРѕР·РёС†РёРё С‡РµРєР° РїРѕРєР° РЅРµ РґРѕР±Р°РІР»РµРЅС‹</span><em>СЂР°РІРЅРѕРµ РґРµР»РµРЅРёРµ</em></div>';

  return `
    <article class="detail-panel bottom-gap">
      <div class="line-item">
        <div class="line-item-copy">
          <span>${escapeHtml(expense.title)}</span>
          <div class="section-note">${expenseItems.length ? `${expenseItems.length} позиций` : "без детализации"}</div>
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
              <label class="field-label" for="expense-rule-participant-${expense.id}">Участник</label>
              <select id="expense-rule-participant-${expense.id}" class="text-input">${participantOptions}</select>
            </div>
            <div class="mini-section">
              <label class="field-label" for="expense-rule-mode-${expense.id}">Режим правила</label>
              <select id="expense-rule-mode-${expense.id}" class="text-input">
                <option value="excluded">исключить</option>
                <option value="weights">веса</option>
                <option value="fixed">фиксированно</option>
                <option value="percent">процент</option>
              </select>
            </div>
            <div class="mini-section">
              <label class="field-label" for="expense-rule-value-${expense.id}">Значение правила</label>
              <input id="expense-rule-value-${expense.id}" class="text-input" inputmode="decimal" placeholder="Для фиксированной суммы, процента или веса" />
            </div>
            <div class="mini-section">
              <label class="field-label" for="expense-rule-reason-${expense.id}">Комментарий</label>
              <input id="expense-rule-reason-${expense.id}" class="text-input" placeholder="Например, не пил напитки" />
            </div>
          `
          : ""
      }
    </article>
  `;
}

function describeShareRule(rule) {
  if (rule.splitMode === "excluded") {
    return rule.reason ?? "исключено";
  }
  if (rule.splitMode === "fixed") {
    return `${formatMoney(rule.fixedAmountMinor ?? 0)}${rule.reason ? ` В· ${rule.reason}` : ""}`;
  }
  if (rule.splitMode === "percent") {
    return `${rule.percent ?? 0}%${rule.reason ? ` В· ${rule.reason}` : ""}`;
  }
  if (rule.splitMode === "weights") {
    return `вес ${rule.weight ?? 1}${rule.reason ? ` В· ${rule.reason}` : ""}`;
  }
  return rule.reason ?? shareRuleModeLabel(rule.splitMode);
}

function shareRuleModeLabel(mode) {
  switch (mode) {
    case "excluded":
      return "исключить";
    case "weights":
      return "веса";
    case "fixed":
      return "фиксированно";
    case "percent":
      return "процент";
    default:
      return mode;
  }
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
    setStatus("Выберите участника для правила на уровне позиции", false);
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
  setStatus(`РџСЂР°РІРёР»Рѕ РїРѕ РїРѕР·РёС†РёРё РґРѕР±Р°РІР»РµРЅРѕ: ${splitMode}`, true);
}

function paymentMethodStatusLabel(status) {
  const labels = {
    pending_binding: "РѕР¶РёРґР°РµС‚",
    requires_confirmation: "РЅСѓР¶РЅРѕ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёРµ",
    active: "Р°РєС‚РёРІРЅР°",
    failed: "РѕС€РёР±РєР°",
    expired: "РёСЃС‚РµРєР»Р°",
    revoked: "РѕС‚РІСЏР·Р°РЅР°"
  };
  return labels[status] ?? status;
}

function autoPaymentPreviewStatusLabel(status) {
  const labels = {
    eligible: "РіРѕС‚РѕРІРѕ",
    blocked: "Р·Р°Р±Р»РѕРєРёСЂРѕРІР°РЅРѕ",
    already_exists: "СѓР¶Рµ СЃРѕР·РґР°РЅРѕ"
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
    eligible: "Р“РѕС‚РѕРІРѕ Рє СЃРїРёСЃР°РЅРёСЋ",
    no_rule: "РќРµС‚ РїСЂР°РІРёР»Р°",
    rule_disabled: "РџСЂР°РІРёР»Рѕ РІС‹РєР»СЋС‡РµРЅРѕ",
    missing_payment_method: "РќРµС‚ Р°РєС‚РёРІРЅРѕРіРѕ РјРµС‚РѕРґР°",
    objection_window_open: "РћС‚РєСЂС‹С‚Рѕ РѕРєРЅРѕ РІРѕР·СЂР°Р¶РµРЅРёР№",
    participant_type_not_allowed: "РўРёРї СѓС‡Р°СЃС‚РЅРёРєР° РЅРµ РїРѕРєСЂС‹РІР°РµС‚СЃСЏ",
    covered_participant_limit: "РџСЂРµРІС‹С€РµРЅ Р»РёРјРёС‚ СѓС‡Р°СЃС‚РЅРёРєРѕРІ",
    collection_limit_exceeded: "РџСЂРµРІС‹С€РµРЅ Р»РёРјРёС‚ РЅР° СЃР±РѕСЂ",
    daily_limit_exceeded: "РџСЂРµРІС‹С€РµРЅ РґРЅРµРІРЅРѕР№ Р»РёРјРёС‚",
    monthly_limit_exceeded: "РџСЂРµРІС‹С€РµРЅ РјРµСЃСЏС‡РЅС‹Р№ Р»РёРјРёС‚",
    existing_payment: "РџР»Р°С‚РµР¶ СѓР¶Рµ СЃСѓС‰РµСЃС‚РІСѓРµС‚",
    unlinked_responsible_user: "РќРµС‚ СЃРІСЏР·Р°РЅРЅРѕРіРѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ"
  };
  return labels[reasonCode] ?? reasonCode;
}

function notificationTypeLabel(type) {
  const labels = {
    collection_review_requested: "СЃРѕРіР»Р°СЃРѕРІР°РЅРёРµ",
    participant_confirmed: "РїРѕРґС‚РІРµСЂР¶РґРµРЅРѕ",
    dispute_created: "СЃРїРѕСЂ",
    dispute_updated: "РѕР±РЅРѕРІР»РµРЅРёРµ",
    manual_payment_submitted: "РїРѕРґС‚РІРµСЂР¶РґРµРЅРёРµ",
    manual_payment_confirmed: "СЂСѓС‡РЅР°СЏ РѕРїР»Р°С‚Р°",
    manual_payment_rejected: "РѕС‚РєР»РѕРЅРµРЅРѕ"
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
    pending: "Р¶РґРµС‚ РѕРїР»Р°С‚С‹",
    paid: "РѕРїР»Р°С‡РµРЅРѕ",
    partial: "С‡Р°СЃС‚РёС‡РЅРѕ",
    disputed: "СЃРїРѕСЂ",
    failed: "РѕС€РёР±РєР°"
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
    return "СЃРµР№С‡Р°СЃ";
  }
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function initials(value) {
  return fixBrokenText(value ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "--";
}

function text(id, value) {
  const node = document.getElementById(id);
  if (node) {
    node.textContent = fixBrokenText(value);
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
    apiStatusText.textContent = fixBrokenText(message);
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
  setStatus(error instanceof Error ? error.message : "Р¤СЂРѕРЅС‚РµРЅРґ РЅРµ Р·Р°РїСѓСЃС‚РёР»СЃСЏ", false);
});


