"use strict";

/* =========================================================
   CẤU HÌNH
========================================================= */

const THEME_STORAGE_KEY =
  "nen-pdf-theme";

const MAX_FILE_SIZE =
  500 * 1024 * 1024;


/* =========================================================
   TRẠNG THÁI
========================================================= */

const state = {
  file: null,

  sourceObjectUrl: null,
  resultObjectUrl: null,

  resultBlob: null,
  resultFilename: null,

  progressTimer: null,
  toastTimer: null,
  currentJobId: null,

  isCompressing: false
};


/* =========================================================
   DOM
========================================================= */

const elements = {
  themeToggle:
    document.getElementById(
      "themeToggle"
    ),

  themeIcon:
    document.getElementById(
      "themeIcon"
    ),

  themeText:
    document.getElementById(
      "themeText"
    ),

  historyButton:
    document.getElementById(
      "historyButton"
    ),

  aboutButton:
    document.getElementById(
      "aboutButton"
    ),

  uploadZone:
    document.getElementById(
      "uploadZone"
    ),

  pdfInput:
    document.getElementById(
      "pdfInput"
    ),

  selectedFile:
    document.getElementById(
      "selectedFile"
    ),

  selectedFileName:
    document.getElementById(
      "selectedFileName"
    ),

  selectedFileMeta:
    document.getElementById(
      "selectedFileMeta"
    ),

  removeFileButton:
    document.getElementById(
      "removeFileButton"
    ),

  targetSize:
    document.getElementById(
      "targetSize"
    ),

  targetUnit:
    document.getElementById(
      "targetUnit"
    ),

  compressionMode:
    document.getElementById(
      "compressionMode"
    ),

  compressionModeDescription:
    document.getElementById(
      "compressionModeDescription"
    ),

  maxDpi:
    document.getElementById(
      "maxDpi"
    ),

  jpegQuality:
    document.getElementById(
      "jpegQuality"
    ),

  qualityOutput:
    document.getElementById(
      "qualityOutput"
    ),

  parallelProcessing:
    document.getElementById(
      "parallelProcessing"
    ),

  compressButton:
    document.getElementById(
      "compressButton"
    ),

  originalSize:
    document.getElementById(
      "originalSize"
    ),

  estimatedSize:
    document.getElementById(
      "estimatedSize"
    ),

  originalPreview:
    document.getElementById(
      "originalPreview"
    ),

  compressedPreview:
    document.getElementById(
      "compressedPreview"
    ),

  originalPageInfo:
    document.getElementById(
      "originalPageInfo"
    ),

  compressedPageInfo:
    document.getElementById(
      "compressedPageInfo"
    ),

  progressStatus:
    document.getElementById(
      "progressStatus"
    ),

  progressPercent:
    document.getElementById(
      "progressPercent"
    ),

  progressFill:
    document.getElementById(
      "progressFill"
    ),

  resultOriginalSize:
    document.getElementById(
      "resultOriginalSize"
    ),

  resultCompressedSize:
    document.getElementById(
      "resultCompressedSize"
    ),

  resultReduction:
    document.getElementById(
      "resultReduction"
    ),

  resultDuration:
    document.getElementById(
      "resultDuration"
    ),

  downloadButton:
    document.getElementById(
      "downloadButton"
    ),

  modalBackdrop:
    document.getElementById(
      "modalBackdrop"
    ),

  modalTitle:
    document.getElementById(
      "modalTitle"
    ),

  modalContent:
    document.getElementById(
      "modalContent"
    ),

  modalCloseButton:
    document.getElementById(
      "modalCloseButton"
    ),

  toast:
    document.getElementById(
      "toast"
    )
};


/* =========================================================
   MÔ TẢ CHẾ ĐỘ
========================================================= */

const compressionModeDescriptions = {
  text:
    "Phù hợp hồ sơ, tài liệu chữ và bảng biểu.",

  balanced:
    "Cân bằng giữa độ rõ, hình ảnh và dung lượng.",

  image:
    "Ưu tiên hình ảnh đẹp hơn; file có thể lớn hơn."
};


/* =========================================================
   DARK MODE
========================================================= */

function getCurrentTheme() {
  return (
    document.documentElement
      .dataset.theme === "dark"
  )
    ? "dark"
    : "light";
}


