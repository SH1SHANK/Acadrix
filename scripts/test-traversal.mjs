#!/usr/bin/env node
/**
 * Automated Traversal Engine Test Suite.
 * 
 * Tests Phase 2 objectives:
 * - Test A: Delayed question replacement (mutation awareness)
 * - Test B: Question node replacement (DOM resilience)
 * - Test C: Paginator window replacement (window progression & fresh discovery)
 * - Test D: Duplicate prevention (logical question identity)
 * - Test E: Restoration of original location across windows
 * - Test F: Navigation timeout with diagnostic error reporting
 * - Test G: Assessment container replacement during readiness
 * - Test H: Paginator control detection (supported DOM standards)
 * - Test I: Paginator control click without window change
 * - Test J: Logical identity across windows (no false deduplication)
 */

import { QuestionTraverser } from "../src/traversal/traverser.js";
import { IitmPortalAdapter } from "../src/portal/adapter.js";
import {
  NavigationTimeoutError,
  NavigationMismatchError,
  PaginatorAdvanceTimeoutError,
  RestorationError,
} from "../src/traversal/errors.js";

let passed = true;

function check(desc, fn) {
  return fn()
    .then(() => {
      console.log(`✓ ${desc}`);
    })
    .catch((e) => {
      console.error(`❌ ${desc}: ${e.message}`);
      passed = false;
    });
}

// Minimal DOM & MutationObserver simulation for Node environment
class MockEventTarget {
  constructor() {
    this._listeners = new Set();
  }
  addEventListener(cb) {
    this._listeners.add(cb);
  }
  removeEventListener(cb) {
    this._listeners.delete(cb);
  }
  _dispatch() {
    for (const cb of this._listeners) cb();
  }
}

class MockMutationObserver {
  constructor(callback) {
    this.callback = callback;
    this.target = null;
    this._handler = () => this.callback([]);
  }
  observe(target) {
    this.target = target;
    if (target && target._eventTarget) {
      target._eventTarget.addEventListener(this._handler);
    }
  }
  disconnect() {
    if (this.target && this.target._eventTarget) {
      this.target._eventTarget.removeEventListener(this._handler);
    }
    this.target = null;
  }
}

globalThis.MutationObserver = MockMutationObserver;

/**
 * Creates a simulated IITM Portal environment with configurable behavior.
 */
