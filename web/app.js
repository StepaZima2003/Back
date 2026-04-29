const DEMO = {
  alex: { key: "alex", phone: "+79990030001", displayName: "Алексей" },
  sasha: { key: "sasha", phone: "+79990030002", displayName: "Саша" },
  dima: { key: "dima", phone: "+79990030003", displayName: "Дима" },
  masha: { key: "masha", phone: "+79990030004", displayName: "Маша" }
};

const state = {
  currentScreen: "home",
  activeNav: "home",
  session: null,
  actors: {},
  selectedCollectionId: null,
  selectedOrganizerCollectionId: null,
  selectedPaymentMethodId: null,
  lastPaymentSummary: null,
  me: null,
  collections: [],
  collectionBundles: [],
  dueBundles: [],
  organizerBundles: [],
  notifications: [],
  paymentMethods: [],
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

document.addEventListener("click", async (event) => {
  const target = event.target instanceof Element
    ? event.target.closest("[data-go], [data-action], [data-collection-id], [data-organizer-collection-id], [data-payment-method-id], .chip, .switch")
    : null;
  if (!target) {
    return;
  }

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
    renderPayMethods();
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

  const action = target.getAttribute("data-action");
  if (action) {
    await runAction(action);
    return;
  }

  const screen = target.getAttribute("data-go");
  if (!screen) {
    return;
  }

  const nav = target.getAttribute("data-nav");
  setActiveScreen(screen, nav ?? state.activeNav);
  renderScreenDependents();
});

function setActiveScreen(screenName, navName) {
  state.currentScreen = screenName;
  state.activeNav = navName;

  screens.forEach((screen) => {
    screen.classList.toggle("is-active", screen.dataset.screen === screenName);
    if (screen.dataset.screen === screenName) {
      const scrollArea = screen.querySelector(".screen-scroll");
      if (scrollArea) {
        scrollArea.scrollTop = 0;
      }
    }
  });

  navItems.forEach((item) => item.classList.toggle("is-active", item.dataset.nav === navName));
}

async function runAction(action) {
  try {
    switch (action) {
      case "open-pay":
        setActiveScreen("pay", "home");
        renderPayScreen();
        break;
      case "pay-now":
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
      default:
        break;
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Action failed", false);
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
}

async function bootstrap() {
  await pingHealth();
  await loginDemoActors();
  await ensureDemoData();
  await refreshAppData();
  setStatus("demo data ready", true);
  renderAll();
}

async function pingHealth() {
  const response = await fetch("/health");
  if (!response.ok) {
    throw new Error(`Health check failed: ${response.status}`);
  }
  const health = await response.json();
  setStatus(`${health.service} online`, true);
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
  const [me, collections, notifications, paymentMethods, friendships, groups] = await Promise.all([
    fetchJson("/me", { token }),
    fetchJson("/collections", { token }),
    fetchJson("/notifications", { token }),
    fetchJson("/payment-methods", { token }),
    fetchJson("/friends", { token }),
    fetchJson("/groups", { token })
  ]);

  state.me = me;
  state.collections = collections;
  state.notifications = notifications;
  state.paymentMethods = paymentMethods;
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
  const [participants, calculation, payments, disputes] = await Promise.all([
    fetchJson(`/collections/${collection.id}/participants`, { token }),
    fetchJson(`/collections/${collection.id}/calculations/latest`, { token, allow404: true }),
    fetchJson(`/collections/${collection.id}/payments`, { token, allow404: true }).then((value) => value ?? []),
    fetchJson(`/collections/${collection.id}/disputes`, { token, allow404: true }).then((value) => value ?? [])
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

  const collectedMinor = payments
    .filter((payment) => payment.status === "succeeded")
    .reduce((sum, payment) => sum + payment.amountMinor, 0);

  const progressPercent = collection.totalAmountMinor > 0
    ? Math.min(100, Math.round((collectedMinor / collection.totalAmountMinor) * 100))
    : 0;

  return {
    collection,
    participants,
    calculation,
    payments,
    disputes,
    currentParticipant,
    coveredParticipants,
    userDueMinor,
    collectedMinor,
    progressPercent
  };
}

function renderAll() {
  renderHome();
  renderCollectionsScreen();
  renderCollectionScreen();
  renderPayScreen();
  renderOrganizerScreen();
  renderFriendsScreen();
  renderGroupsScreen();
  renderProfileScreen();
}

function renderScreenDependents() {
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

  const dueList = document.getElementById("home-due-list");
  dueList.innerHTML = state.dueBundles.length
    ? state.dueBundles.slice(0, 2).map((bundle) => renderCollectionCard(bundle, { variant: "due", go: "collection", nav: "home" })).join("")
    : renderEmptyCard("Нет сборов, где нужно платить.");

  const organizerList = document.getElementById("home-organizer-list");
  organizerList.innerHTML = state.organizerBundles.length
    ? state.organizerBundles.slice(0, 2).map((bundle) => renderCollectionCard(bundle, { variant: "organizer", go: "organizer", nav: "collections" })).join("")
    : renderEmptyCard("Организаторских сборов пока нет.");
}

function renderCollectionsScreen() {
  const list = document.getElementById("collections-list");
  list.innerHTML = state.collectionBundles.length
    ? state.collectionBundles
        .map((bundle) =>
          renderCollectionCard(bundle, {
            variant: bundle.collection.organizerId === state.me.id ? "organizer" : bundle.userDueMinor > 0 ? "due" : "neutral",
            go: bundle.collection.organizerId === state.me.id ? "organizer" : "collection",
            nav: bundle.collection.organizerId === state.me.id ? "collections" : "home"
          })
        )
        .join("")
    : renderEmptyCard("Сборов пока нет.");
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
}

function renderPayScreen() {
  const bundle = getSelectedCollectionBundle();
  if (!bundle) {
    return;
  }

  text("pay-subtitle", bundle.collection.title);
  text("pay-balance-main", formatMoney(bundle.userDueMinor));
  text("pay-balance-sub", coveredParticipantsLabel(bundle.coveredParticipants));
  text("pay-submit-button", bundle.userDueMinor > 0 ? `Оплатить ${formatMoney(bundle.userDueMinor)}` : "Уже оплачено");
  renderPayMethods();
}

function renderPayMethods() {
  const list = document.getElementById("pay-methods-list");
  const activeMethods = state.paymentMethods.filter((method) => method.status === "active");
  if (!activeMethods.length) {
    list.innerHTML = renderEmptyCard("Нет активной карты. Demo bind создастся автоматически.");
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

  text("organizer-subtitle", `Ты организатор · ${bundle.participants.length} участников`);
  text("organizer-dispute-pill", `${bundle.disputes.length} споров`);
  text("organizer-collected-main", formatMoney(bundle.collectedMinor));
  text("organizer-remaining-main", formatMoney(Math.max(bundle.collection.totalAmountMinor - bundle.collectedMinor, 0)));

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
    items.push(`
      <div class="line-item">
        <span>Все спокойно, споров и ручных подтверждений нет.</span>
        <span class="pill pill-success">ok</span>
      </div>
    `);
  }
  attention.innerHTML = items.join("");
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
              <span class="${index === 0 ? "status-chip online" : "pill pill-muted"}">${index === 0 ? "" : "ok"}</span>
            </div>
          `
        )
        .join("")
    : renderEmptyCard("Пока нет друзей. Demo-актеры будут добавлены автоматически.");
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
}

async function submitPayment() {
  const bundle = getSelectedCollectionBundle();
  if (!bundle || !bundle.currentParticipant || bundle.userDueMinor <= 0) {
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
      type: "other",
      message
    }
  });

  disputeCommentInput.value = "";
  await refreshAppData();
  renderAll();
  setActiveScreen("dispute-sent", "home");
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

function getSelectedCollectionBundle() {
  return state.collectionBundles.find((bundle) => bundle.collection.id === state.selectedCollectionId) ?? state.collectionBundles[0] ?? null;
}

function getSelectedOrganizerBundle() {
  return state.organizerBundles.find((bundle) => bundle.collection.id === state.selectedOrganizerCollectionId) ?? state.organizerBundles[0] ?? null;
}

function getSelectedCollectionType() {
  return document.querySelector('[data-screen="new"] [data-collection-type].is-selected')?.getAttribute("data-collection-type") ?? "picnic";
}

function renderCollectionCard(bundle, options) {
  const isOrganizer = options.variant === "organizer";
  const dueText = bundle.userDueMinor > 0 ? formatMoney(bundle.userDueMinor) : formatMoney(Math.max(bundle.collection.totalAmountMinor - bundle.collectedMinor, 0));
  const note = isOrganizer
    ? `${bundle.disputes.length} споров · ${bundle.participants.length} участников`
    : coveredParticipantsLabel(bundle.coveredParticipants);
  const metaRight = isOrganizer
    ? `${bundle.disputes.length ? "есть спор" : "без споров"}`
    : `${bundle.payments.filter((payment) => payment.status === "succeeded").length} оплат`;
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
  setStatus(error instanceof Error ? error.message : "frontend bootstrap failed", false);
});
