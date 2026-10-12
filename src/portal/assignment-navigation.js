/**
 * Top-of-view previous/next navigation for the currently selected graded assignment.
 * Buttons inherit their visual treatment and hover states from IITM's native CTA button.
 */
export class GradedAssignmentNavigation {
  constructor(portal) {
    this.portal = portal;
    this.root = null;
    this.signature = "";
  }

  createButton(prototype, direction, assignment) {
    const doc = this.portal?.doc;
    if (!doc || !prototype || typeof prototype.cloneNode !== "function") return null;

    const button = prototype.cloneNode(false);
    button.classList?.remove("selected", "active", "btn-icon-only", "child-row");
    if (typeof button.classList?.remove === "function" && typeof button.classList?.add === "function") {
      button.classList.remove("btn-secondary", "btn-primary");
      button.classList.remove("btn-gradient", "btn-success", "btn-outline", "btn-default");
      button.classList.add(
        assignment ? "btn-gradient" : "btn-outline",
        assignment ? "btn-success" : "btn-default",
        "btn-shape-box",
        "btn-size-medium"
      );
    }
    button.removeAttribute?.("style");
    for (const attribute of [
      "aria-selected",
      "aria-current",
      "aria-label",
      "aria-disabled",
      "aria-busy",
      "title",
      "disabled",
      "data-acx-graded",
      "data-acx-mode",
    ]) {
      button.removeAttribute?.(attribute);
    }
    button.setAttribute?.("type", "button");
    button.setAttribute?.("data-acx-assignment-nav-button", direction);
    const label = direction === "previous" ? "Previous graded assignment" : "Next graded assignment";
    button.setAttribute?.("aria-label", assignment ? `${label}: ${assignment.title}` : `No ${direction} graded assignment`);
    button.setAttribute?.("title", assignment?.title || `No ${direction} graded assignment`);
    button.style.width = "auto";
    if (typeof button.classList?.add === "function") button.classList.add("acx-assignment-nav-button");
    button.disabled = !assignment;
    button.setAttribute?.("aria-disabled", String(!assignment));
    button.textContent = assignment
      ? direction === "previous"
        ? `← Previous: ${assignment.title}`
        : `Next: ${assignment.title} →`
      : direction === "previous" ? "← Previous graded assignment" : "Next graded assignment →";

    button.addEventListener?.("click", (event) => {
      event.preventDefault?.();
      if (!button.disabled) {
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        this.portal?.navigateGradedAssignment?.(direction);
      }
    });
    return button;
  }

  update() {
    const state = this.portal?.getGradedAssignmentNavigation?.();
    const mount = this.portal?.getAssignmentNavigationMount?.();
    if (
      !state ||
      !mount?.parent ||
      !mount.before ||
      !mount.buttonPrototype ||
      typeof mount.parent.insertBefore !== "function"
    ) {
      this.clear();
      return false;
    }

    const signature = [state.current.title, state.previous?.title || "", state.next?.title || ""].join("\u0000");
    if (
      this.root &&
      this.root.parentNode === mount.parent &&
      this.root.nextSibling === mount.before &&
      this.signature === signature
    ) {
      return true;
    }

    this.clear();
    const doc = this.portal?.doc;
    const prototype = mount.buttonPrototype;
    if (!doc || typeof doc.createElement !== "function" || !prototype) return false;

    const nav = doc.createElement("nav");
    nav.className = "acx-assignment-navigation";
    nav.setAttribute("data-acx-assignment-navigation", "true");
    nav.setAttribute("aria-label", "Graded assignment navigation");
    nav.style.display = "flex";
    nav.style.flexWrap = "wrap";
    nav.style.alignItems = "center";
    nav.style.gap = "var(--acx-space-2, 8px)";
    nav.style.margin = "var(--acx-space-2, 8px) var(--acx-space-3, 12px) var(--acx-space-4, 16px)";
    nav.style.padding = "var(--acx-space-1, 4px) var(--acx-space-2, 8px)";
    nav.style.overflow = "visible";

    for (const direction of ["previous", "next"]) {
      const button = this.createButton(prototype, direction, state[direction]);
      if (button) nav.appendChild(button);
    }

    if (nav.children?.length !== 2) return false;
    mount.parent.insertBefore(nav, mount.before);
    this.root = nav;
    this.signature = signature;
    return true;
  }

  clear() {
    this.root?.remove?.();
    this.root = null;
    this.signature = "";
  }

  destroy() {
    this.clear();
    this.portal = null;
  }
}