function updateThemeButton(theme) {
  const isDark =
    theme === "dark";

  elements.themeIcon.textContent =
    isDark ? "☀" : "☾";

  elements.themeText.textContent =
    isDark
      ? "Giao diện sáng"
      : "Giao diện tối";

  const title =
    isDark
      ? "Chuyển sang giao diện sáng"
      : "Chuyển sang giao diện tối";

  elements.themeToggle.setAttribute(
    "aria-label",
    title
  );

  elements.themeToggle.setAttribute(
    "title",
    title
  );
}


function applyTheme(
  theme,
  save = true
) {
  const normalized =
    theme === "dark"
      ? "dark"
      : "light";

  document.documentElement
    .dataset.theme = normalized;

  updateThemeButton(normalized);

  if (save) {
    localStorage.setItem(
      THEME_STORAGE_KEY,
      normalized
    );
  }
}


function toggleTheme() {
  applyTheme(
    getCurrentTheme() === "dark"
      ? "light"
      : "dark"
  );
}


function watchSystemTheme() {
  const mediaQuery =
    window.matchMedia(
      "(prefers-color-scheme: dark)"
    );

  mediaQuery.addEventListener(
    "change",
    (event) => {
      const saved =
        localStorage.getItem(
          THEME_STORAGE_KEY
        );

      if (!saved) {
        applyTheme(
          event.matches
            ? "dark"
            : "light",
          false
        );
      }
    }
  );
}


/* =========================================================
   TIỆN ÍCH
========================================================= */


function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Number(milliseconds) || 0) / 1000;

  if (totalSeconds < 1) {
    return `${Math.round(totalSeconds * 1000)} ms`;
  }

  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(totalSeconds < 10 ? 1 : 0)} giây`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes} phút ${seconds} giây`;
}

function formatBytes(
  bytes,
  decimals = 2
) {
  if (
    !Number.isFinite(bytes) ||
    bytes <= 0
  ) {
    return "—";
  }

  const units = [
    "B",
    "KB",
    "MB",
    "GB"
  ];

  const index =
    Math.min(
      Math.floor(
        Math.log(bytes) /
        Math.log(1024)
      ),
      units.length - 1
    );

  const value =
    bytes /
    1024 ** index;

  return (
    `${value.toFixed(
      index === 0
        ? 0
        : decimals
    )} ${units[index]}`
  );
}


function getTargetBytes() {
  const value =
    Math.max(
      Number(
        elements.targetSize.value
      ) || 0,
      0
    );

  const multiplier =
    elements.targetUnit.value ===
      "KB"
      ? 1024
      : 1024 ** 2;

  return Math.round(
    value * multiplier
  );
}


function getColorMode() {
  const input =
    document.querySelector(
      'input[name="colorMode"]:checked'
    );

  return (
    input?.value === "gray"
  )
    ? "gray"
    : "color";
}


function showToast(message) {
  clearTimeout(
    state.toastTimer
  );

  elements.toast.textContent =
    message;

  elements.toast.classList.add(
    "toast--visible"
  );

  state.toastTimer =
    setTimeout(() => {
      elements.toast.classList.remove(
        "toast--visible"
      );
    }, 3500);
}


function getDownloadFilename() {
  const originalName =
    state.file?.name ||
    "tai-lieu.pdf";

  return originalName.replace(
    /\.pdf$/i,
    "_nen.pdf"
  );
}


/* =========================================================
   OBJECT URL
========================================================= */

function releaseSourceUrl() {
  if (
    state.sourceObjectUrl
  ) {
    URL.revokeObjectURL(
      state.sourceObjectUrl
    );
  }

  state.sourceObjectUrl = null;
}


function releaseResultUrl() {
  if (
    state.resultObjectUrl
  ) {
    URL.revokeObjectURL(
      state.resultObjectUrl
    );
  }

  state.resultObjectUrl = null;
}


function releaseAllUrls() {
  releaseSourceUrl();
  releaseResultUrl();
}


/* =========================================================
   ƯỚC TÍNH
========================================================= */

