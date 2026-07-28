"use strict";

const elements = {
  themeToggle: document.querySelector("#themeToggle"),
  pdfInput: document.querySelector("#pdfInput"),
  addPdfInput: document.querySelector("#addPdfInput"),
  dropZone: document.querySelector("#dropZone"),
  emptyState: document.querySelector("#emptyState"),
  editor: document.querySelector("#editor"),
  pageGrid: document.querySelector("#pageGrid"),
  fileSummary: document.querySelector("#fileSummary"),
  pageSummary: document.querySelector("#pageSummary"),
  selectedCount: document.querySelector("#selectedCount"),
  selectAllButton: document.querySelector("#selectAllButton"),
  undoButton: document.querySelector("#undoButton"),
  selectionToolbar: document.querySelector("#selectionToolbar"),
  exportButton: document.querySelector("#exportButton"),
  toast: document.querySelector("#toast")
};

const state = {
  files: [],
  pages: [],
  history: [],
  draggedId: null,
  toastTimer: null
};

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), 2600);
}

function snapshot() {
  state.history.push(structuredClone(state.pages));
  if (state.history.length > 20) state.history.shift();
  elements.undoButton.disabled = false;
}

function createPages(file, fileIndex) {
  // Bản giao diện dùng số trang mô phỏng; backend sẽ thay bằng số trang PDF thật.
  const count = Math.max(3, Math.min(8, Math.round(file.size / 350000) || 4));
  return Array.from({ length: count }, (_, pageIndex) => ({
    id: crypto.randomUUID(),
    source: file.name,
    sourceIndex: fileIndex,
    sourcePage: pageIndex + 1,
    rotation: 0,
    selected: false
  }));
}

function acceptFiles(fileList) {
  const files = Array.from(fileList || []).filter(
    (file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  );
  if (!files.length) {
    showToast("Hãy chọn ít nhất một file PDF hợp lệ.");
    return;
  }
  snapshot();
  files.forEach((file) => {
    const fileIndex = state.files.length;
    state.files.push(file);
    state.pages.push(...createPages(file, fileIndex));
  });
  elements.pdfInput.value = "";
  elements.addPdfInput.value = "";
  render();
}

function pageTemplate(page, index) {
  const lines = Array.from({ length: 5 }, (_, line) =>
    `<div class="page-content__line${line === 4 ? " short" : ""}"></div>`
  ).join("");
  return `
    <article class="page-card${page.selected ? " is-selected" : ""}" draggable="true" data-id="${page.id}">
      <button class="page-check" type="button" aria-label="Chọn trang ${index + 1}">✓</button>
      <div class="page-paper">
        <div class="page-content" style="--rotation:${page.rotation}deg">
          <div class="page-content__title"></div>
          ${lines}
          <div class="page-content__image">${index % 3 === 0 ? "▦" : index % 3 === 1 ? "◫" : "▤"}</div>
          ${lines}
        </div>
        <span class="page-source" title="${page.source}">${page.source}</span>
      </div>
      <div class="page-label"><strong>Trang ${index + 1}</strong><span>· gốc ${page.sourcePage}</span></div>
    </article>
  `;
}

function render() {
  const hasPages = state.pages.length > 0;
  elements.emptyState.hidden = hasPages;
  elements.editor.hidden = !hasPages;
  if (!hasPages) return;

  elements.pageGrid.innerHTML = state.pages.map(pageTemplate).join("");
  const selected = state.pages.filter((page) => page.selected).length;
  elements.fileSummary.textContent = `${state.files.length} file PDF`;
  elements.pageSummary.textContent = `${state.pages.length} trang`;
  elements.selectedCount.textContent = selected;
  elements.selectionToolbar.classList.toggle("has-selection", selected > 0);
  elements.selectAllButton.textContent = selected === state.pages.length ? "Bỏ chọn" : "Chọn tất cả";
}

function updateSelected(action) {
  const selected = state.pages.filter((page) => page.selected);
  if (!selected.length) {
    showToast("Hãy chọn ít nhất một trang trước.");
    return;
  }
  snapshot();
  if (action === "rotate-left") selected.forEach((page) => { page.rotation -= 90; });
  if (action === "rotate-right") selected.forEach((page) => { page.rotation += 90; });
  if (action === "duplicate") {
    const copies = selected.map((page) => ({ ...page, id: crypto.randomUUID(), selected: false }));
    state.pages.push(...copies);
  }
  if (action === "delete") state.pages = state.pages.filter((page) => !page.selected);
  render();
}

elements.themeToggle.addEventListener("click", () => {
  const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("pdf-tool-theme", theme);
});

[elements.pdfInput, elements.addPdfInput].forEach((input) => {
  input.addEventListener("change", (event) => acceptFiles(event.target.files));
});

["dragenter", "dragover"].forEach((eventName) => {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("is-dragging");
  });
});
["dragleave", "drop"].forEach((eventName) => {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("is-dragging");
  });
});
elements.dropZone.addEventListener("drop", (event) => acceptFiles(event.dataTransfer.files));

elements.pageGrid.addEventListener("click", (event) => {
  const card = event.target.closest(".page-card");
  if (!card) return;
  const page = state.pages.find((item) => item.id === card.dataset.id);
  if (!page) return;
  page.selected = !page.selected;
  render();
});

elements.pageGrid.addEventListener("dragstart", (event) => {
  const card = event.target.closest(".page-card");
  if (!card) return;
  state.draggedId = card.dataset.id;
  card.classList.add("is-dragging");
});
elements.pageGrid.addEventListener("dragover", (event) => event.preventDefault());
elements.pageGrid.addEventListener("drop", (event) => {
  event.preventDefault();
  const target = event.target.closest(".page-card");
  if (!target || !state.draggedId || target.dataset.id === state.draggedId) return;
  snapshot();
  const from = state.pages.findIndex((page) => page.id === state.draggedId);
  const to = state.pages.findIndex((page) => page.id === target.dataset.id);
  const [moved] = state.pages.splice(from, 1);
  state.pages.splice(to, 0, moved);
  render();
});
elements.pageGrid.addEventListener("dragend", () => {
  state.draggedId = null;
  render();
});

elements.selectAllButton.addEventListener("click", () => {
  const shouldSelect = !state.pages.every((page) => page.selected);
  state.pages.forEach((page) => { page.selected = shouldSelect; });
  render();
});

elements.undoButton.addEventListener("click", () => {
  const previous = state.history.pop();
  if (!previous) return;
  state.pages = previous;
  elements.undoButton.disabled = state.history.length === 0;
  render();
});

elements.selectionToolbar.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action) updateSelected(action);
});

elements.exportButton.addEventListener("click", () => {
  showToast("Đây là bản duyệt giao diện. Chức năng xuất PDF sẽ được nối ở bước tiếp theo.");
});

render();
