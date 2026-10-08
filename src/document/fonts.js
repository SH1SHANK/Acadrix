/**
 * Font Registration for Acadrix PDF Compiler.
 * 
 * Embeds JetBrains Mono Nerd Font for all monospaced typography,
 * code blocks, keyboard shortcuts, and technical metadata.
 * 
 * Complies with Acadrix DESIGN.md §2 and Section 12 of the Specification.
 */

let jetBrainsLoaded = false;

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return typeof btoa === "function" ? btoa(binary) : Buffer.from(binary, "binary").toString("base64");
}

/**
 * Loads and registers JetBrains Mono Nerd Font into pdfMake's VFS and font dictionary.
 * Supports both Node.js (via filesystem) and browser extension (via chrome.runtime.getURL / fetch).
 * 
 * @param {Object} pdfMake
 * @returns {Promise<boolean>}
 */
export async function setupPdfMakeFonts(pdfMake) {
  if (!pdfMake) return false;

  // 1. Ensure Roboto base fonts exist
  if (!pdfMake.fonts) pdfMake.fonts = {};

  const robotoFallback = {
    normal: "Roboto-Regular.ttf",
    bold: "Roboto-Medium.ttf",
    italics: "Roboto-Italic.ttf",
    bolditalics: "Roboto-MediumItalic.ttf",
  };

  pdfMake.fonts.Roboto = robotoFallback;

  // Immediate safe fallback for Monospace / Courier before async font load
  if (!pdfMake.fonts.Monospace) {
    pdfMake.fonts.Monospace = robotoFallback;
  }
  if (!pdfMake.fonts.Courier) {
    pdfMake.fonts.Courier = robotoFallback;
  }
  if (!pdfMake.fonts.JetBrainsMono) {
    pdfMake.fonts.JetBrainsMono = robotoFallback;
  }

  if (jetBrainsLoaded) {
    return true;
  }

  // 2. Load JetBrains Mono Nerd Font
  try {
    let regularBase64 = null;
    let boldBase64 = null;

    // Node.js environment: read from extension/fonts/
    if (typeof process !== "undefined" && process.versions?.node) {
      try {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const regPath = path.resolve("extension/fonts/JetBrainsMonoNerdFont-Regular.ttf");
        const boldPath = path.resolve("extension/fonts/JetBrainsMonoNerdFont-Bold.ttf");

        if (fs.existsSync(regPath)) {
          regularBase64 = fs.readFileSync(regPath).toString("base64");
        }
        if (fs.existsSync(boldPath)) {
          boldBase64 = fs.readFileSync(boldPath).toString("base64");
        }
      } catch {
        // Fall through to browser path
      }
    }

    // Browser environment: fetch from chrome.runtime.getURL
    if (!regularBase64 && typeof chrome !== "undefined" && chrome.runtime?.getURL && typeof fetch === "function") {
      try {
        const regUrl = chrome.runtime.getURL("fonts/JetBrainsMonoNerdFont-Regular.ttf");
        const regResp = await fetch(regUrl);
        if (regResp.ok) {
          const buf = await regResp.arrayBuffer();
          regularBase64 = arrayBufferToBase64(buf);
        }

        const boldUrl = chrome.runtime.getURL("fonts/JetBrainsMonoNerdFont-Bold.ttf");
        const boldResp = await fetch(boldUrl);
        if (boldResp.ok) {
          const bbuf = await boldResp.arrayBuffer();
          boldBase64 = arrayBufferToBase64(bbuf);
        }
      } catch {
        // Fallback
      }
    }

    if (regularBase64) {
      const vfsPayload = {
        "JetBrainsMonoNerdFont-Regular.ttf": regularBase64,
        "JetBrainsMonoNerdFont-Bold.ttf": boldBase64 || regularBase64,
      };

      if (typeof pdfMake.addVirtualFileSystem === "function") {
        pdfMake.addVirtualFileSystem(vfsPayload);
      } else {
        if (!pdfMake.vfs) pdfMake.vfs = {};
        Object.assign(pdfMake.vfs, vfsPayload);
      }

      const fontDef = {
        normal: "JetBrainsMonoNerdFont-Regular.ttf",
        bold: "JetBrainsMonoNerdFont-Bold.ttf",
        italics: "JetBrainsMonoNerdFont-Regular.ttf",
        bolditalics: "JetBrainsMonoNerdFont-Bold.ttf",
      };

      pdfMake.fonts.JetBrainsMono = fontDef;
      pdfMake.fonts.JetBrainsMonoNerdFont = fontDef;
      pdfMake.fonts.Monospace = fontDef;
      pdfMake.fonts.Courier = fontDef;

      jetBrainsLoaded = true;
      return true;
    }
  } catch (err) {
    console.warn("[Acadrix] JetBrains Mono font loading warning:", err.message);
  }

  return false;
}
