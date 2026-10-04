#!/usr/bin/env node
/**
 * Resource & Asset Engine Verification Suite.
 * 
 * Tests Phase 5 requirements:
 * 1. Resource discovery from canonical AssignmentDocument
 * 2. Duplicate URL deduplication (shared across questions)
 * 3. URL normalization (query sorting, anchor stripping, case)
 * 4. Inline SVG materialization (deterministic .svg without network)
 * 5. Resource identity (distinct resources do not collide)
 * 6. Deterministic naming (identical input -> identical local paths)
 * 7. MIME classification (PNG, JPEG, WebP, GIF, SVG magic bytes)
 * 8. Unsafe URL rejection (javascript:, executable data: URLs)
 * 9. Fetch failure handling (network errors -> failed status)
 * 10. HTTP failure handling (4xx/5xx responses)
 * 11. Unsupported MIME handling (HTML is not saved as image)
 * 12. Bounded timeout termination
 * 13. Conservative retry policy (retries transient errors only)
 * 14. Bounded concurrency limiter
 * 15. Safe data:image/* URL materialization
 * 16. Resource manifest structure and fields
 * 17. Markdown path rewriting (images localized, links preserved)
 * 18. Canonical AST immutability
 * 19. Realistic mixed assignment (Section 32 fixture)
 * 20. Cancellation via AbortSignal
 */

import { ContentType, QuestionType } from "../src/model/types.js";
import { ContentNode, OptionNode, QuestionNode, AssignmentDocument } from "../src/model/document.js";
import { ResourceStatus, ResourceKind, MIME_TYPES } from "../src/resources/types.js";
import {
  hashString,
  hashBytes,
  normalizeResourceUrl,
  inferExtension,
  generateAssetLocalPath,
} from "../src/resources/naming.js";
import { discoverResources } from "../src/resources/discover.js";
import { acquireResource, acquireAllResources, decodeBase64 } from "../src/resources/fetch.js";
import { ResourceEngine, buildAssignmentBundle } from "../src/resources/engine.js";

let passed = true;

function check(desc, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`✓ ${desc}`);
    })
    .catch((e) => {
      console.error(`❌ ${desc}: ${e.message}`);
      passed = false;
    });
}

// Minimal 1x1 valid PNG fixture bytes
const ONE_PIXEL_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

