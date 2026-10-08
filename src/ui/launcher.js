/**
 * Floating Launcher Button Component.
 * Mounts inside the isolated ShadowRoot.
 * Supports standard assessment mode and dedicated Programming Assignment fast-action mode.
 */

import { ICONS } from "./icons.js";
import { escapeHtml } from "../utils/dom.js";

export class LauncherButton {
  constructor(shadowHost) {
    this.shadowHost = shadowHost;
    this.element = null;
    this.clickHandler = null;
    this.quickActionHandler = null;
    this.isProgramming = false;
    this.shortcutHint = "Alt+Q";
    this._toastTimer = null;
    this._outsideClickHandler = null;
  }

  ensure(position = "bottom-center", onClick = null, options = {}) {
    const root = this.shadowHost.root;
    const pageType = options.pageType || "";
    const isProg =
      pageType === "PROGRAMMING_ASSIGNMENT" ||
      pageType === "programming" ||
      Boolean(options.isProgramming);
    this.isProgramming = isProg;

    if (options.shortcut) {
      this.shortcutHint = options.shortcut;
    }
    if (options.onQuickAction) {
      this.quickActionHandler = options.onQuickAction;
    }

    let container = root.getElementById("saq-launcher");
    const expectedTag = isProg ? "DIV" : "BUTTON";

    if (container && container.tagName !== expectedTag) {
      container.remove();
      container = null;
      this.element = null;
    }

    if (!container) {
      if (isProg) {
        container = document.createElement("div");
        container.id = "saq-launcher";
        container.className = "saq-launcher saq-launcher-pa";
        container.dataset.pos = position;
        container.dataset.pageType = "programming";
        container.innerHTML = `
          <div class="saq-launcher-split">
            <button type="button" class="saq-launcher-main" aria-haspopup="dialog" aria-expanded="false" aria-label="Open Programming Assignment" title="Programming Assignment Tools (${this.shortcutHint})">
              ${ICONS.launch}<span>Programming Assignment</span>
            </button>
            <button type="button" class="saq-launcher-toggle" aria-haspopup="menu" aria-expanded="false" aria-label="Quick Actions" title="Quick Actions">
              ${ICONS.chevronDown}
            </button>
          </div>
          <div class="saq-launcher-menu" id="saq-launcher-menu" role="menu" hidden>
            <div class="saq-launcher-menu-hdr">Quick Actions</div>
            <button type="button" class="saq-launcher-menu-item" data-act="copy-pa-question" role="menuitem">
              ${ICONS.copy}<span>Copy Question</span>
            </button>
            <button type="button" class="saq-launcher-menu-item" data-act="copy-pa-testcases" role="menuitem">
              ${ICONS.copy}<span>Copy Test Cases</span>
            </button>
            <button type="button" class="saq-launcher-menu-item" data-act="copy-pa-current" role="menuitem">
              ${ICONS.code || ICONS.copy}<span>Copy Code</span>
            </button>
            <button type="button" class="saq-launcher-menu-item" data-act="copy-pa-prompt" role="menuitem">
              ${ICONS.copy}<span>Prepare AI Prompt</span>
            </button>
            <div class="saq-launcher-menu-divider"></div>
            <button type="button" class="saq-launcher-menu-item" data-act="open-pa-reader" role="menuitem">
              ${ICONS.launch}<span>Open Reader</span>
            </button>
          </div>
        `;
      } else {
        container = document.createElement("button");
        container.type = "button";
        container.id = "saq-launcher";
        container.className = "saq-launcher";
        container.dataset.pos = position;
        container.dataset.pageType = "assessment";
        container.setAttribute("aria-haspopup", "dialog");
        container.setAttribute("aria-expanded", "false");
        container.setAttribute("aria-label", "Open Acadrix");
        container.title = `Open Acadrix (${this.shortcutHint})`;
        container.innerHTML = `${ICONS.launch}<span>All Questions</span>`;
      }
      root.appendChild(container);
    } else {
      container.dataset.pos = position;
    }

    // Wire click events
    if (isProg) {
      const mainBtn = container.querySelector(".saq-launcher-main");
      const toggleBtn = container.querySelector(".saq-launcher-toggle");
      const menu = container.querySelector("#saq-launcher-menu");

      if (onClick && onClick !== this.clickHandler) {
        if (this.clickHandler && mainBtn) {
          mainBtn.removeEventListener("click", this.clickHandler);
        }
        this.clickHandler = onClick;
        mainBtn?.addEventListener("click", this.clickHandler);
        container.onclick = (e) => {
          if (e.target?.closest?.(".saq-launcher-toggle, .saq-launcher-menu")) return;
          this.clickHandler?.(e);
        };
      }

      if (toggleBtn && !toggleBtn._wiredToggle) {
        toggleBtn._wiredToggle = true;
        toggleBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const isExpanded = toggleBtn.getAttribute("aria-expanded") === "true";
          const nextExpanded = !isExpanded;
          toggleBtn.setAttribute("aria-expanded", String(nextExpanded));
          if (menu) {
            menu.hidden = !nextExpanded;
            if (nextExpanded) {
              menu.removeAttribute("hidden");
              const firstItem = menu.querySelector(".saq-launcher-menu-item");
              firstItem?.focus?.();
            } else {
              menu.setAttribute("hidden", "");
            }
          }
        });
      }

