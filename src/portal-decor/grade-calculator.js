import { DEFAULT_SUPABASE_ANON_KEY, DEFAULT_SUPABASE_URL } from "../notifications/events.js";
import { parseCourseCode, parseTermId } from "./core.js";
import { captureGrades } from "./capture.js";
import { IITM_SELECTORS } from "../portal/selectors.js";

const INPUTS_KEY = "acx:grade-inputs:v1";
const PASS_MARK = 45;
const STYLE = `
:host{all:initial;color-scheme:light;font-family:"Satoshi Variable",Satoshi,system-ui,sans-serif;--acx-brand-accent:#2f4bdb;--acx-brand-paper:#fafaf8;--acx-brand-surface:#fff;--acx-brand-well:#f3f3f0;--acx-brand-border:#e4e4df;--acx-brand-border-strong:#cfcfc8;--acx-brand-ink:#16181d;--acx-brand-muted:#5b606b;--acx-brand-scrim:rgb(22 24 29 / .48);--acx-bg:var(--acx-brand-paper);--acx-surface:var(--acx-brand-surface);--acx-surface-raised:var(--acx-brand-surface);--acx-surface-sunken:var(--acx-brand-well);--acx-border:var(--acx-brand-border);--acx-border-strong:var(--acx-brand-border-strong);--acx-text:var(--acx-brand-ink);--acx-text-muted:var(--acx-brand-muted);--acx-accent:var(--acx-brand-accent);--acx-focus-ring:var(--acx-brand-accent);--acx-overlay-scrim:var(--acx-brand-scrim);--grade-safe:#18864b;--grade-safe-bg:#e8f6ed;--grade-safe-ink:#126438;--grade-warn:#b45309;--grade-warn-bg:#fff3df;--grade-warn-ink:#85420a;--grade-critical:#c62828;--grade-critical-bg:#fdebec;--grade-critical-ink:#982121;--acx-space-2:8px;--acx-space-3:12px;--acx-space-4:16px;--acx-space-5:20px;--acx-space-6:24px;--acx-radius-md:9px;--acx-radius-lg:16px;--acx-duration-fast:120ms;--acx-duration-base:200ms;--acx-shadow-dialog:0 18px 56px rgb(0 0 0 / .28);color:var(--acx-text)}
*,*::before,*::after{box-sizing:border-box}
.scrim{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:var(--acx-space-4);background:var(--acx-overlay-scrim);animation:fade-in 160ms ease-out both}
.dialog{width:min(960px,100%);max-height:min(900px,calc(100dvh - 32px));overflow:auto;border:1px solid var(--acx-border-strong);border-radius:var(--acx-radius-lg);background:var(--acx-surface-raised);color:var(--acx-text);box-shadow:var(--acx-shadow-dialog);animation:dialog-in var(--acx-duration-base) cubic-bezier(.2,0,0,1) both}
.head{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--acx-space-4);padding:var(--acx-space-5) var(--acx-space-6) var(--acx-space-4);border-bottom:1px solid var(--acx-border)}
.course-search{display:grid;gap:6px;padding:var(--acx-space-4) var(--acx-space-6);border-bottom:1px solid var(--acx-border);background:var(--acx-bg)}
.course-search label{font-size:12px;font-weight:700;color:var(--acx-text-muted)}
.course-search input{min-height:44px}
.course-search-status{margin:0;color:var(--acx-text-muted);font-size:12px;line-height:1.4}
.course-results{display:grid;gap:6px;max-height:220px;overflow:auto}
.course-result{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;min-height:48px;padding:8px 12px;border:1px solid var(--acx-border);border-radius:var(--acx-radius-md);background:var(--acx-surface);color:var(--acx-text);font:inherit;text-align:left;cursor:pointer}
.course-result:hover,.course-result[aria-current=true]{border-color:var(--acx-accent);background:var(--acx-surface-sunken)}
.course-result:disabled{cursor:default}
.course-result-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600}
.course-result-term{flex:none;color:var(--acx-text-muted);font-size:11px}
.eyebrow{margin:0 0 4px;color:var(--acx-text-muted);font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
h2{margin:0;font-size:20px;line-height:1.3;font-weight:700;overflow-wrap:anywhere}
.close{width:40px;height:40px;flex:none;border:1px solid var(--acx-border-strong);border-radius:10px;background:var(--acx-surface);color:var(--acx-text);font-size:22px;cursor:pointer;transition:background-color var(--acx-duration-fast) ease,border-color var(--acx-duration-fast) ease}
.grade-fab{position:fixed;right:24px;bottom:calc(24px + env(safe-area-inset-bottom));z-index:2147483600;display:flex;align-items:center;gap:10px;min-height:52px;padding:0 18px;border:0;border-radius:999px;background:var(--acx-brand-accent);color:var(--acx-brand-paper);box-shadow:0 8px 24px rgb(22 24 29 / .24);font:600 14px/1.2 "Satoshi Variable",Satoshi,system-ui,sans-serif;cursor:pointer;transition:transform var(--acx-duration-fast) ease,box-shadow var(--acx-duration-fast) ease}
.grade-fab:hover{transform:translateY(-2px);box-shadow:0 12px 28px rgb(22 24 29 / .3)}
.grade-fab:active{transform:translateY(0)}
.grade-fab svg{width:20px;height:20px;flex:none}
.grade-fab[hidden]{display:none}
.body{padding:var(--acx-space-5) var(--acx-space-6);display:grid;gap:var(--acx-space-4)}
.score-panel{--grade-state:var(--grade-warn);padding:20px;border:1px solid var(--acx-border);border-radius:16px;background:linear-gradient(135deg,var(--acx-surface-sunken),var(--acx-surface));}
.score-panel[data-state=safe]{--grade-state:var(--grade-safe)}.score-panel[data-state=critical]{--grade-state:var(--grade-critical)}.score-panel[data-state=warning]{--grade-state:var(--grade-warn)}
.score-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.score-label{display:block;margin-bottom:6px;color:var(--acx-text-muted);font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}.score{font-size:42px;line-height:1;font-weight:750;font-variant-numeric:tabular-nums;color:var(--grade-state)}.scale{margin-left:8px;color:var(--acx-text-muted);font-size:14px}.risk-badge{display:inline-flex;align-items:center;gap:7px;min-height:32px;padding:5px 10px;border-radius:999px;background:var(--grade-badge-bg);color:var(--grade-badge-ink);font-size:12px;font-weight:700}.score-panel[data-state=safe]{--grade-badge-bg:var(--grade-safe-bg);--grade-badge-ink:var(--grade-safe-ink)}.score-panel[data-state=warning]{--grade-badge-bg:var(--grade-warn-bg);--grade-badge-ink:var(--grade-warn-ink)}.score-panel[data-state=critical]{--grade-badge-bg:var(--grade-critical-bg);--grade-badge-ink:var(--grade-critical-ink)}
.score-track{position:relative;height:16px;margin:22px 0 10px;overflow:visible;border-radius:999px;background:var(--acx-border)}.potential-fill{position:absolute;inset:0 auto 0 0;width:0;border-radius:inherit;background:color-mix(in srgb,var(--grade-state) 20%,transparent);transition:width var(--acx-duration-base) ease}.earned-fill{position:absolute;inset:0 auto 0 0;width:0;border-radius:inherit;background:var(--grade-state);transition:width var(--acx-duration-base) ease}.pass-marker{position:absolute;top:-5px;bottom:-5px;left:45%;width:3px;border-radius:3px;background:var(--acx-text);transform:translateX(-50%);box-shadow:0 0 0 2px var(--acx-surface)}.meter-labels{display:flex;justify-content:space-between;gap:8px;color:var(--acx-text-muted);font-size:12px;font-variant-numeric:tabular-nums}.meter-labels strong{color:var(--acx-text)}
.chart-legend{display:flex;flex-wrap:wrap;gap:14px;margin-top:10px;color:var(--acx-text-muted);font-size:11px}.chart-legend span{display:inline-flex;align-items:center;gap:6px}.legend-mark{width:10px;height:10px;border-radius:3px;background:var(--grade-state)}.legend-mark.potential{background:color-mix(in srgb,var(--grade-state) 22%,transparent);border:1px solid var(--grade-state)}.legend-mark.threshold{width:3px;border-radius:0;background:var(--acx-text)}
.scenario-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:12px;margin-top:16px}.scenario{min-width:0;padding:14px;border:1px solid var(--acx-border);border-radius:12px;background:var(--acx-surface)}.scenario h4{margin:0 0 6px;font-size:14px}.scenario p{min-height:38px;margin:0;color:var(--acx-text-muted);font-size:12px;line-height:1.45}.scenario-value{display:block;margin-top:12px;color:var(--scenario-ink,var(--acx-text));font-size:24px;font-weight:750;font-variant-numeric:tabular-nums}.scenario[data-state=safe]{--scenario-ink:var(--grade-safe);--scenario-track:var(--grade-safe)}.scenario[data-state=warning]{--scenario-ink:var(--grade-warn);--scenario-track:var(--grade-warn)}.scenario[data-state=critical]{--scenario-ink:var(--grade-critical);--scenario-track:var(--grade-critical)}.scenario-track{height:6px;margin-top:10px;overflow:hidden;border-radius:99px;background:var(--acx-border)}.scenario-track span{display:block;height:100%;width:0;border-radius:inherit;background:var(--scenario-track,var(--acx-accent));transition:width var(--acx-duration-base) ease}
.component-chart{display:grid;gap:10px;margin-top:16px;padding-top:14px;border-top:1px solid var(--acx-border)}.component-row{display:grid;grid-template-columns:minmax(120px,1fr) minmax(100px,2fr) 52px;align-items:center;gap:12px;font-size:12px}.component-name{overflow:hidden;color:var(--acx-text-muted);text-overflow:ellipsis;white-space:nowrap}.component-track{height:8px;overflow:hidden;border-radius:99px;background:var(--acx-border)}.component-track span{display:block;height:100%;width:0;border-radius:inherit;background:var(--component-state,var(--grade-warn))}.component-row[data-state=safe]{--component-state:var(--grade-safe)}.component-row[data-state=warning]{--component-state:var(--grade-warn)}.component-row[data-state=critical]{--component-state:var(--grade-critical)}.component-value{text-align:right;color:var(--acx-text);font-variant-numeric:tabular-nums}
.summary{padding:var(--acx-space-4);border-radius:12px;background:var(--acx-surface-sunken);border:1px solid var(--acx-border)}
.target{padding:var(--acx-space-4);border:1px solid var(--acx-border);border-radius:12px;background:var(--acx-surface)}
.target h3{margin:0 0 6px;font-size:15px}
.target-summary{margin:0;color:var(--acx-text-muted);font-size:13px;line-height:1.5}
.target-note{display:block;margin-top:12px;color:var(--acx-text-muted);font-size:11px;line-height:1.45}
.hint{margin:0;color:var(--acx-text-muted);font-size:14px;line-height:1.5}
.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.field{display:grid;gap:6px;min-width:0}
.field-group{color:var(--acx-text-muted);font-size:10px;font-weight:750;letter-spacing:.08em;text-transform:uppercase}
label{font-size:14px;font-weight:600}
.field small{color:var(--acx-text-muted);font-size:12px;line-height:1.4}
input{width:100%;min-height:44px;padding:10px 12px;border:1px solid var(--acx-border-strong);border-radius:var(--acx-radius-md);background:var(--acx-surface);color:var(--acx-text);font:inherit;font-size:16px}
input:focus-visible,button:focus-visible{outline:2px solid var(--acx-focus-ring);outline-offset:2px}
input[aria-invalid=true]{border-color:#c62828}
.status{min-height:20px;color:var(--acx-text-muted);font-size:13px}
.eligibility{padding:12px 14px;border-left:3px solid var(--acx-accent);background:var(--acx-surface-sunken);font-size:13px;line-height:1.5;white-space:pre-line}
.footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px var(--acx-space-6);border-top:1px solid var(--acx-border);background:var(--acx-bg)}
.saved{color:var(--acx-text-muted);font-size:12px}
.fields{grid-template-columns:repeat(auto-fit,minmax(150px,1fr));align-items:end}
.scenario p{white-space:pre-line}
.field-group{display:none}
.score-panel{padding:16px}
.score-heading{align-items:center}
.score-label{margin:0 0 4px}
.score{font-size:36px}
.score-track{display:flex;height:24px;overflow:hidden;margin:18px 0 8px;background:var(--acx-border)}
.score-track [data-stack]{display:flex;width:100%;height:100%;overflow:hidden;border-radius:inherit}
.score-track [data-stack] span{height:100%;min-width:0;transition:width var(--acx-duration-base) ease}
.score-track .pass-marker{z-index:2;top:-4px;bottom:-4px}
.contribution-legend{display:flex;flex-wrap:wrap;gap:6px 12px;margin-top:10px}
.contribution-legend span{display:inline-flex;align-items:center;gap:5px;color:var(--acx-text-muted);font-size:12px}
.contribution-legend i{width:9px;height:9px;border-radius:3px}
.calculate{justify-self:start;min-height:42px;padding:9px 18px;border:0;border-radius:var(--acx-radius-md);background:var(--acx-accent);color:white;font:600 14px/1.2 inherit;cursor:pointer}
.calculate:disabled{opacity:.6;cursor:wait}
.calc-error{margin:0;color:var(--grade-critical);font-size:13px}
.scenario-grid{margin-top:12px}
.scenario{padding:12px}
.scenario p{min-height:0}
.scenario-value{margin-top:8px}
.target-note,.component-chart,.chart-legend{display:none}
.footer{display:none}
.retry{min-height:40px;padding:8px 14px;border:1px solid var(--acx-border-strong);border-radius:var(--acx-radius-md);background:var(--acx-surface);color:var(--acx-text);font:inherit;font-size:14px;cursor:pointer}
.retry:disabled{opacity:.55;cursor:not-allowed}
.close:hover,.retry:hover{background:var(--acx-surface-sunken);border-color:var(--acx-text-muted)}
@keyframes fade-in{from{opacity:0}to{opacity:1}}
@keyframes dialog-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@media(prefers-color-scheme:dark){:host{color-scheme:dark;--acx-brand-accent:#8ea2ff;--acx-brand-paper:#0e1013;--acx-brand-surface:#15181d;--acx-brand-well:#0e1013;--acx-brand-border:#2a2f37;--acx-brand-border-strong:#3a404a;--acx-brand-ink:#ecedef;--acx-brand-muted:#a3a8b2;--acx-brand-scrim:rgb(0 0 0 / .62);--grade-safe:#4ade80;--grade-safe-bg:#153524;--grade-safe-ink:#bbf7d0;--grade-warn:#fbbf24;--grade-warn-bg:#3b2d12;--grade-warn-ink:#fde68a;--grade-critical:#fb7185;--grade-critical-bg:#451b24;--grade-critical-ink:#fecdd3;--acx-shadow-dialog:0 18px 56px rgb(0 0 0 / .48)}}
.fields{grid-template-columns:repeat(auto-fit,minmax(150px,1fr));align-items:end}.field-group{display:none}.score-track{display:flex;height:24px;overflow:hidden;margin:18px 0 8px}.score-track [data-stack]{display:flex;width:100%;height:100%;overflow:hidden;border-radius:inherit}.score-track [data-stack] span{height:100%;transition:width 200ms ease}.score-track .pass-marker{z-index:2;top:-4px;bottom:-4px}.contribution-legend{display:flex;flex-wrap:wrap;gap:6px 12px;margin-top:10px}.contribution-legend span{display:inline-flex;align-items:center;gap:5px;font-size:12px}.contribution-legend i{width:9px;height:9px;border-radius:3px}.calculate{justify-self:start;min-height:42px;padding:9px 18px;border:0;border-radius:9px;background:var(--acx-accent);color:white;font:600 14px/1.2 system-ui;cursor:pointer}.calc-error{color:var(--grade-critical);font-size:13px}.target-note,.component-chart,.chart-legend,.footer{display:none}.scenario-grid{margin-top:12px}.scenario{padding:12px}.scenario p{min-height:0}.scenario-value{margin-top:8px}@media(max-width:640px){.scrim{padding:8px}.dialog{max-height:calc(100dvh - 16px);border-radius:12px}.head{padding:16px}.body{padding:16px}.fields{grid-template-columns:repeat(2,minmax(0,1fr))}.score{font-size:32px}.scenario-grid{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){.scrim,.dialog{animation:none}.earned-fill,.potential-fill,.scenario-track span,.close,.grade-fab{transition:none}}
`;