function estimateCompressedBytes() {
  if (!state.file) {
    return 0;
  }

  const targetBytes =
    getTargetBytes();

  if (targetBytes <= 0) {
    return 0;
  }

  const dpi =
    Number(
      elements.maxDpi.value
    );

  const quality =
    Number(
      elements.jpegQuality.value
    );

  const mode =
    elements.compressionMode.value;

  const colorMode =
    getColorMode();

  const modeFactor = {
    text: 0.87,
    balanced: 1,
    image: 1.17
  }[mode];

  const colorFactor =
    colorMode === "gray"
      ? 0.7
      : 1;

  const dpiFactor =
    (dpi / 150) ** 1.25;

  const qualityFactor =
    (quality / 75) ** 0.78;

  const estimate =
    state.file.size *
    0.27 *
    modeFactor *
    colorFactor *
    dpiFactor *
    qualityFactor;

  return Math.max(
    Math.min(
      estimate,
      targetBytes * 0.97,
      state.file.size * 0.93
    ),
    Math.min(
      targetBytes * 0.5,
      state.file.size * 0.06
    )
  );
}


function updateEstimate() {
  const originalBytes =
    state.file?.size || 0;

  const compressedBytes =
    state.resultBlob
      ? state.resultBlob.size
      : estimateCompressedBytes();

  const reduction =
    originalBytes > 0
      ? Math.max(
          0,
          (
            1 -
            compressedBytes /
            originalBytes
          ) * 100
        )
      : 0;

  elements.originalSize.textContent =
    formatBytes(originalBytes);

  elements.estimatedSize.textContent =
    formatBytes(
      compressedBytes
    );

  elements.resultOriginalSize
    .textContent =
    formatBytes(originalBytes);

  elements.resultCompressedSize
    .textContent =
    formatBytes(
      compressedBytes
    );

  elements.resultReduction
    .textContent =
    originalBytes > 0
      ? `${reduction.toFixed(1)}%`
      : "—";

  elements.resultDuration
    .textContent = "—";
}


/* =========================================================
   RANGE JPEG
========================================================= */

function updateQualitySlider() {
  const input =
    elements.jpegQuality;

  const minimum =
    Number(input.min);

  const maximum =
    Number(input.max);

  const value =
    Number(input.value);

  const progress =
    (
      (value - minimum) /
      (maximum - minimum)
    ) * 100;

  input.style.setProperty(
    "--range-progress",
    `${progress}%`
  );

  elements.qualityOutput
    .textContent =
    `${value}%`;
}


/* =========================================================
   XEM TRƯỚC
========================================================= */

function renderEmptyPreview(
  container,
  message
) {
  container.innerHTML = `
    <div class="empty-preview">
      <span>PDF</span>
      <p>${message}</p>
    </div>
  `;
}


function renderPdfPreview(
  container,
  objectUrl,
  ariaLabel
) {
  container.replaceChildren();

  const object =
    document.createElement(
      "object"
    );

  object.type =
    "application/pdf";

  object.data =
    `${objectUrl}` +
    "#page=1" +
    "&view=FitH" +
    "&toolbar=0" +
    "&navpanes=0";

  object.setAttribute(
    "aria-label",
    ariaLabel
  );

  const fallback =
    document.createElement(
      "div"
    );

  fallback.className =
    "empty-preview";

  fallback.innerHTML = `
    <span>PDF</span>
    <p>
      Trình duyệt không hỗ trợ xem PDF trực tiếp.
    </p>
  `;

  object.append(fallback);
  container.append(object);
}


/* =========================================================
   FILE PDF
========================================================= */

function resetResult() {
  releaseResultUrl();

  state.resultBlob = null;
  state.resultFilename = null;

  elements.downloadButton.disabled =
    true;

  if (
    state.sourceObjectUrl
  ) {
    renderPdfPreview(
      elements.compressedPreview,
      state.sourceObjectUrl,
      "Bản xem trước PDF dự kiến"
    );
  } else {
    renderEmptyPreview(
      elements.compressedPreview,
      "Bản xem trước ước tính"
    );
  }

  updateEstimate();
}


