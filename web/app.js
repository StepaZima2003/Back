const state = {
  currentScreen: "home",
  activeNav: "home",
  collectionPaid: false
};

const screens = [...document.querySelectorAll(".screen")];
const navItems = [...document.querySelectorAll(".nav-item")];
const chips = [...document.querySelectorAll(".chip")];
const switches = [...document.querySelectorAll(".switch")];
const statusDot = document.querySelector(".status-dot");
const apiStatusText = document.getElementById("api-status-text");

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest("[data-go], [data-action], .chip, .switch") : null;
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

  const action = target.getAttribute("data-action");
  if (action) {
    runAction(action);
    return;
  }

  const screen = target.getAttribute("data-go");
  if (!screen) {
    return;
  }

  const nav = target.getAttribute("data-nav");
  setActiveScreen(screen, nav ?? state.activeNav);
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

function runAction(action) {
  switch (action) {
    case "open-pay":
      setActiveScreen("pay", "home");
      break;
    case "pay-now":
      state.collectionPaid = true;
      syncCollectionState();
      setActiveScreen("paid", "home");
      break;
    case "submit-dispute":
      setActiveScreen("dispute-sent", "home");
      break;
    default:
      break;
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

function syncCollectionState() {
  const amountText = state.collectionPaid ? "Оплачено" : "3 500 ₽";
  const amountLarge = state.collectionPaid ? "0 ₽" : "3 500 ₽";
  const pillText = state.collectionPaid ? "Оплачено" : "Не оплачено";

  document.querySelectorAll("[data-balance-amount], [data-balance-amount-list]").forEach((node) => {
    node.textContent = amountText;
  });

  const amountLargeNode = document.querySelector("[data-balance-amount-large]");
  if (amountLargeNode) {
    amountLargeNode.textContent = amountLarge;
  }

  const amountPayNode = document.querySelector("[data-balance-amount-pay]");
  if (amountPayNode) {
    amountPayNode.textContent = "3 500 ₽";
  }

  document.querySelectorAll("[data-balance-pill], [data-balance-pill-large], [data-balance-pill-row]").forEach((node) => {
    node.textContent = pillText;
    node.classList.toggle("pill-success", state.collectionPaid);
    node.classList.toggle("pill-warn", !state.collectionPaid);
  });

  const payButton = [...document.querySelectorAll(".primary-button")].find((node) => node.textContent.includes("Оплатить 3 500 ₽"));
  if (payButton && state.collectionPaid) {
    payButton.textContent = "Оплата завершена";
  }
}

async function loadApiStatus() {
  try {
    const response = await fetch("/health");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const health = await response.json();
    if (statusDot) {
      statusDot.classList.add("is-ready");
    }
    if (apiStatusText) {
      apiStatusText.textContent = `${health.service} online`;
    }
  } catch (error) {
    if (apiStatusText) {
      apiStatusText.textContent = "API unavailable";
    }
  }
}

syncCollectionState();
loadApiStatus();