      if (menu && !menu._wiredActions) {
        menu._wiredActions = true;
        menu.addEventListener("click", (e) => {
          const item = e.target.closest?.(".saq-launcher-menu-item");
          if (!item) return;
          e.preventDefault();
          e.stopPropagation();
          const action = item.dataset.act;

          // Close menu
          menu.hidden = true;
          menu.setAttribute("hidden", "");
          toggleBtn?.setAttribute("aria-expanded", "false");

          if (action === "open-pa-reader") {
            if (typeof this.clickHandler === "function") this.clickHandler();
          } else if (typeof this.quickActionHandler === "function") {
            this.quickActionHandler(action);
          }
        });

        menu.addEventListener("keydown", (e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            menu.hidden = true;
            menu.setAttribute("hidden", "");
            toggleBtn?.setAttribute("aria-expanded", "false");
            toggleBtn?.focus?.();
            return;
          }
          const items = Array.from(menu.querySelectorAll(".saq-launcher-menu-item"));
          const activeIndex = items.indexOf(root.activeElement);
          if (e.key === "ArrowDown") {
            e.preventDefault();
            const next = (activeIndex + 1) % items.length;
            items[next]?.focus?.();
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            const prev = (activeIndex - 1 + items.length) % items.length;
            items[prev]?.focus?.();
          }
        });
      }

      // Outside click handler to close menu
      if (!this._outsideClickHandler) {
        this._outsideClickHandler = (e) => {
          if (container && !container.contains(e.target)) {
            const menuEl = container.querySelector("#saq-launcher-menu");
            const toggleEl = container.querySelector(".saq-launcher-toggle");
            if (menuEl && !menuEl.hidden) {
              menuEl.hidden = true;
              menuEl.setAttribute("hidden", "");
              toggleEl?.setAttribute("aria-expanded", "false");
            }
          }
        };
        if (typeof window !== "undefined") {
          window.addEventListener("click", this._outsideClickHandler, true);
        }
      }
    } else {
      if (onClick && onClick !== this.clickHandler) {
        if (this.clickHandler) {
          container.removeEventListener("click", this.clickHandler);
        }
        this.clickHandler = onClick;
        container.addEventListener("click", this.clickHandler);
      }
    }

    this.element = container;
    return container;
  }

  show() {
    if (this.element) {
      this.element.classList.add("is-shown");
      this.element.setAttribute("aria-expanded", "false");
    }
  }

  hide() {
    if (this.element) {
      this.element.classList.remove("is-shown");
      const menu = this.element.querySelector?.("#saq-launcher-menu");
      if (menu) {
        menu.hidden = true;
        menu.setAttribute("hidden", "");
      }
    }
  }

  setExpanded(expanded) {
    if (this.element) {
      this.element.setAttribute("aria-expanded", expanded ? "true" : "false");
      const mainBtn = this.element.querySelector?.(".saq-launcher-main");
      if (mainBtn) mainBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
    }
  }

  setShortcutHint(shortcut) {
    this.shortcutHint = shortcut;
    if (this.element && shortcut) {
      if (this.isProgramming) {
        this.element.title = `Programming Assignment Tools (${shortcut})`;
        const main = this.element.querySelector?.(".saq-launcher-main");
        if (main) main.title = `Programming Assignment Tools (${shortcut})`;
      } else {
        this.element.title = `View all questions (${shortcut})`;
      }
    }
  }

  focus() {
    const target = this.element?.querySelector?.(".saq-launcher-main") || this.element;
    if (target && typeof target.focus === "function") {
      try {
        target.focus({ preventScroll: true });
      } catch (_e) {
        target.focus();
      }
    }
  }

  setPosition(pos) {
    if (this.element) {
      this.element.dataset.pos = pos;
    }
  }

  showToast(message, tone = "info", durationMs = 2500) {
    const root = this.shadowHost.root;
    if (!root) return;
    let toast = root.getElementById("saq-launcher-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "saq-launcher-toast";
      toast.className = "saq-launcher-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      root.appendChild(toast);
    }

    if (this._toastTimer) {
      clearTimeout(this._toastTimer);
      this._toastTimer = null;
    }

    const iconHtml =
      tone === "success"
        ? ICONS.check
        : tone === "error"
        ? ICONS.cross
        : tone === "warn"
        ? ICONS.warn
        : ICONS.info;

    toast.dataset.tone = tone;
    toast.innerHTML = `${iconHtml}<span>${escapeHtml(message)}</span>`;
    toast.classList.add("is-visible");

    this._toastTimer = setTimeout(() => {
      toast.classList.remove("is-visible");
      this._toastTimer = null;
    }, durationMs);
  }

  destroy() {
    if (this._outsideClickHandler) {
      if (typeof window !== "undefined") {
        window.removeEventListener("click", this._outsideClickHandler, true);
      }
      this._outsideClickHandler = null;
    }
    if (this._toastTimer) {
      clearTimeout(this._toastTimer);
      this._toastTimer = null;
    }
    const root = this.shadowHost?.shadow;
    root?.getElementById("saq-launcher-toast")?.remove();

    if (this.element) {
      if (this.clickHandler) {
        const main = this.element.querySelector?.(".saq-launcher-main");
        if (main) main.removeEventListener("click", this.clickHandler);
        else this.element.removeEventListener("click", this.clickHandler);
      }
      this.element.remove();
      this.element = null;
      this.clickHandler = null;
    }
  }
}
