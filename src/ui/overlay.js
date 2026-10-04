/**
 * Progress Overlay Component.
 * Displays loading progress during traversal inside the ShadowRoot.
 */

import { sleep } from "../utils/timing.js";

export class ProgressOverlay {
  constructor(shadowHost) {
    this.shadowHost = shadowHost;
    this.element = null;
    this.track = null;
    this.bar = null;
    this.count = null;
  }

  show() {
    const root = this.shadowHost.root;
    let el = root.getElementById("saq-overlay");

    if (!el) {
      el = document.createElement("div");
      el.id = "saq-overlay";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      el.setAttribute("aria-atomic", "true");
      el.innerHTML = `
        <div class="saq-card">
          <div class="saq-card-row">
            <div class="saq-spinner" aria-hidden="true"></div>
            <span>Reading questions…</span>
            <span class="saq-count">0 of 0 · 0%</span>
          </div>
          <div class="saq-track" role="progressbar" aria-label="Question extraction progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="saq-bar"></div></div>
        </div>`;
      root.appendChild(el);
    }

    this.element = el;
    this.track = el.querySelector(".saq-track");
    this.bar = el.querySelector(".saq-bar");
    this.count = el.querySelector(".saq-count");
  }

  progress(done, total) {
    const ratio = total ? Math.min(1, Math.max(0, done / total)) : 0;
    const pct = Math.round(ratio * 100);
    if (this.count) {
      this.count.textContent = `${done} of ${total} · ${pct}%`;
    }
    if (this.track) {
      this.track.setAttribute("aria-valuenow", String(pct));
    }
    if (this.bar) {
      this.bar.style.transform = `scaleX(${ratio})`;
    }
  }

  async hide() {
    if (!this.element) return;
    this.element.setAttribute("data-leaving", "");
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!prefersReducedMotion) {
      await sleep(200);
    }
    this.destroy();
  }

  destroy() {
    if (this.element) {
      this.element.remove();
      this.element = null;
      this.track = null;
      this.bar = null;
      this.count = null;
    }
  }
}
