"use strict";

/* =========================================================
   CONFIG
========================================================= */

const THEME_STORAGE_KEY =
  "document-tools-theme";


/* =========================================================
   STATE
========================================================= */

const state = {
  toastTimer: null
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

  mobileThemeToggle:
    document.getElementById(
      "mobileThemeToggle"
    ),

  mobileThemeIcon:
    document.getElementById(
      "mobileThemeIcon"
    ),

  toolSearch:
    document.getElementById(
      "toolSearch"
    ),

  mobileToolSearch:
    document.getElementById(
      "mobileToolSearch"
    ),

  toolSort:
    document.getElementById(
      "toolSort"
    ),

  toolsGrid:
    document.getElementById(
      "toolsGrid"
    ),

  toolCount:
    document.getElementById(
      "toolCount"
    ),

  emptyTools:
    document.getElementById(
      "emptyTools"
    ),

  toolsSection:
    document.getElementById(
      "toolsSection"
    ),

  exploreButton:
    document.getElementById(
      "exploreButton"
    ),

  helpButton:
    document.getElementById(
      "helpButton"
    ),

  guideNavigationButton:
    document.getElementById(
      "guideNavigationButton"
    ),

  blogButton:
    document.getElementById(
      "blogButton"
    ),

  contactButton:
    document.getElementById(
      "contactButton"
    ),

  profileButton:
    document.getElementById(
      "profileButton"
    ),

  mobileProfileButton:
    document.getElementById(
      "mobileProfileButton"
    ),

  mobileMenuButton:
    document.getElementById(
      "mobileMenuButton"
    ),

  mobileMenu:
    document.getElementById(
      "mobileMenu"
    ),

  mobileMenuClose:
    document.getElementById(
      "mobileMenuClose"
    ),

  mobileMenuBackdrop:
    document.getElementById(
      "mobileMenuBackdrop"
    ),

  mobileGuideButton:
    document.getElementById(
      "mobileGuideButton"
    ),

  mobileBlogButton:
    document.getElementById(
      "mobileBlogButton"
    ),

  mobileContactButton:
    document.getElementById(
      "mobileContactButton"
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
   THEME
========================================================= */

function getCurrentTheme() {
  return (
    document.documentElement
      .dataset.theme === "dark"
  )
    ? "dark"
    : "light";
}


function updateThemeButtons(theme) {
  const isDark =
    theme === "dark";

  const icon =
    isDark ? "☀" : "☾";

  const title =
    isDark
      ? "Chuyển sang giao diện sáng"
      : "Chuyển sang giao diện tối";

  elements.themeIcon.textContent =
    icon;

  elements.mobileThemeIcon.textContent =
    icon;

  elements.themeToggle.setAttribute(
    "aria-label",
    title
  );

  elements.themeToggle.setAttribute(
    "title",
    title
  );

  elements.mobileThemeToggle.setAttribute(
    "aria-label",
    title
  );
}


function applyTheme(
  theme,
  save = true
) {
  const normalizedTheme =
    theme === "dark"
      ? "dark"
      : "light";

  document.documentElement
    .dataset.theme =
    normalizedTheme;

  updateThemeButtons(
    normalizedTheme
  );

  if (save) {
    localStorage.setItem(
      THEME_STORAGE_KEY,
      normalizedTheme
    );
  }
}


function toggleTheme() {
  const nextTheme =
    getCurrentTheme() === "dark"
      ? "light"
      : "dark";

  applyTheme(nextTheme);
}


function watchSystemTheme() {
  const mediaQuery =
    window.matchMedia(
      "(prefers-color-scheme: dark)"
    );

  mediaQuery.addEventListener(
    "change",
    (event) => {
      const savedTheme =
        localStorage.getItem(
          THEME_STORAGE_KEY
        );

      if (!savedTheme) {
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
   TEXT NORMALIZATION
========================================================= */

function normalizeText(value) {
  return String(value)
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .trim();
}


/* =========================================================
   TOOL SEARCH
========================================================= */

function getSearchKeyword() {
  const desktopValue =
    elements.toolSearch.value;

  const mobileValue =
    elements.mobileToolSearch.value;

  return normalizeText(
    desktopValue ||
    mobileValue
  );
}


function syncSearchInputs(
  sourceInput
) {
  if (
    sourceInput ===
    elements.toolSearch
  ) {
    elements.mobileToolSearch.value =
      elements.toolSearch.value;
  } else {
    elements.toolSearch.value =
      elements.mobileToolSearch.value;
  }
}


function filterTools() {
  const keyword =
    getSearchKeyword();

  const cards =
    Array.from(
      elements.toolsGrid
        .querySelectorAll(
          ".tool-card"
        )
    );

  let visibleCount = 0;

  cards.forEach((card) => {
    const searchableText =
      normalizeText(
        card.dataset.toolName ||
        card.textContent
      );

    const isVisible =
      keyword === "" ||
      searchableText.includes(
        keyword
      );

    card.hidden =
      !isVisible;

    if (isVisible) {
      visibleCount += 1;
    }
  });

  elements.toolCount.textContent =
    `${visibleCount} công cụ`;

  elements.toolsGrid.hidden =
    visibleCount === 0;

  elements.emptyTools.hidden =
    visibleCount !== 0;
}


/* =========================================================
   SORT TOOLS
========================================================= */

function sortTools() {
  const cards =
    Array.from(
      elements.toolsGrid
        .querySelectorAll(
          ".tool-card"
        )
    );

  const sortMode =
    elements.toolSort.value;

  cards.sort(
    (firstCard, secondCard) => {
      if (sortMode === "name") {
        return String(
          firstCard.dataset.toolTitle
        ).localeCompare(
          String(
            secondCard.dataset.toolTitle
          ),
          "vi"
        );
      }

      return (
        Number(
          firstCard.dataset
            .toolPopularity
        ) -
        Number(
          secondCard.dataset
            .toolPopularity
        )
      );
    }
  );

  cards.forEach((card) => {
    elements.toolsGrid.append(card);
  });
}


/* =========================================================
   MODAL
========================================================= */

function openModal(
  title,
  html
) {
  elements.modalTitle.textContent =
    title;

  elements.modalContent.innerHTML =
    html;

  elements.modalBackdrop.hidden =
    false;

  elements.modalCloseButton.focus();
}


function closeModal() {
  elements.modalBackdrop.hidden =
    true;
}


/* =========================================================
   TOAST
========================================================= */

function showToast(message) {
  window.clearTimeout(
    state.toastTimer
  );

  elements.toast.textContent =
    message;

  elements.toast.classList.add(
    "toast--visible"
  );

  state.toastTimer =
    window.setTimeout(() => {
      elements.toast.classList.remove(
        "toast--visible"
      );
    }, 3300);
}


/* =========================================================
   MOBILE MENU
========================================================= */

function openMobileMenu() {
  elements.mobileMenu.hidden =
    false;

  elements.mobileMenuBackdrop.hidden =
    false;

  document.body.style.overflow =
    "hidden";
}


function closeMobileMenu() {
  elements.mobileMenu.hidden =
    true;

  elements.mobileMenuBackdrop.hidden =
    true;

  document.body.style.overflow =
    "";
}


/* =========================================================
   GUIDE
========================================================= */

function showGuide() {
  openModal(
    "Hướng dẫn sử dụng",
    `
      <p>
        Sử dụng các công cụ theo những bước sau:
      </p>

      <ol>
        <li>
          Chọn công cụ phù hợp tại trang chủ.
        </li>

        <li>
          Nhấn <strong>Sử dụng ngay</strong>
          để mở trang xử lý.
        </li>

        <li>
          Tải file cần xử lý lên hệ thống.
        </li>

        <li>
          Điều chỉnh các thiết lập theo nhu cầu.
        </li>

        <li>
          Nhấn nút xử lý và tải file kết quả về máy.
        </li>
      </ol>

      <p>
        Hiện tại công cụ <strong>Nén PDF</strong>
        đã hoạt động. Các công cụ còn lại đang được phát triển.
      </p>
    `
  );
}


/* =========================================================
   PROFILE
========================================================= */

function showProfile() {
  openModal(
    "Tài khoản",
    `
      <p>
        Phiên bản hiện tại không yêu cầu đăng nhập.
      </p>

      <p>
        Khi hệ thống tài khoản được bổ sung,
        bạn có thể lưu lịch sử xử lý,
        thiết lập yêu thích và các file gần đây.
      </p>
    `
  );
}


/* =========================================================
   PLACEHOLDER CONTENT
========================================================= */

function showBlog() {
  openModal(
    "Blog",
    `
      <p>
        Khu vực Blog đang được xây dựng.
      </p>

      <p>
        Nội dung dự kiến gồm hướng dẫn xử lý PDF,
        mẹo giảm dung lượng tài liệu
        và các bài viết về bảo mật file.
      </p>
    `
  );
}


function showContact() {
  openModal(
    "Liên hệ",
    `
      <p>
        Khu vực liên hệ đang được hoàn thiện.
      </p>

      <p>
        Sau này bạn có thể gửi phản hồi,
        báo lỗi hoặc đề xuất công cụ mới tại đây.
      </p>
    `
  );
}


/* =========================================================
   EVENTS
========================================================= */

function attachEvents() {
  elements.themeToggle.addEventListener(
    "click",
    toggleTheme
  );

  elements.mobileThemeToggle.addEventListener(
    "click",
    toggleTheme
  );

  elements.toolSearch.addEventListener(
    "input",
    () => {
      syncSearchInputs(
        elements.toolSearch
      );

      filterTools();
    }
  );

  elements.mobileToolSearch.addEventListener(
    "input",
    () => {
      syncSearchInputs(
        elements.mobileToolSearch
      );

      filterTools();
    }
  );

  elements.toolSort.addEventListener(
    "change",
    sortTools
  );

  elements.exploreButton.addEventListener(
    "click",
    () => {
      elements.toolsSection.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }
  );

  elements.helpButton.addEventListener(
    "click",
    showGuide
  );

  elements.guideNavigationButton.addEventListener(
    "click",
    showGuide
  );

  elements.mobileGuideButton.addEventListener(
    "click",
    () => {
      closeMobileMenu();
      showGuide();
    }
  );

  elements.blogButton.addEventListener(
    "click",
    showBlog
  );

  elements.mobileBlogButton.addEventListener(
    "click",
    () => {
      closeMobileMenu();
      showBlog();
    }
  );

  elements.contactButton.addEventListener(
    "click",
    showContact
  );

  elements.mobileContactButton.addEventListener(
    "click",
    () => {
      closeMobileMenu();
      showContact();
    }
  );

  elements.profileButton.addEventListener(
    "click",
    showProfile
  );

  elements.mobileProfileButton.addEventListener(
    "click",
    showProfile
  );

  elements.mobileMenuButton.addEventListener(
    "click",
    openMobileMenu
  );

  elements.mobileMenuClose.addEventListener(
    "click",
    closeMobileMenu
  );

  elements.mobileMenuBackdrop.addEventListener(
    "click",
    closeMobileMenu
  );

  elements.mobileMenu
    .querySelectorAll("a")
    .forEach((link) => {
      link.addEventListener(
        "click",
        closeMobileMenu
      );
    });

  document
    .querySelectorAll(
      "[data-coming-soon]"
    )
    .forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          const toolName =
            button.dataset.comingSoon;

          showToast(
            `${toolName} đang được phát triển.`
          );
        }
      );
    });

  document
    .querySelectorAll("[data-tool-url]")
    .forEach((card) => {
      card.addEventListener("click", (event) => {
        if (event.target.closest("a, button, input, select")) return;
        window.location.assign(card.dataset.toolUrl);
      });
    });

  elements.modalCloseButton.addEventListener(
    "click",
    closeModal
  );

  elements.modalBackdrop.addEventListener(
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
        event.key === "Escape"
      ) {
        if (
          !elements.modalBackdrop.hidden
        ) {
          closeModal();
        }

        if (
          !elements.mobileMenu.hidden
        ) {
          closeMobileMenu();
        }
      }

      if (
        event.ctrlKey &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();

        const isMobile =
          window.matchMedia(
            "(max-width: 680px)"
          ).matches;

        const searchInput =
          isMobile
            ? elements.mobileToolSearch
            : elements.toolSearch;

        elements.toolsSection.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });

        window.setTimeout(() => {
          searchInput.focus();
          searchInput.select();
        }, 400);
      }
    }
  );
}


/* =========================================================
   INITIALIZE
========================================================= */

function initializeApp() {
  updateThemeButtons(
    getCurrentTheme()
  );

  watchSystemTheme();

  sortTools();
  filterTools();

  attachEvents();
}


initializeApp();