function evaluate(expr, values, missingValue) {
  if (typeof expr === "number" && Number.isFinite(expr)) return expr;
  if (!expr || typeof expr !== "object") throw new Error("Invalid policy formula");
  if (typeof expr.ref === "string") {
    const value = values[expr.ref];
    if (!Number.isFinite(value) && Number.isFinite(missingValue)) return missingValue;
    if (!Number.isFinite(value)) throw new Error(`Enter ${expr.ref}`);
    return value;
  }
  const args = (expr.args || []).map((arg) => evaluate(arg, values, missingValue));
  if (expr.op === "sum") return args.reduce((a, b) => a + b, 0);
  if (expr.op === "max") return Math.max(...args);
  if (expr.op === "min") return Math.min(...args);
  if (expr.op === "multiply") return args.reduce((a, b) => a * b, 1);
  throw new Error("Unsupported policy formula");
}

function localGet(key) {
  return new Promise((resolve) => {
    try { chrome.storage.local.get({ [key]: {} }, (data) => resolve(data?.[key] || {})); }
    catch { resolve({}); }
  });
}

function localSet(key, value) {
  return new Promise((resolve) => {
    try { chrome.storage.local.set({ [key]: value }, resolve); }
    catch { resolve(); }
  });
}

function assessmentGroup(input) {
  const name = `${input.key} ${input.label}`.toLowerCase();
  if (/\bgaa\d*\b|graded assignments?/.test(name)) return "GAA";
  if (/\bqz\d*\b|quiz/.test(name)) return "Remaining quizzes";
  if (/\boppe\d*\b/.test(name)) return "OPPEs";
  if (/end[ -]?term|end[ -]?sem|final exam|\b(?:et|f)\b/i.test(name)) return "End term";
  return input.label;
}

