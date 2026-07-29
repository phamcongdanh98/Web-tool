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
  sidebarFileName: document.querySelector("#sidebarFileName"),
  sidebarFileMeta: document.querySelector("#sidebarFileMeta"),
  sidebarPageCount: document.querySelector("#sidebarPageCount"),
  fileSizeSummary: document.querySelector("#fileSizeSummary"),
  selectedCount: document.querySelector("#selectedCount"),
  selectAllButton: document.querySelector("#selectAllButton"),
  undoButton: document.querySelector("#undoButton"),
  selectionToolbar: document.querySelector("#selectionToolbar"),
  exportButton: document.querySelector("#exportButton"),
  topExportButton: document.querySelector("#topExportButton"),
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function detectPageCount(file) {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const source = new TextDecoder("latin1").decode(bytes);
    const pageObjects = source.match(/\/Type\s*\/Page\b/g)?.length || 0;
    if (pageObjects > 0) return pageObjects;

    const counts = [...source.matchAll(/\/Count\s+(\d+)/g)]
      .map((match) => Number(match[1]))
      .filter((value) => Number.isInteger(value) && value > 0 && value <= 5000);
    if (counts.length) return Math.max(...counts);
  } catch {
    // Nếu cấu trúc PDF dùng object stream, vẫn hiển thị được ít nhất trang đầu.
  }
  return 1;
}

async function createLegacyPages(fileRecord, fileIndex) {
  const count = await detectPageCount(fileRecord.file);
  return Array.from({ length: count }, (_, pageIndex) => ({
    id: crypto.randomUUID(),
    source: fileRecord.file.name,
    sourceIndex: fileIndex,
    sourcePage: pageIndex + 1,
    previewUrl: `${fileRecord.url}#page=${pageIndex + 1}&toolbar=0&navpanes=0&scrollbar=0&view=FitH`,
    rotation: 0,
    selected: false
  }));
}

async function createPages(fileRecord, fileIndex) {
  if (!window.PDFLib?.PDFDocument) {
    throw new Error("Không thể tải bộ xử lý PDF.");
  }

  const sourceBytes = await fileRecord.file.arrayBuffer();
  const sourceDocument = await window.PDFLib.PDFDocument.load(sourceBytes, {
    updateMetadata: false
  });
  const count = sourceDocument.getPageCount();
  const pages = [];

  for (let pageIndex = 0; pageIndex < count; pageIndex += 1) {
    // Sao chép đối tượng trang gốc; không dùng canvas và không raster hóa trang.
    const singlePageDocument = await window.PDFLib.PDFDocument.create();
    const [copiedPage] = await singlePageDocument.copyPages(sourceDocument, [pageIndex]);
    singlePageDocument.addPage(copiedPage);
    const singlePageBytes = await singlePageDocument.save({
      addDefaultPage: false,
      useObjectStreams: true
    });
    const pageUrl = URL.createObjectURL(
      new Blob([singlePageBytes], { type: "application/pdf" })
    );
    fileRecord.pageUrls.push(pageUrl);
    pages.push({
      id: crypto.randomUUID(),
      source: fileRecord.file.name,
      sourceIndex: fileIndex,
      sourcePage: pageIndex + 1,
      previewUrl: `${pageUrl}#toolbar=0&navpanes=0&scrollbar=0&view=Fit`,
      rotation: 0,
      selected: false
    });
  }

  return pages;
}