function createSimulatedPortal({
  totalQuestions = 10,
  windowSize = 5,
  initialQuestion = 1,
  navigationDelayMs = 0,
  simulateHangingQuestion = null,
  simulateHangingPagination = false,
  useUnnumberedChips = false,
} = {}) {
  const eventTarget = new MockEventTarget();
  let currentLogical = initialQuestion;
  let currentWindowIndex = Math.floor((initialQuestion - 1) / windowSize);

  let container = {
    _eventTarget: eventTarget,
    children: [{}],
    textContent: `Question ${currentLogical} / ${totalQuestions}`,
    isConnected: true,
  };

  const stableAncestor = {
    _eventTarget: eventTarget,
    children: [container],
    textContent: "",
    isConnected: true,
  };
  container.parentElement = stableAncestor;

  const getVisibleRange = () => {
    const start = currentWindowIndex * windowSize + 1;
    const end = Math.min(start + windowSize - 1, totalQuestions);
    return { start, end };
  };

  const portal = {
    detectAssessment: () => true,
    getPaginator: () => null,
    getAssessmentView: () => container,
    getCurrentQuestionElement: () => container,
    getStableAssessmentAncestor: () => stableAncestor,
    isQuestionStructurallyReady: () => container && container.children.length > 0,
    isReviewMode: () => false,
    getTotalQuestionCount: () => totalQuestions,

    getActiveLogicalNumber: () => currentLogical,
    getActiveIndex: () => currentLogical - 1,

    getQuestionChips: () => {
      const { start, end } = getVisibleRange();
      const chips = [];
      for (let i = start; i <= end; i++) {
        chips.push({
          textContent: useUnnumberedChips ? "Q" : String(i),
          classList: {
            contains: (cls) => (cls === "active" || cls === "current") && currentLogical === i,
          },
          getAttribute: (attr) => {
            if (attr === "aria-current") return String(currentLogical === i);
            if (attr === "aria-label") return useUnnumberedChips ? null : `Question ${i}`;
            return null;
          },
          click: () => {
            if (simulateHangingQuestion === i) {
              // Simulates hanging navigation: DOM never transitions to this question
              return;
            }
            if (navigationDelayMs > 0) {
              setTimeout(() => {
                currentLogical = i;
                container.textContent = `Question ${currentLogical} / ${totalQuestions}`;
                eventTarget._dispatch();
              }, navigationDelayMs);
            } else {
              currentLogical = i;
              container.textContent = `Question ${currentLogical} / ${totalQuestions}`;
              eventTarget._dispatch();
            }
          },
        });
      }
      return chips;
    },

    getChipLogicalNumber: (chip) => {
      if (useUnnumberedChips) return null;
      return parseInt(chip.textContent.trim(), 10);
    },

    getActiveChip: () => {
      const chips = portal.getQuestionChips();
      return chips.find((c) => portal.getChipLogicalNumber(c) === currentLogical) || null;
    },

    getPaginatorWindowIdentity: () => {
      const { start, end } = getVisibleRange();
      return `${start}..${end}`;
    },

    canAdvanceWindow: () => {
      const { end } = getVisibleRange();
      return end < totalQuestions;
    },

    advanceWindow: () => {
      if (simulateHangingPagination) {
        // Simulates click dispatched but paginator hangs / produces no DOM change
        return true;
      }
      if (portal.canAdvanceWindow()) {
        currentWindowIndex++;
        eventTarget._dispatch();
        return true;
      }
      return false;
    },

    canRewindWindow: () => currentWindowIndex > 0,

    rewindWindow: () => {
      if (portal.canRewindWindow()) {
        currentWindowIndex--;
        eventTarget._dispatch();
        return true;
      }
      return false;
    },

    // Method to simulate replacing the question container content (Test B)
    _replaceContainer: (newContent) => {
      container.children = [{}];
      container.textContent = newContent;
      eventTarget._dispatch();
    },

    // Method to simulate full container replacement in stable ancestor (Test G)
    _replaceEntireView: (newLogical) => {
      container.isConnected = false;
      const newContainer = {
        _eventTarget: eventTarget,
        children: [{}],
        textContent: `Question ${newLogical} / ${totalQuestions}`,
        isConnected: true,
        parentElement: stableAncestor,
      };
      container = newContainer;
      currentLogical = newLogical;
      stableAncestor.children = [newContainer];
      eventTarget._dispatch();
    },
  };

  return portal;
}