function acceptPdfFile(file) {
  if (!file) {
    return;
  }

  const isPdf =
    file.type ===
      "application/pdf" ||
    file.name
      .toLowerCase()
      .endsWith(".pdf");

  if (!isPdf) {
    showToast(
      "Chỉ hỗ trợ file PDF."
    );

    return;
  }

  if (
    file.size >
    MAX_FILE_SIZE
  ) {
    showToast(
      "File vượt quá giới hạn 500 MB."
    );

    return;
  }

  releaseAllUrls();
  stopFakeProgress();

  state.file = file;
  state.resultBlob = null;

  state.sourceObjectUrl =
    URL.createObjectURL(file);

  elements.selectedFile
    .classList.remove(
      "selected-file--empty"
    );

  elements.selectedFileName
    .textContent =
    file.name;

  elements.selectedFileMeta
    .textContent =
    `PDF • ${formatBytes(
      file.size
    )}`;

  elements.removeFileButton
    .disabled = false;

  elements.compressButton
    .disabled = false;

  renderPdfPreview(
    elements.originalPreview,
    state.sourceObjectUrl,
    "Xem trước PDF gốc"
  );

  renderPdfPreview(
    elements.compressedPreview,
    state.sourceObjectUrl,
    "Bản xem trước PDF dự kiến"
  );

  elements.originalPageInfo
    .textContent =
    "Trang 1 / —";

  elements.compressedPageInfo
    .textContent =
    "Trang 1 / —";

  resetProgress();
  updateEstimate();

  showToast(
    "Đã tải PDF thành công."
  );
}


function removeSelectedFile() {
  if (state.isCompressing) {
    showToast(
      "Không thể xóa file khi đang nén."
    );

    return;
  }

  releaseAllUrls();

  state.file = null;
  state.resultBlob = null;
  state.resultFilename = null;

  elements.pdfInput.value = "";

  elements.selectedFile
    .classList.add(
      "selected-file--empty"
    );

  elements.selectedFileName
    .textContent =
    "Chưa chọn file";

  elements.selectedFileMeta
    .textContent =
    "Hãy chọn một file PDF để bắt đầu";

  elements.removeFileButton
    .disabled = true;

  elements.compressButton
    .disabled = true;

  elements.downloadButton
    .disabled = true;

  renderEmptyPreview(
    elements.originalPreview,
    "Chọn file để xem trước"
  );

  renderEmptyPreview(
    elements.compressedPreview,
    "Bản xem trước ước tính"
  );

  elements.originalPageInfo
    .textContent =
    "Trang — / —";

  elements.compressedPageInfo
    .textContent =
    "Trang — / —";

  resetProgress();
  updateEstimate();
}


/* =========================================================
   THẺ MÀU
========================================================= */

function updateColorCards() {
  document
    .querySelectorAll(
      ".choice-card"
    )
    .forEach((card) => {
      const input =
        card.querySelector(
          'input[type="radio"]'
        );

      card.classList.toggle(
        "choice-card--active",
        Boolean(input?.checked)
      );
    });
}


/* =========================================================
   TIẾN TRÌNH
========================================================= */

function setProgress(
  percent,
  status
) {
  const normalized =
    Math.max(
      0,
      Math.min(
        100,
        Math.round(percent)
      )
    );

  elements.progressPercent
    .textContent =
    `${normalized}%`;

  elements.progressFill
    .style.width =
    `${normalized}%`;

  if (status) {
    elements.progressStatus
      .textContent =
      status;
  }
}


function resetProgress() {
  stopFakeProgress();

  setProgress(
    0,
    "Chưa nén"
  );
}


function stopFakeProgress() {
  if (
    state.progressTimer
  ) {
    clearInterval(
      state.progressTimer
    );
  }

  state.progressTimer = null;
}


function startFakeProgress() {
  stopFakeProgress();

  let progress = 2;

  setProgress(
    progress,
    "Đang tải PDF lên máy chủ..."
  );

  state.progressTimer =
    setInterval(() => {
      if (progress < 18) {
        progress +=
          Math.random() * 2.3;

        setProgress(
          progress,
          "Đang tải PDF lên máy chủ..."
        );

        return;
      }

      if (progress < 42) {
        progress +=
          Math.random() * 1.4;

        setProgress(
          progress,
          "Đang phân tích các trang PDF..."
        );

        return;
      }

      if (progress < 68) {
        progress +=
          Math.random() * 0.9;

        setProgress(
          progress,
          "Đang dò DPI và chất lượng ảnh..."
        );

        return;
      }

      if (progress < 88) {
        progress +=
          Math.random() * 0.35;

        setProgress(
          progress,
          "Đang tạo PDF kết quả..."
        );
      }
    }, 450);
}


