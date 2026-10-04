/**
 * Floating Launcher Button Component.
 * Mounts inside the isolated ShadowRoot.
 */

import { ICONS } from "./icons.js";

export class LauncherButton {
  constructor(shadowHost) {
    this.shadowHost = shadowHost;
    this.element = null;
    this.clickHandler = null;
  }

  ensure(position = "bottom-center", onClick = null) {
    const root = this.shadowHost.root;
    let btn = root.getElementById("saq-launcher");

    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.id = "saq-launcher";
      btn.className = "saq-launcher";
      btn.dataset.pos = position;
      btn.setAttribute("aria-haspopup", "dialog");
      btn.setAttribute("aria-expanded", "false");
      btn.setAttribute("aria-label", "Open Acadrix");
      btn.title = "Open Acadrix (Alt+Q)";
      btn.innerHTML = `${ICONS.launch}<span>All Questions</span>`;
      root.appendChild(btn);
    }

    if (onClick && onClick !== this.clickHandler) {
      if (this.clickHandler) {
        btn.removeEventListener("click", this.clickHandler);
      }
      this.clickHandler = onClick;
      btn.addEventListener("click", this.clickHandler);
    }

    this.element = btn;
    return btn;
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
    }
  }

  setExpanded(expanded) {
    if (this.element) {
      this.element.setAttribute("aria-expanded", expanded ? "true" : "false");
    }
  }

  setShortcutHint(shortcut) {
    if (this.element && shortcut) {
      this.element.title = `View all questions (${shortcut})`;
    }
  }

  focus() {
    if (this.element && typeof this.element.focus === "function") {
      try {
        this.element.focus({ preventScroll: true });
      } catch (_e) {
        this.element.focus();
      }
    }
  }

  setPosition(pos) {
    if (this.element) {
      this.element.dataset.pos = pos;
    }
  }

  destroy() {
    if (this.element) {
      if (this.clickHandler) {
        this.element.removeEventListener("click", this.clickHandler);
      }
      this.element.remove();
      this.element = null;
      this.clickHandler = null;
    }
  }
}