async function acceptFiles(fileList) {
  const files = Array.from(fileList || []).filter(
    (file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  );
  if (!files.length) {
    showToast("Hãy chọn ít nhất một file PDF hợp lệ.");
    return;
  }
  snapshot();
  for (const file of files) {
    const fileIndex = state.files.length;
    const fileRecord = { file, pageUrls: [] };
    state.files.push(fileRecord);
    try {
      state.pages.push(...await createPages(fileRecord, fileIndex));
    } catch (error) {
      fileRecord.pageUrls.forEach((url) => URL.revokeObjectURL(url));
      state.files.pop();
      showToast(
        error?.message?.toLowerCase().includes("encrypted")
          ? `Không thể mở ${file.name}: PDF đang được bảo vệ bằng mật khẩu.`
          : `Không thể tách đúng các trang của ${file.name}.`
      );
    }
  }
  elements.pdfInput.value = "";
  elements.addPdfInput.value = "";
  render();
}

function pageTemplate(page, index) {
  return `
    <article class="page-card${page.selected ? " is-selected" : ""}" draggable="true" data-id="${page.id}">
      <button class="page-check" type="button" aria-label="Chọn trang ${index + 1}">✓</button>
      <div class="page-paper">
        <div class="page-content" style="--rotation:${page.rotation}deg">
          <embed
            class="page-preview"
            src="${page.previewUrl}"
            type="application/pdf"
            title="Xem trước ${escapeHtml(page.source)}, trang ${page.sourcePage}"
          />
        </div>
        <span class="page-source" title="${escapeHtml(page.source)}">${escapeHtml(page.source)}</span>
      </div>
      <div class="page-label"><strong>Trang ${index + 1}</strong><span>· gốc ${page.sourcePage}</span></div>
    </article>
  `;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function updateSelectionUi() {
  const selected = state.pages.filter((page) => page.selected).length;
  elements.selectedCount.textContent = selected;
  elements.selectionToolbar.classList.toggle("has-selection", selected > 0);
  elements.selectAllButton.textContent =
    selected === state.pages.length ? "Bỏ chọn" : "Chọn tất cả";

  elements.pageGrid.querySelectorAll(".page-card").forEach((card) => {
    const page = state.pages.find((item) => item.id === card.dataset.id);
    const isSelected = Boolean(page?.selected);
    card.classList.toggle("is-selected", isSelected);
    card.querySelector(".page-check")?.setAttribute("aria-pressed", String(isSelected));
  });
}

function updateDocumentUi() {
  const totalBytes = state.files.reduce((sum, record) => sum + record.file.size, 0);
  const firstName = state.files[0]?.file.name || "PDF";
  elements.fileSummary.textContent = `${state.files.length} file PDF`;
  elements.pageSummary.textContent = `${state.pages.length} trang`;
  elements.sidebarFileName.textContent =
    state.files.length === 1 ? firstName : `${state.files.length} file PDF`;
  elements.sidebarFileMeta.textContent = `${state.pages.length} trang · ${formatBytes(totalBytes)}`;
  elements.sidebarPageCount.textContent = `${state.pages.length} trang`;
  elements.fileSizeSummary.textContent = formatBytes(totalBytes);
}

function render() {
  const hasPages = state.pages.length > 0;
  elements.emptyState.hidden = hasPages;
  elements.editor.hidden = !hasPages;
  if (!hasPages) return;

  elements.pageGrid.innerHTML = state.pages.map(pageTemplate).join("");
  updateDocumentUi();
  updateSelectionUi();
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
  if (action === "rotate-left" || action === "rotate-right") {
    selected.forEach((page) => {
      const content = elements.pageGrid
        .querySelector(`[data-id="${page.id}"] .page-content`);
      content?.style.setProperty("--rotation", `${page.rotation}deg`);
    });
    return;
  }
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
  updateSelectionUi();
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
  elements.pageGrid
    .querySelectorAll(".is-dragging")
    .forEach((card) => card.classList.remove("is-dragging"));
});

elements.selectAllButton.addEventListener("click", () => {
  const shouldSelect = !state.pages.every((page) => page.selected);
  state.pages.forEach((page) => { page.selected = shouldSelect; });
  updateSelectionUi();
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

document.querySelector(".editor-sidebar").addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action) updateSelected(action);
  const demoTool = event.target.closest("[data-demo-tool]")?.dataset.demoTool;
  if (demoTool) showToast(`${demoTool} sẽ được nối ở bước xử lý backend.`);
});

function showExportNotice() {
  showToast("Đây là bản duyệt giao diện. Chức năng xuất PDF sẽ được nối ở bước tiếp theo.");
}

elements.exportButton.addEventListener("click", showExportNotice);
elements.topExportButton.addEventListener("click", showExportNotice);

window.addEventListener("beforeunload", () => {
  state.files.forEach((record) => {
    record.pageUrls.forEach((url) => URL.revokeObjectURL(url));
  });
});

render();