/* =========================================================
   NÉN PDF THẬT
========================================================= */

function createCompressionFormData() {
  const formData =
    new FormData();

  formData.append(
    "targetBytes",
    String(getTargetBytes())
  );

  formData.append(
    "mode",
    elements.compressionMode.value
  );

  formData.append(
    "colorMode",
    getColorMode()
  );

  formData.append(
    "maxDpi",
    elements.maxDpi.value
  );

  formData.append(
    "jpegQuality",
    elements.jpegQuality.value
  );

  formData.append(
    "parallelProcessing",
    String(
      elements.parallelProcessing
        .checked
    )
  );

  /*
   * File phải thêm cuối cùng để backend đọc được
   * toàn bộ trường thiết lập trước khi xử lý file.
   */
  formData.append(
    "pdf",
    state.file,
    state.file.name
  );

  return formData;
}


async function readErrorMessage(
  response
) {
  try {
    const data =
      await response.json();

    return (
      data.message ||
      "Máy chủ không thể nén PDF."
    );
  } catch {
    return (
      `Máy chủ trả về lỗi HTTP ` +
      `${response.status}.`
    );
  }
}


async function compressPdf() {
  if (!state.file || state.isCompressing) return;

  if (getTargetBytes() < 200 * 1024) {
    showToast("Dung lượng mục tiêu tối thiểu là 200 KB.");
    return;
  }

  state.isCompressing = true;
  state.currentJobId = null;
  resetResult();
  stopFakeProgress();
  setProgress(2, "Đang tải PDF lên máy chủ...");

  elements.compressButton.disabled = true;
  elements.removeFileButton.disabled = true;
  elements.downloadButton.disabled = true;

  try {
    const createResponse = await fetch("/api/pdf/compress/jobs", {
      method: "POST",
      body: createCompressionFormData()
    });

    if (!createResponse.ok) {
      throw new Error(await readErrorMessage(createResponse));
    }

    const created = await createResponse.json();
    if (!created.jobId) throw new Error("Máy chủ không trả về mã tác vụ.");

    state.currentJobId = created.jobId;
    setProgress(3, "Đã tải lên, đang chờ xử lý...");

    const job = await waitForCompressionJob(created.jobId);
    await loadCompletedJobResult(job);
  } catch (error) {
    setProgress(0, "Nén thất bại");

    const message = error instanceof Error
      ? error.message
      : "Không thể nén PDF.";

    showToast(message);
    openModal(
      "Không thể nén PDF",
      `
        <p>${escapeHtml(message)}</p>
        <p>Hãy kiểm tra:</p>
        <ul>
          <li>File là PDF hợp lệ và không có mật khẩu.</li>
          <li>Dung lượng mục tiêu không quá thấp.</li>
          <li>Máy chủ còn đủ RAM để xử lý file.</li>
        </ul>
      `
    );
  } finally {
    state.isCompressing = false;
    elements.compressButton.disabled = !state.file;
    elements.removeFileButton.disabled = !state.file;
  }
}

async function waitForCompressionJob(jobId) {
  const startedAt = Date.now();
  const maximumWaitMs = 30 * 60 * 1000;

  while (Date.now() - startedAt < maximumWaitMs) {
    const response = await fetch(`/api/pdf/compress/jobs/${encodeURIComponent(jobId)}`, {
      method: "GET",
      cache: "no-store"
    });

    if (!response.ok) throw new Error(await readErrorMessage(response));

    const payload = await response.json();
    const job = payload.job;
    if (!job) throw new Error("Không đọc được trạng thái tác vụ.");

    setProgress(job.progress || 0, job.message || "Đang nén PDF...");

    if (job.status === "completed") return job;
    if (job.status === "failed" || job.status === "cancelled") {
      throw new Error(job.error?.message || job.message || "Tác vụ nén thất bại.");
    }

    await delay(2000);
  }

  throw new Error("Tác vụ nén mất quá nhiều thời gian. Vui lòng thử lại.");
}

