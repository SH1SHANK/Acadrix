# Security and privacy

Acadrix runs as a browser extension alongside an IITM portal page. It separates portal-owned state from extension code and uses explicit user actions for changes to portal answers or programming code.

## Execution boundaries

- The extension's content scripts run in the isolated world; IITM's Angular application, page JavaScript objects, and Ace editor live in the page's main world.
- The Reader UI is mounted in a closed Shadow DOM.
- `src/bridge/page-bridge.js` returns serialized programming-editor snapshots through a constrained CustomEvent interface. That public event channel is not a programming-code write interface.
- Programming writes are requested from the extension and executed through the background service worker's privileged `chrome.scripting` path. The write checks the target editor/question context, replaces only the editable range, and verifies protected scaffold content.
- Normal assessment answer application is also explicit and reviewable. Acadrix does not automatically submit assessments or run programming code.

## Network and data handling

Acadrix is not network-silent. The extension makes a GET request to its configured Supabase `public.academic_events` endpoint to retrieve public academic event data; returned records can be cached in `chrome.storage.local`. The browser extension includes the Supabase public/anonymous API key required for this public endpoint. It must not be treated as a secret or replaced with a service-role key.

When a student exports a bundle, the resource pipeline may fetch image or other resource URLs referenced by the assessment. PDF generation and document formatting use the extension's bundled code. Acadrix does not send assessment answers or programming code to an AI service. Preparing a prompt does not submit it; the student chooses whether and where to share copied prompt text.

## Extension permissions

The current manifest requests `scripting`, `activeTab`, `storage`, `debugger`, `alarms`, and `notifications`, and declares IITM host permissions. These are used by the extension's page bridge/write path, local caching, PDF support, and notification features. Review `extension/manifest.json` for the exact current host patterns and permissions.

## Reporting a vulnerability

Please do not publish exploit details in a public issue. Use [GitHub's private vulnerability reporting](https://github.com/SH1SHANK/unfold-iitm/security/advisories/new).

## Security checks

`npm test` runs `scripts/verify-architecture.mjs` and the security-related programming tests. Those checks cover selected source invariants; they are not a substitute for a full security audit. See [Testing](TESTING.md) for CI and local-only checks.