async function runTests() {
  console.log("\nStarting Phase 5 Resource & Asset Engine Verification Suite...\n");

  // ── Test 1: Resource Discovery ──────────────────────────────────────────────
  await check("Test 1: Discover all image and SVG nodes from canonical AssignmentDocument", () => {
    const doc = new AssignmentDocument({
      metadata: { title: "Discovery Test" },
      questions: [
        new QuestionNode({
          number: 1,
          stem: [
            new ContentNode({
              type: ContentType.IMAGE,
              attributes: { src: "https://example.com/img1.png", alt: "Image 1" },
            }),
            new ContentNode({
              type: ContentType.SVG,
              value: '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>',
            }),
          ],
        }),
        new QuestionNode({
          number: 2,
          stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: "Text only" })],
          options: [
            new OptionNode({
              letter: "A",
              content: [
                new ContentNode({
                  type: ContentType.IMAGE,
                  attributes: { src: "https://example.com/opt-img.png" },
                }),
              ],
            }),
          ],
        }),
      ],
    });

    const { resources } = discoverResources(doc);
    if (resources.length !== 3) {
      throw new Error(`Expected 3 resources, discovered ${resources.length}`);
    }
    if (resources[0].kind !== ResourceKind.IMAGE || resources[0].source !== "https://example.com/img1.png") {
      throw new Error("Resource 1 discovery mismatch");
    }
    if (resources[1].kind !== ResourceKind.INLINE_SVG) {
      throw new Error("Resource 2 inline SVG discovery mismatch");
    }
    if (resources[2].kind !== ResourceKind.IMAGE || resources[2].source !== "https://example.com/opt-img.png") {
      throw new Error("Resource 3 option image discovery mismatch");
    }
  });

  // ── Test 2: Duplicate URLs ──────────────────────────────────────────────────
  await check("Test 2: Identical image URL appearing in multiple questions produces one resource", () => {
    const sharedUrl = "https://example.com/shared-diagram.png";
    const doc = new AssignmentDocument({
      metadata: { title: "Deduplication Test" },
      questions: [
        new QuestionNode({
          number: 1,
          stem: [new ContentNode({ type: ContentType.IMAGE, attributes: { src: sharedUrl } })],
        }),
        new QuestionNode({
          number: 3,
          stem: [new ContentNode({ type: ContentType.IMAGE, attributes: { src: sharedUrl } })],
        }),
        new QuestionNode({
          number: 9,
          stem: [new ContentNode({ type: ContentType.IMAGE, attributes: { src: sharedUrl } })],
        }),
      ],
    });

    const { resources, resourceMap } = discoverResources(doc);
    if (resources.length !== 1) {
      throw new Error(`Expected 1 deduplicated resource, got ${resources.length}`);
    }
    const res = resources[0];
    if (res.questions.length !== 3 || !res.questions.includes(1) || !res.questions.includes(3) || !res.questions.includes(9)) {
      throw new Error(`Expected questions [1, 3, 9], got ${JSON.stringify(res.questions)}`);
    }
    if (res.localPath !== "assets/q01-image-01.png") {
      throw new Error(`Expected primary path assets/q01-image-01.png, got ${res.localPath}`);
    }
    if (resourceMap.get(sharedUrl) !== "assets/q01-image-01.png") {
      throw new Error("Resource map did not map shared URL to primary local path");
    }
  });

  // ── Test 3: URL Normalization ───────────────────────────────────────────────
  await check("Test 3: Equivalent normalized URLs map consistently", () => {
    const urlA = "https://example.com/chart.png?sort=asc&filter=all#section1";
    const urlB = "https://example.com/chart.png?filter=all&sort=asc";

    const normA = normalizeResourceUrl(urlA);
    const normB = normalizeResourceUrl(urlB);

    if (normA !== normB) {
      throw new Error(`Normalized URLs differed:\n${normA}\nvs\n${normB}`);
    }
    if (normA.includes("#section1")) {
      throw new Error("Fragment hash should have been stripped");
    }

    const doc = new AssignmentDocument({
      metadata: { title: "Norm Test" },
      questions: [
        new QuestionNode({
          number: 1,
          stem: [new ContentNode({ type: ContentType.IMAGE, attributes: { src: urlA } })],
        }),
        new QuestionNode({
          number: 2,
          stem: [new ContentNode({ type: ContentType.IMAGE, attributes: { src: urlB } })],
        }),
      ],
    });

    const { resources } = discoverResources(doc);
    if (resources.length !== 1) {
      throw new Error(`Expected 1 resource after URL normalization, got ${resources.length}`);
    }
  });

  // ── Test 4: Inline SVG Materialization ──────────────────────────────────────
  await check("Test 4: Inline SVG materializes to local .svg asset without network request", async () => {
    const rawSvg = '<svg width="100" height="100"><rect width="100" height="100" fill="red"/></svg>';
    const doc = new AssignmentDocument({
      metadata: { title: "Inline SVG Test" },
      questions: [
        new QuestionNode({
          number: 2,
          stem: [new ContentNode({ type: ContentType.SVG, value: rawSvg })],
        }),
      ],
    });

    let networkCalled = false;
    const mockFetch = async () => {
      networkCalled = true;
      throw new Error("Network should not be called for inline SVG");
    };

    const bundle = await buildAssignmentBundle(doc, { fetchFn: mockFetch });
    if (networkCalled) {
      throw new Error("Network fetch was erroneously called for inline SVG");
    }
    if (bundle.manifest.downloaded !== 1) {
      throw new Error(`Expected 1 downloaded resource, got ${bundle.manifest.downloaded}`);
    }
    const asset = bundle.manifest.resources[0];
    if (asset.localPath !== "assets/q02-diagram-01.svg") {
      throw new Error(`Unexpected local path: ${asset.localPath}`);
    }
    if (asset.mimeType !== "image/svg+xml") {
      throw new Error(`Unexpected MIME: ${asset.mimeType}`);
    }
    if (asset.byteSize === 0) {
      throw new Error("Asset byteSize was 0");
    }
  });

  // ── Test 5: Resource Identity ───────────────────────────────────────────────
  await check("Test 5: Distinct resources produce unique IDs without collision", () => {
    const idA = hashString("https://example.com/imageA.png");
    const idB = hashString("https://example.com/imageB.png");
    if (idA === idB) {
      throw new Error("Different image URLs collided in hash identity");
    }

    const doc = new AssignmentDocument({
      metadata: { title: "Identity Test" },
      questions: [
        new QuestionNode({
          number: 1,
          stem: [
            new ContentNode({ type: ContentType.IMAGE, attributes: { src: "https://example.com/a.png" } }),
            new ContentNode({ type: ContentType.IMAGE, attributes: { src: "https://example.com/b.png" } }),
          ],
        }),
      ],
    });

    const { resources } = discoverResources(doc);
    if (resources[0].id === resources[1].id) {
      throw new Error("Distinct resources produced identical IDs");
    }
    if (resources[0].localPath === resources[1].localPath) {
      throw new Error("Distinct resources produced identical local paths");
    }
  });

  // ── Test 6: Deterministic Naming ────────────────────────────────────────────
  await check("Test 6: Identical input produces identical local asset paths across multiple runs", () => {
    const createDoc = () =>
      new AssignmentDocument({
        metadata: { title: "Deterministic Naming" },
        questions: [
          new QuestionNode({
            number: 1,
            stem: [
              new ContentNode({ type: ContentType.IMAGE, attributes: { src: "https://example.com/foo.png" } }),
              new ContentNode({ type: ContentType.IMAGE, attributes: { src: "https://example.com/bar.jpg" } }),
            ],
          }),
        ],
      });

    const run1 = discoverResources(createDoc());
    const run2 = discoverResources(createDoc());

    if (run1.resources[0].localPath !== run2.resources[0].localPath) {
      throw new Error("Resource 0 paths differed across runs");
    }
    if (run1.resources[1].localPath !== run2.resources[1].localPath) {
      throw new Error("Resource 1 paths differed across runs");
    }
    if (run1.resources[0].localPath !== "assets/q01-image-01.png") {
      throw new Error(`Expected assets/q01-image-01.png, got ${run1.resources[0].localPath}`);
    }
    if (run1.resources[1].localPath !== "assets/q01-image-02.jpg") {
      throw new Error(`Expected assets/q01-image-02.jpg, got ${run1.resources[1].localPath}`);
    }
  });

  // ── Test 7: MIME Classification ─────────────────────────────────────────────
  await check("Test 7: Accurate MIME classification and magic byte detection", () => {
    if (inferExtension("image/png") !== ".png") throw new Error("PNG MIME inference failed");
    if (inferExtension("image/jpeg") !== ".jpg") throw new Error("JPEG MIME inference failed");
    if (inferExtension("image/webp") !== ".webp") throw new Error("WebP MIME inference failed");
    if (inferExtension("image/gif") !== ".gif") throw new Error("GIF MIME inference failed");
    if (inferExtension("image/svg+xml") !== ".svg") throw new Error("SVG MIME inference failed");

    // Magic bytes detection
    const pngMagic = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    if (inferExtension("", "", pngMagic) !== ".png") throw new Error("PNG magic byte check failed");

    const jpegMagic = new Uint8Array([0xff, 0xd8, 0xff]);
    if (inferExtension("", "", jpegMagic) !== ".jpg") throw new Error("JPEG magic byte check failed");

    const gifMagic = new Uint8Array([0x47, 0x49, 0x46]);
    if (inferExtension("", "", gifMagic) !== ".gif") throw new Error("GIF magic byte check failed");
  });

  // ── Test 8: Unsafe URL Rejection ───────────────────────────────────────────
  await check("Test 8: javascript: and executable data: URLs are rejected without network calls", async () => {
    let fetchCalled = false;
    const mockFetch = async () => {
      fetchCalled = true;
      throw new Error("Fetch should not be called for unsafe URLs");
    };

    const doc = new AssignmentDocument({
      metadata: { title: "Unsafe URLs" },
      questions: [
        new QuestionNode({
          number: 1,
          stem: [
            new ContentNode({ type: ContentType.IMAGE, attributes: { src: "javascript:alert(1)" } }),
            new ContentNode({
              type: ContentType.IMAGE,
              attributes: { src: "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==" },
            }),
          ],
        }),
      ],
    });

    const bundle = await buildAssignmentBundle(doc, { fetchFn: mockFetch });
    if (fetchCalled) {
      throw new Error("Mock fetch was called on unsafe URL");
    }
    if (bundle.manifest.downloaded !== 0) {
      throw new Error("Unsafe URLs should have 0 downloads");
    }
    if (bundle.manifest.failed !== 2) {
      throw new Error(`Expected 2 failed resources, got ${bundle.manifest.failed}`);
    }
    if (bundle.manifest.resources[0].status !== ResourceStatus.FAILED) {
      throw new Error("javascript: URL was not marked as FAILED");
    }
    if (bundle.manifest.resources[1].status !== ResourceStatus.UNSUPPORTED) {
      throw new Error("data:text/html URL was not marked as UNSUPPORTED");
    }
  });

  // ── Test 9: Fetch Failure ───────────────────────────────────────────────────
  await check("Test 9: Network failure becomes explicit failed status", async () => {
    const mockFetch = async () => {
      throw new Error("DNS resolution failure");
    };

    const doc = new AssignmentDocument({
      metadata: { title: "Fetch Failure" },
      questions: [
        new QuestionNode({
          number: 1,
          stem: [new ContentNode({ type: ContentType.IMAGE, attributes: { src: "https://invalid.example/x.png" } })],
        }),
      ],
    });

    const bundle = await buildAssignmentBundle(doc, { fetchFn: mockFetch, retries: 0 });
    const res = bundle.manifest.resources[0];
    if (res.status !== ResourceStatus.FAILED) {
      throw new Error(`Expected status FAILED, got ${res.status}`);
    }
    if (!res.error || !res.error.includes("DNS resolution failure")) {
      throw new Error(`Expected DNS error, got: ${res.error}`);
    }
  });

  // ── Test 10: HTTP Failure ───────────────────────────────────────────────────
  await check("Test 10: Non-2xx HTTP responses (404 Not Found) are handled deterministically", async () => {
    const mockFetch = async () => ({
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: new Map(),
    });

    const doc = new AssignmentDocument({
      metadata: { title: "HTTP 404" },
      questions: [
        new QuestionNode({
          number: 1,
          stem: [new ContentNode({ type: ContentType.IMAGE, attributes: { src: "https://example.com/missing.png" } })],
        }),
      ],
    });

    const bundle = await buildAssignmentBundle(doc, { fetchFn: mockFetch, retries: 0 });
    const res = bundle.manifest.resources[0];
    if (res.status !== ResourceStatus.FAILED) {
      throw new Error(`Expected FAILED status for 404, got ${res.status}`);
    }
    if (!res.error || !res.error.includes("404")) {
      throw new Error(`Expected 404 error message, got: ${res.error}`);
    }
  });

  // ── Test 11: Unsupported Content-Type ───────────────────────────────────────
  await check("Test 11: HTML responses are rejected and not saved as image assets", async () => {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      headers: new Map([["content-type", "text/html; charset=utf-8"]]),
      arrayBuffer: async () => new TextEncoder().encode("<!DOCTYPE html><html><body>Error</body></html>").buffer,
    });

    const doc = new AssignmentDocument({
      metadata: { title: "HTML as Image" },
      questions: [
        new QuestionNode({
          number: 1,
          stem: [new ContentNode({ type: ContentType.IMAGE, attributes: { src: "https://example.com/error-page" } })],
        }),
      ],
    });

    const bundle = await buildAssignmentBundle(doc, { fetchFn: mockFetch });
    const res = bundle.manifest.resources[0];
    if (res.status !== ResourceStatus.UNSUPPORTED) {
      throw new Error(`Expected status UNSUPPORTED, got ${res.status}`);
    }
    if (!res.error || !res.error.includes("Unsupported Content-Type")) {
      throw new Error(`Expected unsupported Content-Type error, got: ${res.error}`);
    }
  });

  // ── Test 12: Bounded Timeout ────────────────────────────────────────────────
  await check("Test 12: Bounded timeout terminates hanging fetch", async () => {
    const mockFetch = (url, opts) =>
      new Promise((resolve, reject) => {
        opts.signal?.addEventListener("abort", () => {
          reject(new Error("The operation was aborted"));
        });
      });

    const doc = new AssignmentDocument({
      metadata: { title: "Timeout Test" },
      questions: [
        new QuestionNode({
          number: 1,
          stem: [new ContentNode({ type: ContentType.IMAGE, attributes: { src: "https://slow.example.com/hang.png" } })],
        }),
      ],
    });

    const bundle = await buildAssignmentBundle(doc, {
      fetchFn: mockFetch,
      timeoutMs: 40,
      retries: 0,
    });

    const res = bundle.manifest.resources[0];
    if (res.status !== ResourceStatus.FAILED) {
      throw new Error(`Expected FAILED status on timeout, got ${res.status}`);
    }
    if (!res.error || !res.error.toLowerCase().includes("time")) {
      throw new Error(`Expected timeout error message, got: ${res.error}`);
    }
  });

  // ── Test 13: Retry Strategy ─────────────────────────────────────────────────
  await check("Test 13: Transient failure retries and succeeds on next attempt", async () => {
    let attempts = 0;
    const mockFetch = async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("Temporary network glitch");
      }
      return {
        ok: true,
        status: 200,
        headers: new Map([["content-type", "image/png"]]),
        arrayBuffer: async () => ONE_PIXEL_PNG.buffer,
      };
    };

    const doc = new AssignmentDocument({
      metadata: { title: "Retry Test" },
      questions: [
        new QuestionNode({
          number: 1,
          stem: [new ContentNode({ type: ContentType.IMAGE, attributes: { src: "https://example.com/flaky.png" } })],
        }),
      ],
    });

    const bundle = await buildAssignmentBundle(doc, {
      fetchFn: mockFetch,
      retries: 1,
    });

    if (attempts !== 2) {
      throw new Error(`Expected 2 attempts (1 initial + 1 retry), got ${attempts}`);
    }
    if (bundle.manifest.downloaded !== 1) {
      throw new Error("Expected resource to succeed on retry");
    }
  });

  // ── Test 14: Concurrency Limiting ───────────────────────────────────────────
  await check("Test 14: Maximum configured concurrency limit is respected", async () => {
    let active = 0;
    let maxConcurrent = 0;

    const mockFetch = async () => {
      active += 1;
      maxConcurrent = Math.max(maxConcurrent, active);
      // Simulate small async delay
      await new Promise((r) => setTimeout(r, 20));
      active -= 1;
      return {
        ok: true,
        status: 200,
        headers: new Map([["content-type", "image/png"]]),
        arrayBuffer: async () => ONE_PIXEL_PNG.buffer,
      };
    };

    const doc = new AssignmentDocument({
      metadata: { title: "Concurrency Test" },
      questions: Array.from({ length: 8 }, (_, i) =>
        new QuestionNode({
          number: i + 1,
          stem: [
            new ContentNode({
              type: ContentType.IMAGE,
              attributes: { src: `https://example.com/img-${i + 1}.png` },
            }),
          ],
        })
      ),
    });

    const bundle = await buildAssignmentBundle(doc, {
      fetchFn: mockFetch,
      concurrency: 2,
    });

    if (maxConcurrent > 2) {
      throw new Error(`Max concurrent fetches exceeded limit of 2: was ${maxConcurrent}`);
    }
    if (bundle.manifest.downloaded !== 8) {
      throw new Error(`Expected 8 downloaded resources, got ${bundle.manifest.downloaded}`);
    }
  });

  // ── Test 15: Data URL Materialization ───────────────────────────────────────
  await check("Test 15: Safe data:image/* URL materializes directly without network", async () => {
    const b64Png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    let networkCalled = false;
    const mockFetch = async () => {
      networkCalled = true;
      throw new Error("Network should not be called for data: URL");
    };

    const doc = new AssignmentDocument({
      metadata: { title: "Data URL Test" },
      questions: [
        new QuestionNode({
          number: 1,
          stem: [new ContentNode({ type: ContentType.IMAGE, attributes: { src: b64Png } })],
        }),
      ],
    });

    const bundle = await buildAssignmentBundle(doc, { fetchFn: mockFetch });
    if (networkCalled) {
      throw new Error("Network was erroneously invoked for data: URL");
    }
    if (bundle.manifest.downloaded !== 1) {
      throw new Error("Expected 1 downloaded resource for data URL");
    }
    const res = bundle.manifest.resources[0];
    if (res.mimeType !== "image/png") {
      throw new Error(`Expected image/png MIME, got ${res.mimeType}`);
    }
    if (res.byteSize === 0) {
      throw new Error("Materialized byteSize was 0");
    }
  });

  // ── Test 16: Resource Manifest ──────────────────────────────────────────────
  await check("Test 16: Manifest contains deterministic expected structure and entries", async () => {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      headers: new Map([["content-type", "image/png"]]),
      arrayBuffer: async () => ONE_PIXEL_PNG.buffer,
    });

    const doc = new AssignmentDocument({
      metadata: { title: "Manifest Test" },
      questions: [
        new QuestionNode({
          number: 1,
          stem: [new ContentNode({ type: ContentType.IMAGE, attributes: { src: "https://example.com/sample.png" } })],
        }),
      ],
    });

    const bundle = await buildAssignmentBundle(doc, { fetchFn: mockFetch });
    const { manifest } = bundle;

    if (manifest.version !== "1.0.0") throw new Error("Manifest version mismatch");
    if (manifest.totalResources !== 1) throw new Error("Manifest totalResources mismatch");
    if (manifest.downloaded !== 1) throw new Error("Manifest downloaded mismatch");
    if (manifest.failed !== 0) throw new Error("Manifest failed mismatch");

    const entry = manifest.resources[0];
    if (!entry.id || !entry.source || !entry.localPath || !entry.contentHash) {
      throw new Error(`Manifest entry missing required fields: ${JSON.stringify(entry)}`);
    }
    if (entry.localPath !== "assets/q01-image-01.png") {
      throw new Error(`Unexpected localPath in manifest: ${entry.localPath}`);
    }
  });

  // ── Test 17: Markdown Path Rewriting ────────────────────────────────────────
  await check("Test 17: Resource references in Markdown are rewritten to local asset paths", async () => {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      headers: new Map([["content-type", "image/png"]]),
      arrayBuffer: async () => ONE_PIXEL_PNG.buffer,
    });

    const doc = new AssignmentDocument({
      metadata: { title: "Rewrite Test" },
      questions: [
        new QuestionNode({
          number: 1,
          stem: [
            new ContentNode({
              type: ContentType.PARAGRAPH,
              children: [
                new ContentNode({ type: ContentType.TEXT, value: "Check diagram " }),
                new ContentNode({
                  type: ContentType.IMAGE,
                  attributes: { src: "https://cdn.example.com/network.png", alt: "Network" },
                }),
                new ContentNode({ type: ContentType.TEXT, value: " and documentation " }),
                new ContentNode({
                  type: ContentType.LINK,
                  value: "Docs",
                  attributes: { href: "https://docs.example.com" },
                }),
              ],
            }),
          ],
        }),
      ],
    });

    const bundle = await buildAssignmentBundle(doc, { fetchFn: mockFetch });
    const { markdown } = bundle;

    if (!markdown.includes("![Network](assets/q01-image-01.png)")) {
      throw new Error(`Markdown did not rewrite image to local asset path:\n${markdown}`);
    }
    if (!markdown.includes("[Docs](https://docs.example.com)")) {
      throw new Error(`Markdown should have preserved external hyperlink:\n${markdown}`);
    }
  });

  // ── Test 18: Canonical AST Immutability ─────────────────────────────────────
  await check("Test 18: Resource processing does NOT mutate the original AssignmentDocument", async () => {
    const originalUrl = "https://example.com/unmutated.png";
    const imgNode = new ContentNode({
      type: ContentType.IMAGE,
      attributes: { src: originalUrl, alt: "Alt text" },
    });
    const question = new QuestionNode({
      number: 1,
      stem: [imgNode],
    });
    const doc = new AssignmentDocument({
      metadata: { title: "Immutability Test" },
      questions: [question],
    });

    const mockFetch = async () => ({
      ok: true,
      status: 200,
      headers: new Map([["content-type", "image/png"]]),
      arrayBuffer: async () => ONE_PIXEL_PNG.buffer,
    });

    await buildAssignmentBundle(doc, { fetchFn: mockFetch });

    // Assert original AST was not mutated
    if (imgNode.attributes.src !== originalUrl) {
      throw new Error(`imgNode.attributes.src was mutated! Now: ${imgNode.attributes.src}`);
    }
    if (question.stem[0] !== imgNode) {
      throw new Error("Question stem child reference was altered");
    }
    if (doc.questions[0] !== question) {
      throw new Error("AssignmentDocument questions array reference was altered");
    }
  });

  // ── Test 19: Realistic Mixed Assignment (Section 32 Fixture) ────────────────
  await check("Test 19: Realistic mixed multi-question fixture (Section 32)", async () => {
    const urlA = "https://example.com/imageA.png";
    const urlB = "https://example.com/imageB.png";
    const urlC = "https://example.com/imageC.png";
    const inlineSvg = '<svg viewBox="0 0 50 50"><circle cx="25" cy="25" r="20"/></svg>';

    const doc = new AssignmentDocument({
      metadata: { title: "Realistic Assignment", course: "Data Structures", totalQuestions: 3 },
      questions: [
        // Q1: Image A and Image B
        new QuestionNode({
          number: 1,
          type: QuestionType.MCQ,
          stem: [
            new ContentNode({ type: ContentType.IMAGE, attributes: { src: urlA, alt: "Image A" } }),
            new ContentNode({ type: ContentType.IMAGE, attributes: { src: urlB, alt: "Image B" } }),
          ],
        }),
        // Q2: Image A (repeated) and Inline SVG
        new QuestionNode({
          number: 2,
          type: QuestionType.MCQ,
          stem: [
            new ContentNode({ type: ContentType.IMAGE, attributes: { src: urlA, alt: "Image A Repeated" } }),
            new ContentNode({ type: ContentType.SVG, value: inlineSvg }),
          ],
        }),
        // Q3: Image C
        new QuestionNode({
          number: 3,
          type: QuestionType.NUMERICAL,
          stem: [new ContentNode({ type: ContentType.IMAGE, attributes: { src: urlC, alt: "Image C" } })],
        }),
      ],
    });

    const mockFetch = async () => ({
      ok: true,
      status: 200,
      headers: new Map([["content-type", "image/png"]]),
      arrayBuffer: async () => ONE_PIXEL_PNG.buffer,
    });

    const bundle = await buildAssignmentBundle(doc, { fetchFn: mockFetch });

    // Section 32 Expected Output:
    // assets/q01-image-01.png (Image A)
    // assets/q01-image-02.png (Image B)
    // assets/q02-diagram-01.svg (Inline SVG)
    // assets/q03-image-01.png (Image C)
    if (bundle.manifest.resources.length !== 4) {
      throw new Error(`Expected exactly 4 unique resources, got ${bundle.manifest.resources.length}`);
    }

    const paths = bundle.manifest.resources.map((r) => r.localPath);
    if (!paths.includes("assets/q01-image-01.png")) throw new Error("Missing assets/q01-image-01.png");
    if (!paths.includes("assets/q01-image-02.png")) throw new Error("Missing assets/q01-image-02.png");
    if (!paths.includes("assets/q02-diagram-01.svg")) throw new Error("Missing assets/q02-diagram-01.svg");
    if (!paths.includes("assets/q03-image-01.png")) throw new Error("Missing assets/q03-image-01.png");

    // Verify Image A was deduplicated (referenced in both Q1 and Q2)
    const resA = bundle.manifest.resources.find((r) => r.source === urlA);
    if (!resA || resA.questions.length !== 2 || !resA.questions.includes(1) || !resA.questions.includes(2)) {
      throw new Error("Image A was not recorded as shared between Q1 and Q2");
    }

    // Verify Markdown references point to local assets
    const { markdown } = bundle;
    if (!markdown.includes("![Image A](assets/q01-image-01.png)")) {
      throw new Error("Q1 Image A local reference missing in Markdown");
    }
    if (!markdown.includes("![Image B](assets/q01-image-02.png)")) {
      throw new Error("Q1 Image B local reference missing in Markdown");
    }
    if (!markdown.includes("![Image A Repeated](assets/q01-image-01.png)")) {
      throw new Error("Q2 Image A repeated local reference missing in Markdown");
    }
    if (!markdown.includes("assets/q02-diagram-01.svg")) {
      throw new Error("Q2 Inline SVG local reference missing in Markdown");
    }
    if (!markdown.includes("![Image C](assets/q03-image-01.png)")) {
      throw new Error("Q3 Image C local reference missing in Markdown");
    }
  });

  // ── Test 20: Cancellation via AbortSignal ──────────────────────────────────
  await check("Test 20: AbortSignal cleanly terminates pending work", async () => {
    const controller = new AbortController();

    const mockFetch = async () => {
      // Abort after start
      controller.abort();
      return new Promise((_, reject) => {
        setTimeout(() => reject(new Error("aborted")), 10);
      });
    };

    const doc = new AssignmentDocument({
      metadata: { title: "Cancel Test" },
      questions: [
        new QuestionNode({
          number: 1,
          stem: [new ContentNode({ type: ContentType.IMAGE, attributes: { src: "https://example.com/abort.png" } })],
        }),
      ],
    });

    const bundle = await buildAssignmentBundle(doc, {
      fetchFn: mockFetch,
      signal: controller.signal,
    });

    const res = bundle.manifest.resources[0];
    if (res.status !== ResourceStatus.FAILED) {
      throw new Error(`Expected FAILED on cancellation, got ${res.status}`);
    }
    if (!res.error || !res.error.toLowerCase().includes("cancel")) {
      throw new Error(`Expected cancellation error, got: ${res.error}`);
    }
  });

  if (!passed) {
    console.error("\nResource & Asset Engine verification FAILED.");
    process.exit(1);
  } else {
    console.log("\nAll 20 Resource & Asset Engine tests passed successfully!\n");
  }
}

runTests();