async function loadCompletedJobResult(job) {
  setProgress(99, "Đang tải file kết quả...");

  const response = await fetch(job.downloadUrl, {
    method: "GET",
    cache: "no-store"
  });

  if (!response.ok) throw new Error(await readErrorMessage(response));

  const resultBlob = await response.blob();
  if (resultBlob.size <= 0) throw new Error("Máy chủ không trả về PDF hợp lệ.");

  state.resultBlob = resultBlob;
  state.resultFilename = getDownloadFilename();
  releaseResultUrl();
  state.resultObjectUrl = URL.createObjectURL(resultBlob);

  const result = job.result || {};
  const originalSize = Number(job.inputBytes) || state.file.size;
  const compressedSize = Number(job.outputBytes) || resultBlob.size;
  const durationMs = Number(job.durationMs) || Number(result.durationMs) || 0;
  const queueWaitMs = Number(job.queueWaitMs) || 0;
  const reduction = Math.max(0, (1 - compressedSize / originalSize) * 100);

  elements.originalSize.textContent = formatBytes(originalSize);
  elements.estimatedSize.textContent = formatBytes(compressedSize);
  elements.resultOriginalSize.textContent = formatBytes(originalSize);
  elements.resultCompressedSize.textContent = formatBytes(compressedSize);
  elements.resultReduction.textContent = `${reduction.toFixed(1)}%`;
  elements.resultDuration.textContent = formatDuration(durationMs);

  renderPdfPreview(elements.compressedPreview, state.resultObjectUrl, "Xem trước PDF đã nén");
  elements.compressedPageInfo.textContent = result.pageCount
    ? `Trang 1 / ${result.pageCount}`
    : "Trang 1 / —";

  setProgress(100, result.reachedTarget === false
    ? "Hoàn tất nhưng chưa đạt đúng mục tiêu"
    : "Nén hoàn tất");

  elements.downloadButton.disabled = false;

  const message = result.reachedTarget === false
    ? `File mới là ${formatBytes(compressedSize)} sau ${formatDuration(durationMs)}, chưa đạt đúng mục tiêu.`
    : `Đã nén còn ${formatBytes(compressedSize)} trong ${formatDuration(durationMs)}.`;

  showToast(queueWaitMs > 1000
    ? `${message} Chờ hàng đợi ${formatDuration(queueWaitMs)}.`
    : message);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}


/* =========================================================
   TẢI FILE KẾT QUẢ
========================================================= */

function downloadCompressedPdf() {
  if (
    !state.resultBlob ||
    !state.resultObjectUrl
  ) {
    showToast(
      "Chưa có PDF kết quả."
    );

    return;
  }

  const link =
    document.createElement("a");

  link.href =
    state.resultObjectUrl;

  link.download =
    state.resultFilename ||
    "tai-lieu_nen.pdf";

  document.body.append(link);

  link.click();
  link.remove();
}


/* =========================================================
   MODAL
========================================================= */

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function openModal(
  title,
  html
) {
  elements.modalTitle
    .textContent =
    title;

  elements.modalContent
    .innerHTML =
    html;

  elements.modalBackdrop
    .hidden =
    false;

  elements.modalCloseButton
    .focus();
}


function closeModal() {
  elements.modalBackdrop
    .hidden =
    true;
}


/* =========================================================
   THAY ĐỔI THIẾT LẬP
========================================================= */

function handleSettingsChanged() {
  if (
    state.isCompressing
  ) {
    return;
  }

  if (
    state.resultBlob
  ) {
    resetResult();

    setProgress(
      0,
      "Thiết lập đã thay đổi"
    );
  }

  updateEstimate();
}


/* =========================================================
   SỰ KIỆN
========================================================= */