// Run test suite sequentially
async function runTests() {
  console.log("Starting Phase 2 Traversal Engine Verification...\n");

  // Test A — Delayed Question Replacement (Mutation-Aware Readiness)
  await check("Test A: Delayed question replacement resolves via mutation observer", async () => {
    const portal = createSimulatedPortal({ totalQuestions: 3, navigationDelayMs: 60 });
    const traverser = new QuestionTraverser(portal, { timeoutMs: 1000 });

    const visited = [];
    await traverser.traverseAll({
      onQuestion: (ctx) => {
        visited.push(ctx.number);
      },
    });

    if (visited.length !== 3 || visited.join(",") !== "1,2,3") {
      throw new Error(`Expected visited [1, 2, 3], got [${visited.join(", ")}]`);
    }
  });

  // Test B — Question Node Replacement
  await check("Test B: Resilient to container replacement", async () => {
    const portal = createSimulatedPortal({ totalQuestions: 2 });
    const traverser = new QuestionTraverser(portal, { timeoutMs: 1000 });

    let replaced = false;
    await traverser.traverseAll({
      onQuestion: (ctx) => {
        if (ctx.number === 1 && !replaced) {
          // Simulate Angular replacing question node
          portal._replaceContainer("Replaced Question 1 Content");
          replaced = true;
        }
      },
    });

    if (!replaced) throw new Error("Replacement simulation did not trigger");
  });

  // Test C — Paginator Window Replacement
  await check("Test C: Traverses across paginator windows with fresh chip discovery", async () => {
    // 10 questions with windowSize = 4 (3 windows: 1-4, 5-8, 9-10)
    const portal = createSimulatedPortal({ totalQuestions: 10, windowSize: 4 });
    const traverser = new QuestionTraverser(portal, { timeoutMs: 1000 });

    const visited = [];
    await traverser.traverseAll({
      onQuestion: (ctx) => {
        visited.push(ctx.number);
      },
    });

    if (visited.length !== 10) {
      throw new Error(`Expected 10 questions across windows, got ${visited.length}`);
    }
    for (let i = 1; i <= 10; i++) {
      if (visited[i - 1] !== i) {
        throw new Error(`Question order mismatch at index ${i - 1}: expected ${i}, got ${visited[i - 1]}`);
      }
    }
  });

  // Test D — Duplicate Prevention
  await check("Test D: Duplicate prevention guarantees each question is traversed exactly once", async () => {
    const portal = createSimulatedPortal({ totalQuestions: 6, windowSize: 3 });
    const traverser = new QuestionTraverser(portal, { timeoutMs: 1000 });

    const visited = [];
    await traverser.traverseAll({
      onQuestion: (ctx) => {
        visited.push(ctx.number);
      },
    });

    const uniqueSet = new Set(visited);
    if (uniqueSet.size !== visited.length) {
      throw new Error(`Duplicates detected in traversal: [${visited.join(", ")}]`);
    }
    if (visited.length !== 6) {
      throw new Error(`Expected 6 unique questions, got ${visited.length}`);
    }
  });

  // Test E — Original Location Restoration
  await check("Test E: User original question is restored across windows", async () => {
    // Start on Question 8 (in window 2 of a 10-question assessment)
    const portal = createSimulatedPortal({ totalQuestions: 10, windowSize: 5, initialQuestion: 8 });
    const traverser = new QuestionTraverser(portal, { timeoutMs: 1000 });

    await traverser.traverseAll({
      onQuestion: () => {},
    });

    const finalLogical = portal.getActiveLogicalNumber();
    if (finalLogical !== 8) {
      throw new Error(`Expected restored question 8, but portal remained at ${finalLogical}`);
    }
    if (traverser.lastRestorationError) {
      throw new Error(`Restoration error reported: ${traverser.lastRestorationError.message}`);
    }
  });

  // Test F — Navigation Timeout Handling
  await check("Test F: Navigation timeout rejects deterministically with diagnostic payload", async () => {
    // Simulate question 2 never responding
    const portal = createSimulatedPortal({ totalQuestions: 3, simulateHangingQuestion: 2 });
    const traverser = new QuestionTraverser(portal, { timeoutMs: 120 });

    let threwExpected = false;
    try {
      await traverser.traverseAll();
    } catch (err) {
      if (err instanceof NavigationTimeoutError) {
        threwExpected = true;
        if (err.details.targetNumber !== 2) {
          throw new Error(`Expected targetNumber 2 in error details, got ${err.details.targetNumber}`);
        }
      } else {
        throw new Error(`Expected NavigationTimeoutError, got ${err.name}: ${err.message}`);
      }
    }

    if (!threwExpected) {
      throw new Error("Traverser did not throw NavigationTimeoutError on hanging question");
    }
  });

  // Test G — Assessment Container Replacement During Readiness
  await check("Test G: Assessment container replacement during readiness resolves via stable ancestor", async () => {
    const portal = createSimulatedPortal({ totalQuestions: 3, initialQuestion: 1 });
    const traverser = new QuestionTraverser(portal, { timeoutMs: 1000 });

    // Start waiting for question 2 (currently on question 1)
    const readinessPromise = traverser.waitForQuestionReady(2);

    // Simulate asynchronous Angular teardown: old view is removed and new view is inserted
    setTimeout(() => {
      portal._replaceEntireView(2);
    }, 40);

    await readinessPromise;

    if (portal.getActiveLogicalNumber() !== 2) {
      throw new Error(`Expected question 2 ready, got ${portal.getActiveLogicalNumber()}`);
    }
  });

  // Test H — Paginator Control Detection (without unsupported CSS like :contains)
  await check("Test H: Paginator control detection uses valid standards and property inspection", async () => {
    const createButton = ({ classes = [], text = "", aria = "", disabled = false, iconText = "" } = {}) => {
      const classSet = new Set(classes);
      const icon = iconText ? { textContent: iconText, getAttribute: () => null } : null;
      return {
        textContent: text,
        disabled,
        classList: {
          contains: (cls) => classSet.has(cls),
        },
        getAttribute: (attr) => {
          if (attr === "aria-label") return aria;
          if (attr === "aria-disabled") return disabled ? "true" : null;
          return null;
        },
        hasAttribute: (attr) => attr === "disabled" && disabled,
        querySelector: (sel) => (icon && sel.includes("mat-icon") ? icon : null),
        querySelectorAll: () => [],
      };
    };

    const nextBtn = createButton({
      classes: ["arrow-btn"],
      iconText: "chevron_right",
      aria: "Next",
    });

    const prevBtn = createButton({
      classes: ["arrow-btn"],
      iconText: "chevron_left",
      aria: "Previous",
    });

    const mockPaginator = {
      querySelector: () => null,
      querySelectorAll: (sel) => {
        if (sel === "button:not(.chip)") return [prevBtn, nextBtn];
        if (sel === "button.arrow-btn") return [prevBtn, nextBtn];
        return [];
      },
    };

    const mockDoc = {
      querySelector: (sel) => {
        if (sel.includes("chips") || sel.includes("paginator")) return mockPaginator;
        return null;
      },
      querySelectorAll: () => [],
    };

    const testAdapter = new IitmPortalAdapter(mockDoc);
    const discoveredNext = testAdapter.getNextWindowButton();
    const discoveredPrev = testAdapter.getPrevWindowButton();

    if (discoveredNext !== nextBtn) {
      throw new Error("Failed to detect next window button via mat-icon inspection");
    }
    if (discoveredPrev !== prevBtn) {
      throw new Error("Failed to detect prev window button via mat-icon inspection");
    }
    if (!testAdapter.canAdvanceWindow()) {
      throw new Error("canAdvanceWindow returned false for enabled next button");
    }

    // Verify disabled state handling
    nextBtn.disabled = true;
    if (testAdapter.canAdvanceWindow()) {
      throw new Error("canAdvanceWindow returned true for disabled next button");
    }
  });

  // Test I — Paginator Control Click Without Window Change
  await check("Test I: Paginator control click without window change throws PaginatorAdvanceTimeoutError", async () => {
    // Portal where next button can be clicked, but DOM/window identity never changes
    const portal = createSimulatedPortal({
      totalQuestions: 6,
      windowSize: 3,
      simulateHangingPagination: true,
    });
    const traverser = new QuestionTraverser(portal, { timeoutMs: 120 });

    let threwExpected = false;
    try {
      await traverser.advanceWindow(120);
    } catch (err) {
      if (err instanceof PaginatorAdvanceTimeoutError) {
        threwExpected = true;
        if (!err.message.includes("did not change")) {
          throw new Error(`Unexpected error message: ${err.message}`);
        }
      } else {
        throw new Error(`Expected PaginatorAdvanceTimeoutError, got ${err.name}: ${err.message}`);
      }
    }

    if (!threwExpected) {
      throw new Error("advanceWindow did not reject with PaginatorAdvanceTimeoutError when window identity stalled");
    }
  });

  // Test J — Logical Identity Across Windows (no false deduplication on unnumbered chips)
  await check("Test J: Window-aware identity prevents false cross-window deduplication", async () => {
    // 2 windows of 3 questions (total 6), with unnumbered chips (getChipLogicalNumber returns null)
    const portal = createSimulatedPortal({
      totalQuestions: 6,
      windowSize: 3,
      useUnnumberedChips: true,
    });
    const traverser = new QuestionTraverser(portal, { timeoutMs: 1000 });

    const visited = [];
    await traverser.traverseAll({
      onQuestion: (ctx) => {
        visited.push(ctx.number);
      },
    });

    if (visited.length !== 6) {
      throw new Error(
        `Expected all 6 questions across windows to be traversed, but got ${visited.length} (possible false deduplication)`
      );
    }
  });

  if (!passed) {
    console.error("\nTraversal tests FAILED.\n");
    process.exit(1);
  } else {
    console.log("\nAll traversal engine tests passed successfully!\n");
  }
}

runTests();
