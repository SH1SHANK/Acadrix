/**
 * Shadow DOM Host Manager.
 * Creates and encapsulates the Unfold / Acadrix UI boundary within an isolated ShadowRoot.
 * Top-level container uses z-index: 2147483647 while internal layers use --acx-z-* tokens.
 */

export class ShadowHost {
  constructor(id = "unfold-root", css = "") {
    this.id = id;
    this.css = css;
    this.host = null;
    this.shadow = null;
  }

  ensure() {
    if (this.host && this.shadow) return this.shadow;

    // Register local @font-face declarations in host document.head if available
    if (
      typeof document !== "undefined" &&
      document.head &&
      typeof document.head.appendChild === "function" &&
      !document.getElementById("acx-host-fonts")
    ) {
      const fontStyle = document.createElement("style");
      fontStyle.id = "acx-host-fonts";
      const getFontUrl = (name) => {
        /* @extension-only-start */
        if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
          return chrome.runtime.getURL(`fonts/${name}`);
        }
        /* @extension-only-end */
        return `fonts/${name}`;
      };

      fontStyle.textContent = `
        @font-face {
          font-family: "Satoshi Variable";
          src: url("${getFontUrl("Satoshi-Variable.woff2")}") format("woff2"), local("Satoshi Variable"), local("Satoshi-Variable"), local("Satoshi");
          font-weight: 400 700;
          font-style: normal;
          font-display: swap;
        }
        @font-face {
          font-family: "Outfit";
          src: local("Outfit"), local("Outfit-Medium"), local("Outfit-SemiBold");
          font-weight: 500 600;
          font-style: normal;
          font-display: swap;
        }
        @font-face {
          font-family: "JetBrainsMono Nerd Font";
          src: local("JetBrainsMono Nerd Font"), local("JetBrains Mono"), local("JetBrainsMono-Regular");
          font-weight: 400 500;
          font-style: normal;
          font-display: swap;
        }
        @font-face {
          font-family: "KaTeX_Main";
          src: local("KaTeX_Main-Regular"), local("KaTeX_Main"), url("${getFontUrl("KaTeX_Main-Regular.woff2")}") format("woff2");
          font-weight: 400;
          font-style: normal;
          font-display: swap;
        }
        @font-face {
          font-family: "KaTeX_Main";
          src: local("KaTeX_Main-Bold"), url("${getFontUrl("KaTeX_Main-Bold.woff2")}") format("woff2");
          font-weight: 700;
          font-style: normal;
          font-display: swap;
        }
        @font-face {
          font-family: "KaTeX_Main";
          src: local("KaTeX_Main-Italic"), url("${getFontUrl("KaTeX_Main-Italic.woff2")}") format("woff2");
          font-weight: 400;
          font-style: italic;
          font-display: swap;
        }
        @font-face {
          font-family: "KaTeX_Math";
          src: local("KaTeX_Math-Italic"), local("KaTeX_Math"), url("${getFontUrl("KaTeX_Math-Italic.woff2")}") format("woff2");
          font-weight: 400;
          font-style: italic;
          font-display: swap;
        }
        @font-face {
          font-family: "KaTeX_Size1";
          src: url("${getFontUrl("KaTeX_Size1-Regular.woff2")}") format("woff2");
          font-weight: 400;
          font-style: normal;
          font-display: swap;
        }
        @font-face {
          font-family: "KaTeX_Size2";
          src: url("${getFontUrl("KaTeX_Size2-Regular.woff2")}") format("woff2");
          font-weight: 400;
          font-style: normal;
          font-display: swap;
        }
        @font-face {
          font-family: "KaTeX_Size3";
          src: url("${getFontUrl("KaTeX_Size3-Regular.woff2")}") format("woff2");
          font-weight: 400;
          font-style: normal;
          font-display: swap;
        }
        @font-face {
          font-family: "KaTeX_Size4";
          src: url("${getFontUrl("KaTeX_Size4-Regular.woff2")}") format("woff2");
          font-weight: 400;
          font-style: normal;
          font-display: swap;
        }
        @font-face {
          font-family: "KaTeX_AMS";
          src: local("KaTeX_AMS-Regular"), local("KaTeX_AMS"), url("${getFontUrl("KaTeX_AMS-Regular.woff2")}") format("woff2");
          font-weight: 400;
          font-style: normal;
          font-display: swap;
        }
      `;
      document.head.appendChild(fontStyle);
    }

    let host = document.getElementById(this.id);
    if (!host) {
      host = document.createElement("div");
      host.id = this.id;
      if (host.style) {
        host.style.position = "fixed";
        host.style.inset = "0";
        host.style.pointerEvents = "none";
        host.style.zIndex = "2147483647";
      }
      (document.body || document.documentElement).appendChild(host);
    } else if (host.style) {
      host.style.zIndex = "2147483647";
    }

    let shadow = host.shadowRoot;
    if (!shadow) {
      shadow = host.attachShadow({ mode: "open" });
    }

    // Inject encapsulated styles if not present
    let style = shadow.getElementById("unfold-styles");
    if (!style) {
      style = document.createElement("style");
      style.id = "unfold-styles";
      style.textContent = this.css;
      shadow.appendChild(style);
    } else if (this.css) {
      style.textContent = this.css;
    }

    this.host = host;
    this.shadow = shadow;
    return shadow;
  }

  setTheme(theme) {
    this.ensure();
    if (!this.host) return;
    if (theme === "light" || theme === "dark") {
      this.host.setAttribute("data-theme", theme);
    } else {
      this.host.removeAttribute("data-theme");
    }
  }

  getTheme() {
    if (!this.host) return "system";
    return this.host.getAttribute("data-theme") || "system";
  }

  setTextSize(size) {
    this.ensure();
    if (!this.host) return;
    if (size === "small" || size === "large") {
      this.host.setAttribute("data-text-size", size);
    } else {
      this.host.removeAttribute("data-text-size");
    }
  }

  getTextSize() {
    if (!this.host) return "default";
    return this.host.getAttribute("data-text-size") || "default";
  }

  toggleTheme() {
    this.ensure();
    if (!this.host) return "light";
    const current = this.host.getAttribute("data-theme");
    const systemDark =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isCurrentlyDark = current ? current === "dark" : systemDark;
    const next = isCurrentlyDark ? "light" : "dark";
    this.host.setAttribute("data-theme", next);
    return next;
  }

  get root() {
    return this.shadow || this.ensure();
  }

  $(selector) {
    return this.root.querySelector(selector);
  }

  $$(selector) {
    return [...this.root.querySelectorAll(selector)];
  }

  destroy() {
    if (this.host) {
      this.host.remove();
      this.host = null;
      this.shadow = null;
    }
  }
}
