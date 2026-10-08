# ADR-001: Execution-World Boundary and Read-Only CustomEvent Bridge

## Status
Accepted

## Date
2026-10-08

## Context
Acadrix operates as a Manifest V3 Chrome extension on the IITM Online Degree portal (`study.iitm.ac.in`). The host portal runs a reactive Angular single-page application that mounts Ace Editor instances for programming assignments.

Under Chrome's MV3 execution-world architecture:
1. **Isolated World**: Extension content scripts run in an isolated execution sandbox sharing the DOM with the page, but maintaining an independent JavaScript heap.
2. **Main World**: The portal's Angular application, Ace editor instance, and third-party scripts execute in the page's primary execution context.
3. **Expando Invisibility**: Custom properties attached to DOM elements by the page (e.g. `aceElement.env = { editor }`) exist solely in the Page Main World. When accessed from the Extension Isolated World, `aceElement.env` evaluates to `undefined`.

The extension requires the ability to inspect the live Ace editor instance to read:
- The current editor session buffer
- Readonly line markers (`readonly_line`) protecting scaffold code
- Editor identity, language modes, and cursor coordinates

A communication bridge is therefore necessary to bridge the Main World and the Isolated World.

## Decision
1. Deploy `page-bridge.js` into the Page Main World at `document_start` via `manifest.json` (`"world": "MAIN"`).
2. Establish a versioned, schema-validated DOM `CustomEvent` communication bridge:
   - Request Event: `acadrix:programming-request`
   - Response Event: `acadrix:programming-response`
3. Restrict public CustomEvent operations strictly to read-only inspection:
   - `ping`: Health-check and readiness verification.
   - `getSnapshot`: Extracts serializable editor metadata, code, and marker coordinates.
4. Implement strict replay protection:
   - Every request must include a non-empty string `requestId`.
   - `page-bridge.js` maintains a bounded `seenRequestIds` FIFO set (up to 1,000 entries) and unconditionally rejects duplicate IDs with `DUPLICATE_REQUEST_ID`.
5. Strictly reject any public write operation:
   - Any request carrying `operation: "writeCode"` over the CustomEvent channel is rejected with `errorCode: "UNAUTHORIZED_OPERATION"`.

## Alternatives Considered

### Alternative 1: Direct DOM Expando Access from Isolated World
- *Pros*: Zero message-passing latency; no secondary script required.
- *Cons*: Impossible under Chrome's MV3 security architecture. Chrome explicitly isolates JavaScript heaps between worlds.
- *Reason for Rejection*: Violates fundamental platform constraints; `aceElement.env` is unreachable from content scripts.

### Alternative 2: Bidirectional CustomEvent Channel (Permitting `writeCode`)
- *Pros*: Simple, symmetric API for both reading and writing editor buffers.
- *Cons*: Critical security vulnerability. Any untrusted script, third-party tracker, or cross-site scripting (XSS) payload running in the page could dispatch synthetic `acadrix:programming-request` events with `operation: "writeCode"` to arbitrarily overwrite a student's code without user consent or validation.
- *Reason for Rejection*: Inacceptable risk of unauthorized code mutation and academic integrity compromise.

### Alternative 3: `window.postMessage` Channel
- *Pros*: Standardized cross-frame/cross-context messaging.
- *Cons*: Broadcasts messages to all frame listeners; requires complex origin checks; higher risk of interception by untrusted page listeners.
- *Reason for Rejection*: `CustomEvent` on the target window provides tighter DOM encapsulation without global postMessage broadcast pollution.

## Consequences
- **Positive**: Read operations are completely isolated and safe from privilege escalation.
- **Positive**: Replay attacks are neutralized via `seenRequestIds` caching.
- **Positive**: Third-party page scripts cannot trigger unauthorized code writes through the extension's bridge.
- **Negative**: Code writes cannot use the CustomEvent bridge and must be routed through a more complex privileged execution pipeline (see ADR-002).