function attachEvents() {
  elements.themeToggle
    .addEventListener(
      "click",
      toggleTheme
    );

  elements.pdfInput
    .addEventListener(
      "change",
      (event) => {
        acceptPdfFile(
          event.target.files?.[0]
        );
      }
    );

  elements.uploadZone
    .addEventListener(
      "keydown",
      (event) => {
        if (
          event.key === "Enter" ||
          event.key === " "
        ) {
          event.preventDefault();

          elements.pdfInput.click();
        }
      }
    );

  elements.uploadZone
    .addEventListener(
      "dragover",
      (event) => {
        event.preventDefault();

        elements.uploadZone
          .classList.add(
            "upload-zone--dragging"
          );
      }
    );

  elements.uploadZone
    .addEventListener(
      "dragleave",
      () => {
        elements.uploadZone
          .classList.remove(
            "upload-zone--dragging"
          );
      }
    );

  elements.uploadZone
    .addEventListener(
      "drop",
      (event) => {
        event.preventDefault();

        elements.uploadZone
          .classList.remove(
            "upload-zone--dragging"
          );

        acceptPdfFile(
          event.dataTransfer
            ?.files?.[0]
        );
      }
    );

  elements.removeFileButton
    .addEventListener(
      "click",
      removeSelectedFile
    );

  elements.targetSize
    .addEventListener(
      "input",
      handleSettingsChanged
    );

  elements.targetUnit
    .addEventListener(
      "change",
      handleSettingsChanged
    );

  elements.compressionMode
    .addEventListener(
      "change",
      () => {
        elements
          .compressionModeDescription
          .textContent =
          compressionModeDescriptions[
            elements
              .compressionMode
              .value
          ];

        handleSettingsChanged();
      }
    );

  elements.maxDpi
    .addEventListener(
      "change",
      handleSettingsChanged
    );

  elements.jpegQuality
    .addEventListener(
      "input",
      () => {
        updateQualitySlider();
        handleSettingsChanged();
      }
    );

  document
    .querySelectorAll(
      'input[name="colorMode"]'
    )
    .forEach((input) => {
      input.addEventListener(
        "change",
        () => {
          updateColorCards();
          handleSettingsChanged();
        }
      );
    });

  elements.parallelProcessing
    .addEventListener(
      "change",
      handleSettingsChanged
    );

  elements.compressButton
    .addEventListener(
      "click",
      compressPdf
    );

  elements.downloadButton
    .addEventListener(
      "click",
      downloadCompressedPdf
    );

  elements.historyButton
    .addEventListener(
      "click",
      () => {
        openModal(
          "Lịch sử nén",
          `
            <p>
              Phiên bản hiện tại không lưu lịch sử
              để bảo vệ tài liệu của bạn.
            </p>

            <p>
              File tải lên và file tạm sẽ được xóa
              khỏi máy chủ sau khi phản hồi kết thúc.
            </p>
          `
        );
      }
    );

  elements.aboutButton
    .addEventListener(
      "click",
      () => {
        openModal(
          "Giới thiệu",
          `
            <p>
              <strong>Nén PDF Thông Minh</strong>
              sử dụng Node.js và MuPDF.js để dựng
              các trang PDF thành ảnh JPEG.
            </p>

            <p>
              Sau đó hệ thống tự dò DPI và chất lượng
              ảnh phù hợp để cố gắng đạt dung lượng
              mục tiêu.
            </p>

            <p>
              Nén mạnh có thể làm mất lớp chữ tìm kiếm,
              liên kết, biểu mẫu và nội dung tương tác.
            </p>
          `
        );
      }
    );

  elements.modalCloseButton
    .addEventListener(
      "click",
      closeModal
    );

  elements.modalBackdrop
    .addEventListener(
      "click",
      (event) => {
        if (
          event.target ===
          elements.modalBackdrop
        ) {
          closeModal();
        }
      }
    );

  document.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key === "Escape" &&
        !elements.modalBackdrop
          .hidden
      ) {
        closeModal();
      }
    }
  );

  window.addEventListener(
    "beforeunload",
    releaseAllUrls
  );
}


/* =========================================================
   KIỂM TRA BACKEND
========================================================= */

async function checkBackend() {
  try {
    const response =
      await fetch(
        "/api/health",
        {
          cache: "no-store"
        }
      );

    if (!response.ok) {
      throw new Error();
    }
  } catch {
    showToast(
      "Không kết nối được backend. Hãy chạy npm start."
    );
  }
}


/* =========================================================
   KHỞI TẠO
========================================================= */

function initializeApp() {
  updateThemeButton(
    getCurrentTheme()
  );

  watchSystemTheme();

  updateQualitySlider();
  updateColorCards();
  updateEstimate();
  resetProgress();

  attachEvents();
  checkBackend();
}


initializeApp();