(function () {
  "use strict";

  function syncItemColor() {
    const banner = document.querySelector(".context-banner");
    if (!banner) return;

    const color = getComputedStyle(banner).backgroundColor;
    const cards = document.querySelectorAll(".student-card");
    cards.forEach((card) => {
      card.style.setProperty("--item-color", color);
      if (card.classList.contains("status-submitted")) {
        card.style.backgroundColor = color;
        card.style.borderColor = color;
      }
    });

    document.querySelectorAll(".student-card.status-submitted .student-number").forEach((node) => {
      node.style.backgroundColor = color;
    });

    const selector = document.querySelector("#item-selector");
    if (selector) {
      selector.style.borderColor = color;
      selector.style.boxShadow = `0 0 0 2px color-mix(in srgb, ${color} 18%, transparent)`;
    }
  }

  const observer = new MutationObserver(syncItemColor);
  observer.observe(document.body, { childList: true, subtree: true });
  syncItemColor();
})();