export function initGradeCalculator({ doc = document, gradesStore, fetchFn = globalThis.fetch } = {}) {
  let activeKey = "";
  let host = null;
  let request = 0;
  let pendingSave = 0;
  let focusReturn = null;
  let lastGradeSnapshot = "";
  const policies = new Map();
  let courseCatalog = null;
  let courseCatalogRequest = null;

  function pageCourse() {
    const title = doc.querySelector(IITM_SELECTORS.decor.coursePageTitle)?.textContent?.trim() || "";
    if (!/about\s+(?:the\s+)?course|grading\s+policy/i.test(title)) return null;
    const body = doc.querySelector(IITM_SELECTORS.decor.coursePolicyContent)?.textContent || "";
    const nav = doc.querySelector(IITM_SELECTORS.decor.courseKey)?.textContent || "";
    const explicitCode = body.match(/Course\s*ID\s*:\s*([A-Z]{2}\d{4}[A-Z]?)/i)?.[1];
    const code = explicitCode ? parseCourseCode("", explicitCode) : parseCourseCode(nav, body);
    if (!code || code === "UNKNOWN_COURSE") return null;
    const termId = parseTermId(nav);
    return { key: `${termId}:${code}`, termId, code, courseName: code, title };
  }

  function visibleGradesCourse() {
    const gradeView = doc.querySelector(IITM_SELECTORS.decor.gradeView);
    if (!gradeView) return null;
    const title = doc.querySelector(IITM_SELECTORS.decor.courseKey)?.textContent || "";
    const code = parseCourseCode(title, gradeView.textContent || "");
    return code === "UNKNOWN_COURSE" ? null : { termId: parseTermId(title), code };
  }

  function ensureHost() {
    if (host?.isConnected) return host.shadowRoot;
    host = doc.createElement("div");
    host.id = "acx-grade-calculator";
    host.attachShadow({ mode: "open" });
    const style = doc.createElement("style");
    style.textContent = STYLE;
    host.shadowRoot.append(style);
    (doc.body || doc.documentElement).append(host);
    return host.shadowRoot;
  }

  function close() {
    if (!host) return;
    host.shadowRoot.querySelector("[data-scrim]")?.remove();
    const launcher = host.shadowRoot.querySelector("[data-grade-fab]");
    if (launcher) launcher.hidden = false;
    focusReturn?.focus?.({ preventScroll: true });
  }

  function showLauncher(course, key) {
    const root = ensureHost();
    root.querySelector("[data-scrim]")?.remove();
    root.querySelector("[data-grade-fab]")?.remove();
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "grade-fab";
    button.dataset.gradeFab = "";
    button.setAttribute("aria-label", `Open grade calculator for ${course.courseName}`);
    button.title = "Grade Calculator";
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h2m4 0h2m-8 4h2m4 0h2m-8 4h2m4 0h2"/></svg><span>Grade Calculator</span>';
    button.addEventListener("click", () => {
      if (activeKey !== key) return;
      focusReturn = button;
      renderSafely(course, key);
    });
    root.append(button);
  }

  async function getPolicy(course) {
    if (policies.has(course.key)) return policies.get(course.key);
    const url = new URL(`${DEFAULT_SUPABASE_URL}/rest/v1/course_grading_policies`);
    url.search = new URLSearchParams({ select: "course_name,policy,source_document", term_id: `eq.${course.termId}`, course_code: `eq.${course.code}`, limit: "1" }).toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let response;
    try {
      response = await fetchFn(url, { signal: controller.signal, headers: { apikey: DEFAULT_SUPABASE_ANON_KEY, Authorization: `Bearer ${DEFAULT_SUPABASE_ANON_KEY}`, Accept: "application/json" } });
    } catch (error) {
      if (controller.signal.aborted) throw new Error("Loading the grading policy took too long. Check your connection and try again.");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(response.status === 404 ? "Grading policy table is not available yet." : "Could not load this course’s grading policy.");
    const rows = await response.json();
    const policy = Array.isArray(rows) ? rows[0] || null : null;
    policies.set(course.key, policy);
    return policy;
  }

  async function getCourseCatalog() {
    if (courseCatalog) return courseCatalog;
    if (!courseCatalogRequest) {
      courseCatalogRequest = (async () => {
        const endpoint = `${DEFAULT_SUPABASE_URL}/rest/v1/course_grading_policies`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
          const courses = [];
          for (let offset = 0; ; offset += 1000) {
            const url = new URL(endpoint);
            url.search = new URLSearchParams({ select: "term_id,course_code,course_name", order: "course_name.asc,course_code.asc,term_id.asc", limit: "1000", offset: String(offset) }).toString();
            const response = await fetchFn(url, { signal: controller.signal, headers: { apikey: DEFAULT_SUPABASE_ANON_KEY, Authorization: `Bearer ${DEFAULT_SUPABASE_ANON_KEY}`, Accept: "application/json" } });
            if (!response.ok) throw new Error("Could not load the course list. Try searching again.");
            const rows = await response.json();
            if (!Array.isArray(rows)) break;
            courses.push(...rows.filter((row) => row?.term_id && row?.course_code && row?.course_name));
            if (rows.length < 1000) break;
          }
          courseCatalog = courses;
          return courseCatalog;
        } catch (error) {
          if (controller.signal.aborted) throw new Error("Loading the course list took too long. Check your connection and try again.");
          throw error;
        } finally {
          clearTimeout(timeout);
          courseCatalogRequest = null;
        }
      })();
    }
    return courseCatalogRequest;
  }

  function showCourseMatches(root, course, key) {
    const search = root.querySelector("[data-course-search]");
    const results = root.querySelector("[data-course-results]");
    const status = root.querySelector("[data-course-search-status]");
    if (!search || !results || !status) return;
    const query = search.value.trim().toLocaleLowerCase();
    results.replaceChildren();
    if (query.length < 2) {
      status.textContent = "Type at least 2 characters to search by course name or code.";
      return;
    }
    status.textContent = "Searching courses…";
    getCourseCatalog().then((courses) => {
      if (!search.isConnected) return;
      const currentQuery = search.value.trim().toLocaleLowerCase();
      if (currentQuery.length < 2) {
        status.textContent = "Type at least 2 characters to search by course name or code.";
        return;
      }
      const matches = courses.filter((item) => `${item.course_code} ${item.course_name}`.toLocaleLowerCase().includes(currentQuery)).slice(0, 12);
      results.replaceChildren();
      for (const item of matches) {
        const button = doc.createElement("button");
        button.type = "button";
        button.className = "course-result";
        const isCurrent = item.term_id === course.termId && item.course_code === course.code;
        button.disabled = isCurrent;
        if (isCurrent) button.setAttribute("aria-current", "true");
        button.setAttribute("aria-label", `${item.course_code}, ${item.course_name}, term ${item.term_id}`);
        const name = doc.createElement("span");
        name.className = "course-result-name";
        name.textContent = `${item.course_code} · ${item.course_name}`;
        const term = doc.createElement("span");
        term.className = "course-result-term";
        term.textContent = isCurrent ? `Current · ${item.term_id}` : item.term_id;
        button.append(name, term);
        button.addEventListener("click", () => {
          renderSafely({ key: `${item.term_id}:${item.course_code}`, termId: item.term_id, code: item.course_code, courseName: item.course_name, title: "Search" }, key);
        });
        results.append(button);
      }
      status.textContent = matches.length ? `${matches.length}${matches.length === 12 ? "+" : ""} courses found · select one to open its calculator.` : "No courses match. Only courses with a grading policy are available.";
    }).catch((error) => {
      if (!search.isConnected) return;
      status.textContent = error.message || "Could not search courses. Try again.";
    });
  }

  function showLoading(course, status, key) {
    const root = ensureHost();
    const launcher = root.querySelector("[data-grade-fab]");
    if (launcher) launcher.hidden = true;
    root.querySelector("[data-scrim]")?.remove();
    const template = doc.createElement("template");
    template.innerHTML = `<div class="scrim" data-scrim><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="acx-grade-title"><header class="head"><div><p class="eyebrow">Grade calculator · ${course.termId}</p><h2 id="acx-grade-title">${course.courseName.replace(/[&<>"']/g, "")}</h2></div><button class="close" type="button" aria-label="Close grade calculator" data-close>×</button></header><div class="course-search"><label for="acx-course-search">Find a course</label><input id="acx-course-search" type="search" data-course-search placeholder="Search by course name or code" autocomplete="off" aria-describedby="acx-course-search-status"><p id="acx-course-search-status" class="course-search-status" data-course-search-status role="status" aria-live="polite">Type at least 2 characters to search across terms.</p><div class="course-results" data-course-results aria-label="Course search results"></div></div><div class="body"><p class="hint" id="acx-grade-status" role="status" aria-live="polite">${status}</p></div><footer class="footer"><span class="saved">Scores stay on this device.</span></footer></section></div>`;
    root.append(template.content.cloneNode(true));
    const dialog = root.querySelector(".dialog");
    root.querySelector("[data-close]").addEventListener("click", close);
    root.querySelector("[data-course-search]").addEventListener("input", () => showCourseMatches(root, course, key));
    root.querySelector("[data-scrim]").addEventListener("click", (event) => { if (event.target === event.currentTarget) close(); });
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.key !== "Tab") return;
      const focusables = [...dialog.querySelectorAll("button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex='-1'])")];
      if (!focusables.length) return;
      if (!dialog.contains(root.activeElement)) { event.preventDefault(); focusables[0].focus(); }
      else if (event.shiftKey && root.activeElement === focusables[0]) { event.preventDefault(); focusables.at(-1).focus(); }
      else if (!event.shiftKey && root.activeElement === focusables.at(-1)) { event.preventDefault(); focusables[0].focus(); }
    });
    root.querySelector("[data-close]").focus();
    return root;
  }

  async function render(course, key, token) {
    const root = showLoading(course, "Loading course policy and locally saved scores…", key);
    let policy;
    try { policy = await getPolicy(course); }
    catch (error) {
      if (token !== request || !host?.isConnected) return;
      root.querySelector("#acx-grade-status").textContent = error.message;
      root.querySelector(".body").insertAdjacentHTML("beforeend", '<button class="retry" type="button" data-retry>Try again</button>');
      root.querySelector("[data-retry]").addEventListener("click", () => { policies.delete(course.key); renderSafely(course, key); });
      return;
    }
    if (token !== request || !host?.isConnected) return;
    if (!policy?.policy?.inputs?.length || !policy.policy.formula) {
      root.querySelector("#acx-grade-status").textContent = `A verified grading policy for ${course.code} is not available yet. The calculator will appear here when the policy is added.`;
      root.querySelector(".body").insertAdjacentHTML("beforeend", '<button class="retry" type="button" data-retry>Check again</button>');
      root.querySelector("[data-retry]").addEventListener("click", () => { policies.delete(course.key); renderSafely(course, key); });
      return;
    }
    const passMark = Number.isFinite(Number(policy.policy.passMark)) ? Number(policy.policy.passMark) : PASS_MARK;
    const currentGradesCourse = visibleGradesCourse();
    const canImportGrades = currentGradesCourse?.termId === course.termId && currentGradesCourse?.code === course.code;
    const [saved, scores] = await Promise.all([
      localGet(INPUTS_KEY),
      Promise.resolve(canImportGrades ? gradesStore?.getCourseGrades(course.termId, course.code) || [] : []).catch(() => []),
    ]);
    if (token !== request || !host?.isConnected) return;
    const formKey = course.key;
    const inputDefinitions = [...policy.policy.inputs];
    const formulaHasRef = (expression, key) => expression?.ref === key || (Array.isArray(expression?.args) && expression.args.some((arg) => formulaHasRef(arg, key)));
    const bonusDefinitions = inputDefinitions.filter((input) => /bonus/i.test(`${input.key} ${input.label}`));
    if (!bonusDefinitions.length) {
      bonusDefinitions.push({ key: "BONUS", label: "Bonus marks (0–5, if offered)", source: "manual", maxScore: 5 });
      inputDefinitions.push(bonusDefinitions[0]);
    }
    const missingBonusRefs = bonusDefinitions.filter((input) => !formulaHasRef(policy.policy.formula, input.key)).map((input) => ({ ref: input.key }));
    const formula = missingBonusRefs.length ? { op: "sum", args: [policy.policy.formula, ...missingBonusRefs] } : policy.policy.formula;
    const rootInputs = inputDefinitions.map((input, index) => {
      const id = `acx-grade-${index}`;
      const scaleFromLabel = input.label.match(/\(\s*0\s*[-–—]\s*(\d+(?:\.\d+)?)\s*\)/)?.[1];
      const bonusCap = /bonus/i.test(`${input.key} ${input.label}`) ? policy.policy.eligibility?.match(/bonus.{0,80}?(?:capped at|up to|maximum(?: of)?)\s*(\d+(?:\.\d+)?)/i)?.[1] : null;
      const isBonus = /bonus/i.test(`${input.key} ${input.label}`);
      const scoreMax = input.source === "grades" ? 100 : Number.isFinite(Number(input.maxScore)) && Number(input.maxScore) > 0 ? Number(input.maxScore) : Number(scaleFromLabel || bonusCap) || (isBonus ? 5 : 100);
      const matching = input.source === "grades" ? scores.filter((record) => Number.isFinite(record.yourScore) && (!input.match || String(record.title || "").toLowerCase().includes(String(input.match).toLowerCase()))) : [];
      const totalCount = Number.isInteger(input.totalCount) && input.totalCount > 0 ? input.totalCount : 0;
      const pendingCount = Math.max(0, totalCount - matching.length);
      const bestCount = Number.isInteger(input.bestCount) && input.bestCount > 0 ? input.bestCount : totalCount;
      const importedScores = matching.map((record) => record.yourScore).sort((a, b) => b - a).slice(0, bestCount || matching.length);
      const autoValue = input.source === "grades" && importedScores.length ? importedScores.reduce((sum, score) => sum + score, 0) / importedScores.length : "";
      const value = saved[formKey]?.[input.key] ?? autoValue;
      const numericValue = value === "" || !Number.isFinite(Number(value)) ? "" : String(Number(value));
      const manualOverride = saved[formKey]?.__manualOverrides?.includes(input.key) || false;
      return { ...input, id, value: numericValue, autoValue, auto: input.source === "grades", scoreMax, count: matching.length, matchingScores: matching.map((record) => record.yourScore), totalCount, pendingCount, bestCount, manualOverride };
    });
    const bonusInputs = rootInputs.filter((input) => /bonus/i.test(`${input.key} ${input.label}`));
    const bonusOnlyAfterPass = bonusInputs.length > 0;
    const body = root.querySelector(".body");
    body.innerHTML = `<section aria-label="Assessment scores"><div class="fields">${rootInputs.map((input) => `<div class="field"><label for="${input.id}">${input.label.replace(/[&<>"']/g, "")}</label><input id="${input.id}" type="number" min="0" max="${input.scoreMax}" step="any" inputmode="decimal" value="${input.value}" aria-describedby="${input.id}-help"><small id="${input.id}-help">${input.auto ? `${input.count}/${input.totalCount || input.count} graded · score out of 100` : `0–${input.scoreMax}`}</small></div>`).join("")}</div></section>
      <button class="calculate" type="button" data-calculate>Calculate</button><p class="calc-error" data-error role="alert" hidden></p><p class="status" data-stale role="status" aria-live="polite" hidden></p>
      <section class="score-panel" data-score-panel data-state="warning" aria-label="Course score progress"><div class="score-heading"><div><span class="score-label">Weighted score</span><strong class="score" data-result>—</strong><span class="scale">/ 100</span></div></div><div class="score-track" data-meter role="img" aria-label="Score distribution"><div data-stack></div><span class="pass-marker" data-pass-marker></span></div><div class="meter-labels"><span>0</span><strong>Pass: ${passMark}</strong><span>100</span></div><div class="contribution-legend" data-legend></div></section>
      <section class="target" aria-labelledby="acx-pass-title"><h3 id="acx-pass-title">Required to pass · ${passMark}/100</h3><div class="scenario-grid" data-scenarios><p class="target-summary">Enter marks, then calculate.</p></div></section>${policy.policy.eligibility ? `<details class="eligibility"><summary>Eligibility rules</summary>${String(policy.policy.eligibility).replace(/[&<>"']/g, "")}</details>` : ""}`;
    const courseName = policy.course_name || course.courseName;
    root.querySelector(".eyebrow").textContent = `Grade calculator · ${course.termId} · ${courseName}`;
    root.querySelector("#acx-grade-title").textContent = courseName;
    const result = body.querySelector("[data-result]");
    const scenarios = body.querySelector("[data-scenarios]");
    const scorePanel = body.querySelector("[data-score-panel]");
    const calculateButton = body.querySelector("[data-calculate]");
    const errorMessage = body.querySelector("[data-error]");
    const staleMessage = body.querySelector("[data-stale]");
    const meter = body.querySelector("[data-meter]");
    const stack = body.querySelector("[data-stack]");
    const legend = body.querySelector("[data-legend]");
    const values = {};
    rootInputs.forEach((input) => { if (input.value !== "") values[input.key] = Number(input.value); });
    const partialGaa = (input) => input.auto && input.pendingCount > 0 && !input.manualOverride;
    let remaining = rootInputs.filter((input) => partialGaa(input) || !Number.isFinite(values[input.key]));
    const projectAt = (percent, targetGroups = null, fixedPercent = percent) => {
      const projected = { ...values };
      for (const input of remaining) {
        if (bonusInputs.includes(input)) {
          if (!Number.isFinite(projected[input.key])) projected[input.key] = 0;
          continue;
        }
        const group = assessmentGroup(input);
        const componentPercent = !targetGroups || targetGroups.has(group) ? percent : fixedPercent;
        const componentScore = componentPercent * input.scoreMax / 100;
        if (partialGaa(input)) {
          const scores = [...input.matchingScores, ...Array(input.pendingCount).fill(componentScore)].sort((a, b) => b - a).slice(0, input.bestCount || input.totalCount);
          projected[input.key] = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : componentScore;
        } else projected[input.key] = componentScore;
      }
      const score = evaluate(formula, projected, 0);
      if (!bonusOnlyAfterPass) return score;
      const beforeBonus = { ...projected };
      bonusInputs.forEach((input) => { beforeBonus[input.key] = 0; });
      const base = evaluate(formula, beforeBonus, 0);
      return base >= passMark ? score : base;
    };
    const solveTarget = (targetGroups, fixedPercent) => {
      const scoreAt = (percent) => projectAt(percent, targetGroups, fixedPercent);
      if (scoreAt(0) >= passMark) return 0;
      if (scoreAt(100) < passMark) return null;
      let low = 0, high = 100;
      for (let step = 0; step < 24; step += 1) {
        const midpoint = (low + high) / 2;
        if (scoreAt(midpoint) >= passMark) high = midpoint; else low = midpoint;
      }
      return Math.ceil(high);
    };
    const calculate = () => {
      const startedAt = performance.now();
      let phase = "start";
      console.info("[Acadrix Grade Calculator] Calculate clicked", { course: course.key, inputCount: rootInputs.length });
      calculateButton.disabled = true;
      calculateButton.textContent = "Calculating…";
      errorMessage.hidden = true;
      try {
        phase = "validate-inputs";
        for (const input of rootInputs) {
          const field = body.querySelector(`#${input.id}`), raw = field.value.trim();
          const invalid = raw !== "" && (!Number.isFinite(Number(raw)) || Number(raw) < 0 || Number(raw) > input.scoreMax);
          field.setAttribute("aria-invalid", String(invalid));
          field.setCustomValidity(invalid ? `Enter a score from 0 to ${input.scoreMax}.` : "");
          if (invalid) throw new Error(`Enter a score from 0 to ${input.scoreMax} for ${input.label}.`);
          if (raw !== "") values[input.key] = Number(raw); else delete values[input.key];
        }
        remaining = rootInputs.filter((input) => partialGaa(input) || !Number.isFinite(values[input.key]));
        console.info("[Acadrix Grade Calculator] Inputs validated", { course: course.key, enteredCount: Object.keys(values).length, remainingCount: remaining.length });
        phase = "solve-pass-targets";
        const earned = projectAt(0, null, 0), potential = projectAt(100, null, 100);
        const balanced = remaining.length ? solveTarget(null, 0) : null;
        const remainingAssessments = remaining.filter((input) => !bonusInputs.includes(input));
        const endTerm = remainingAssessments.filter((input) => assessmentGroup(input) === "End term");
        const coursework = remainingAssessments.filter((input) => assessmentGroup(input) !== "End term");
        const endTarget = endTerm.length && coursework.length ? solveTarget(new Set(["End term"]), 50) : null;
        const workTarget = endTerm.length && coursework.length ? solveTarget(new Set(coursework.map(assessmentGroup)), 50) : null;
        const passed = earned >= passMark, unreachable = potential < passMark;
        scorePanel.dataset.state = passed ? "safe" : unreachable ? "critical" : balanced !== null && balanced <= 50 ? "safe" : "warning";
        result.textContent = Math.max(0, Math.min(100, earned)).toFixed(2).replace(/\.00$/, "");
        body.querySelector("[data-pass-marker]").style.left = `${Math.max(0, Math.min(100, passMark))}%`;
        meter.setAttribute("aria-label", `Weighted score ${earned.toFixed(1)} out of 100; pass mark ${passMark}`);
        const attributed = { ...values };
        for (const input of rootInputs.filter(partialGaa)) {
          const scores = [...input.matchingScores, ...Array(input.pendingCount).fill(0)].sort((a, b) => b - a).slice(0, input.bestCount || input.totalCount);
          attributed[input.key] = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
        }
        const policyScore = (subset) => {
          const score = evaluate(formula, subset, 0);
          if (!bonusOnlyAfterPass) return score;
          const baseValues = { ...subset }; bonusInputs.forEach((input) => { baseValues[input.key] = 0; });
          const base = evaluate(formula, baseValues, 0);
          return base >= passMark ? score : base;
        };
        phase = "attribute-marks";
        console.info("[Acadrix Grade Calculator] Calculating assessment contributions", { course: course.key, inputCount: rootInputs.length, subsetCount: 2 ** rootInputs.length });
        const factorial = (n) => n < 2 ? 1 : n * factorial(n - 1);
        const bits = (value) => { let count = 0; while (value) { count += value & 1; value >>>= 1; } return count; };
        const count = rootInputs.length, contributions = rootInputs.map((input, index) => {
          let contribution = 0;
          for (let mask = 0; mask < (1 << count); mask += 1) {
            if (mask & (1 << index)) continue;
            const size = bits(mask), weight = factorial(size) * factorial(count - size - 1) / factorial(count);
            const before = {};
            rootInputs.forEach((item, itemIndex) => { if (mask & (1 << itemIndex)) before[item.key] = attributed[item.key] || 0; });
            contribution += (policyScore({ ...before, [input.key]: attributed[input.key] || 0 }) - policyScore(before)) * weight;
          }
          return Math.max(0, contribution);
        });
        const palette = ["#4f6bed", "#13a77a", "#d18a11", "#a45bd1", "#e05b76", "#168da0", "#718096", "#c15b32"];
        const parts = rootInputs.map((input, index) => {
          const amount = contributions[index], color = palette[index % palette.length];
          const segment = doc.createElement("span"); segment.style.width = `${Math.max(0, amount)}%`; segment.style.background = color; segment.title = `${input.label}: ${amount.toFixed(2)} marks`;
          const item = doc.createElement("span"), swatch = doc.createElement("i"); swatch.style.background = color; item.append(swatch, doc.createTextNode(`${input.label}: ${amount.toFixed(2)}`));
          return { segment, item };
        });
        stack.replaceChildren(...parts.map((part) => part.segment)); legend.replaceChildren(...parts.map((part) => part.item));
        phase = "render-results";
        scenarios.replaceChildren();
        const addScenario = (title, target, note, output = "") => {
          const card = doc.createElement("article"), heading = doc.createElement("h4"), detail = doc.createElement("p"), value = doc.createElement("strong");
          card.className = "scenario"; card.dataset.state = target === null ? "critical" : target <= 50 ? "safe" : target <= 85 ? "warning" : "critical";
          heading.textContent = title; detail.textContent = note; value.className = "scenario-value"; value.textContent = output || (target === null ? "Not reachable" : `≥ ${target}/100`);
          card.append(heading, detail, value); scenarios.append(card);
        };
        const formatMarks = (value) => Number(value.toFixed(2)).toString();
        const formatRequirements = (percent, targetGroups = null, fixedPercent = percent) => {
          const lines = remainingAssessments.map((input) => {
            const isTarget = !targetGroups || targetGroups.has(assessmentGroup(input));
            const score = (isTarget ? percent : fixedPercent) * input.scoreMax / 100;
            if (partialGaa(input)) {
              const scores = [...input.matchingScores, ...Array(input.pendingCount).fill(score)].sort((a, b) => b - a).slice(0, input.bestCount || input.totalCount);
              const average = scores.length ? scores.reduce((sum, item) => sum + item, 0) / scores.length : score;
              return `${input.label}: ${isTarget ? "score each remaining assignment" : "assume each remaining assignment"} ${formatMarks(score)}/100 (GAA average ${formatMarks(average)}/100)`;
            }
            return `${input.label}: ${isTarget ? "at least" : "assume"} ${formatMarks(score)}/${input.scoreMax}`;
          });
          return lines.join("\n");
        };
        const addPlan = (title, target, assumptions, targetGroups = null, fixedPercent = 0) => {
          if (target === null) return addScenario(title, null, `${assumptions}\nEven full marks cannot reach ${passMark}/100.`);
          const score = projectAt(target, targetGroups, fixedPercent);
          const requirements = formatRequirements(target, targetGroups, fixedPercent);
          return addScenario(title, target, `${assumptions}\n${requirements || "No unfinished assessments."}`, `Projected total: ${score.toFixed(2)}/100`);
        };
        if (passed) addScenario("Pass mark reached", 0, "Current weighted score", `${earned.toFixed(2)}/100`);
        else if (unreachable) addScenario("Not reachable", null, `Maximum possible weighted score: ${potential.toFixed(2)}/100.`);
        else if (!remainingAssessments.length) addScenario("Marks still needed", null, "All non-bonus assessments are complete.", `${(passMark - earned).toFixed(2)} weighted marks`);
        else {
          addPlan("Balanced", balanced, "Earn the same score on every unfinished assessment.");
          if (endTerm.length && coursework.length) {
            addPlan("End-term focus", endTarget, "Hold unfinished coursework at 50/100; vary the end term.", new Set(["End term"]), 50);
            addPlan("Coursework focus", workTarget, "Hold the end term at 50/100; vary unfinished coursework.", new Set(coursework.map(assessmentGroup)), 50);
          }
        }
      } catch (error) {
        result.textContent = "—"; scorePanel.dataset.state = "critical"; scenarios.replaceChildren();
        errorMessage.textContent = error.message || "Could not calculate this grading policy."; errorMessage.hidden = false;
        console.error("[Acadrix Grade Calculator] Calculation failed", { course: course.key, phase, error });
      } finally {
        calculateButton.disabled = false; calculateButton.textContent = "Calculate"; staleMessage.hidden = true;
        console.info("[Acadrix Grade Calculator] Calculation finished", { course: course.key, phase, durationMs: Math.round(performance.now() - startedAt) });
      }
    };
    rootInputs.forEach((input) => {
      const field = body.querySelector(`#${input.id}`);
      field.addEventListener("input", () => {
        field.setCustomValidity(""); input.manualOverride = !input.fromImport; input.fromImport = false;
        staleMessage.textContent = "Marks changed · recalculate"; staleMessage.hidden = false;
        clearTimeout(pendingSave);
        pendingSave = setTimeout(() => {
          const next = { ...(saved[formKey] || {}) };
          rootInputs.forEach((item) => { next[item.key] = body.querySelector(`#${item.id}`).value; });
          next.__manualOverrides = rootInputs.filter((item) => item.manualOverride).map((item) => item.key);
          saved[formKey] = next;
          localSet(INPUTS_KEY, saved);
        }, 250);
      });
    });
    calculateButton.addEventListener("click", calculate);
    console.info("[Acadrix Grade Calculator] Calculate button handler attached", { course: course.key, buttonFound: Boolean(calculateButton) });
    root.querySelector("[data-close]").focus();
  }

  function renderSafely(course, key) {
    const token = ++request;
    render(course, key, token).catch((error) => {
      console.error("[Acadrix] Could not render grade calculator", { course: course.key, error });
      if (token !== request || !host?.isConnected) return;
      const body = host.shadowRoot.querySelector(".body");
      if (!body) return;
      const message = doc.createElement("p");
      message.className = "hint";
      message.setAttribute("role", "alert");
      message.textContent = "Could not load the grade calculator. Close it and try again.";
      body.replaceChildren(message);
    });
  }

  async function run() {
    if (!doc) return;
    const gradeView = doc.querySelector(IITM_SELECTORS.decor.gradeView);
    if (gradeView) {
      const text = doc.querySelector(IITM_SELECTORS.decor.courseKey)?.textContent || "";
      const code = parseCourseCode(text, gradeView.textContent || "");
      const termId = parseTermId(text);
      if (code !== "UNKNOWN_COURSE") {
        const course = { key: `${termId}:${code}`, termId, code, courseName: code, title: "Grades" };
        const pageKey = `${course.key}:${course.title}`;
        if (pageKey !== activeKey || !host?.shadowRoot.querySelector("[data-grade-fab], [data-scrim]")) {
          activeKey = pageKey;
          request++;
          showLauncher(course, pageKey);
        }
      } else if (activeKey) {
        host?.remove();
        host = null;
        activeKey = "";
        request++;
      }
      const snapshot = `${text}:${[...gradeView.querySelectorAll(".desktop-container .item")].map((row) => row.textContent).join("|")}`;
      if (snapshot !== lastGradeSnapshot && code !== "UNKNOWN_COURSE" && gradesStore) {
        lastGradeSnapshot = snapshot;
        await captureGrades(doc, gradesStore);
      }
      return;
    }
    lastGradeSnapshot = "";
    const course = pageCourse();
    if (!course) { host?.remove(); host = null; activeKey = ""; request++; return; }
    const pageKey = `${course.key}:${course.title}`;
    if (pageKey !== activeKey || !host?.shadowRoot.querySelector("[data-grade-fab], [data-scrim]")) {
      activeKey = pageKey;
      request++;
      showLauncher(course, pageKey);
    }
  }

  function destroy() { clearTimeout(pendingSave); host?.remove(); host = null; activeKey = ""; }
  return { run, destroy };
}
