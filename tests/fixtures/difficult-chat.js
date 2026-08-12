(() => {
  "use strict";
  const mode = document.body.dataset.mode;
  const scroller = document.querySelector("#chat-scroll");
  const messages = document.querySelector("#messages");
  const loading = document.querySelector("#loading");
  const makeMessage = (number, extra = "") => {
    const item = document.createElement("article");
    item.className = `message ${extra}`;
    item.dataset.messageId = `message-${String(number).padStart(3, "0")}`;
    item.innerHTML = `<strong>Message ${String(number).padStart(3, "0")}</strong><span>Ordered fixture content ${number}</span>`;
    return item;
  };
  const appendRange = (start, end) => {
    for (let number = start; number <= end; number += 1) messages.appendChild(makeMessage(number, number === 60 ? "newest" : ""));
  };
  const markOldest = () => {
    const first = messages.querySelector(".message");
    if (first) { first.classList.add("oldest"); first.dataset.scroll2pdfHistoryStart = "true"; first.querySelector("span").textContent = "OLDEST MESSAGE MARKER"; }
  };

  if (mode === "virtualized") {
    const total = 160;
    const rowHeight = 78;
    messages.classList.add("virtual-spacer");
    messages.style.height = `${total * rowHeight}px`;
    const render = () => {
      const start = Math.max(0, Math.floor(scroller.scrollTop / rowHeight) - 4);
      const end = Math.min(total - 1, start + 26);
      messages.replaceChildren();
      for (let index = start; index <= end; index += 1) {
        const item = makeMessage(index + 1, `virtual-message ${index === 0 ? "oldest" : ""} ${index === total - 1 ? "newest" : ""}`);
        item.style.top = `${index * rowHeight}px`;
        if (index === 0) { item.dataset.scroll2pdfHistoryStart = "true"; item.querySelector("span").textContent = "OLDEST MESSAGE MARKER"; }
        messages.appendChild(item);
      }
      window.__mountedMessageRange = [start + 1, end + 1];
    };
    scroller.addEventListener("scroll", render);
    render();
  } else {
    const initialStart = mode === "prepend" ? 41 : 1;
    appendRange(initialStart, 60);
    if (mode !== "prepend") markOldest();
  }

  if (mode === "prepend") {
    let nextEnd = 40;
    let loadingHistory = false;
    scroller.addEventListener("scroll", () => {
      if (scroller.scrollTop > 4 || loadingHistory || nextEnd <= 0) return;
      loadingHistory = true;
      loading.classList.add("active");
      loading.setAttribute("aria-busy", "true");
      setTimeout(() => {
        const oldHeight = scroller.scrollHeight;
        const fragment = document.createDocumentFragment();
        const start = Math.max(1, nextEnd - 19);
        for (let number = start; number <= nextEnd; number += 1) fragment.appendChild(makeMessage(number));
        messages.prepend(fragment);
        scroller.scrollTop += scroller.scrollHeight - oldHeight;
        nextEnd = start - 1;
        if (nextEnd === 0) markOldest();
        loading.classList.remove("active");
        loading.removeAttribute("aria-busy");
        loadingHistory = false;
        window.__historyLoads = (window.__historyLoads || 0) + 1;
      }, 240);
    });
  }

  if (mode === "sticky") {
    for (let index = 0; index < messages.children.length; index += 12) {
      const date = document.createElement("div");
      date.className = "sticky-date";
      date.setAttribute("aria-label", `Fixture day ${Math.floor(index / 12) + 1}`);
      date.textContent = `Fixture day ${Math.floor(index / 12) + 1}`;
      messages.insertBefore(date, messages.children[index]);
    }
  }

  if (mode === "lazy-media") {
    const targets = Array.from(messages.querySelectorAll(".message")).filter((_, index) => index % 7 === 2);
    for (const [index, target] of targets.entries()) {
      const image = document.createElement("img");
      image.className = "media";
      image.alt = `Media ${index + 1}`;
      target.appendChild(image);
      setTimeout(() => {
        image.src = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="260" height="90"><rect width="260" height="90" fill="#16a34a"/><text x="20" y="52" font-size="24" fill="white">MEDIA READY ${index + 1}</text></svg>`)}`;
      }, 220 + (index * 80));
    }
  }

  if (mode === "dynamic-resize") {
    let toggle = false;
    scroller.addEventListener("scroll", () => {
      toggle = !toggle;
      scroller.style.width = toggle ? "calc(100% - 5px)" : "100%";
      scroller.style.height = toggle ? "556px" : "560px";
    });
  }

  if (mode === "navigation-change") {
    let changes = 0;
    scroller.addEventListener("scroll", () => {
      changes += 1;
      if (changes === 3) scroller.dataset.conversationId = "conversation-changed";
    });
  }

  scroller.scrollTop = scroller.scrollHeight;
  window.__fixtureOriginalScrollTop = scroller.scrollTop;
  window.__fixtureReady = true;
})();
