/**
 * Robust Question Traversal Engine.
 * 
 * Phase 2 Implementation:
 * - Mutation-aware readiness detection tied to the IITM assessment container.
 * - Multi-page paginator window progression and dynamic chip rediscovery.
 * - Resilient to Angular DOM replacement and stale element references.
 * - Logical question identity and duplicate prevention.
 * - Exact restoration of original question and paginator location.
 * 
 * Invariants:
 * - Traverser does NOT import or construct AssignmentDocument.
 * - Traverser does NOT depend on AssessmentExtractor.
 * - Traverser exposes question contexts via onQuestion callback.
 */

import { sleep } from "../utils/timing.js";
import {
  NavigationTimeoutError,
  NavigationMismatchError,
  PaginatorAdvanceTimeoutError,
  RestorationError,
  TraversalCancellationError,
} from "./errors.js";

const DEFAULT_TIMEOUT_MS = 3500;
const FALLBACK_POLL_INTERVAL_MS = 80;

export class QuestionTraverser {
  /**
   * @param {import("../portal/adapter.js").IitmPortalAdapter} portal
   * @param {Object} [options]
   * @param {number} [options.timeoutMs] - Default timeout for navigation & pagination
   */
  constructor(portal, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.portal = portal;
    this.defaultTimeoutMs = timeoutMs;
    this.lastRestorationError = null;
  }

  /**
   * Mutation-aware readiness detection.
   * Observes the stable assessment ancestor until the target question becomes active
   * and structurally populated, or times out deterministically.
   * Survives replacement of the question container or view component.
   * 
   * @param {number} targetNumber - Expected 1-based logical question number
   * @param {number} timeoutMs
   * @param {AbortSignal} [signal] - Optional cancellation signal
   * @returns {Promise<void>}
   */
  async waitForQuestionReady(targetNumber, timeoutMs = this.defaultTimeoutMs, signal = null) {
    if (signal?.aborted) {
      throw new TraversalCancellationError("Traversal cancelled by user");
    }

    const isReadyNow = () =>
      this.portal.getActiveLogicalNumber() === targetNumber &&
      this.portal.isQuestionStructurallyReady();

    // Fast path: already active and populated
    if (isReadyNow()) {
      return;
    }

    return new Promise((resolve, reject) => {
      let timeoutId = null;
      let observer = null;
      let pollIntervalId = null;
      let isCleanedUp = false;

      const onAbort = () => {
        cleanup();
        reject(new TraversalCancellationError("Traversal cancelled by user"));
      };

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      const cleanup = () => {
        if (isCleanedUp) return;
        isCleanedUp = true;
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
        if (observer) {
          observer.disconnect();
          observer = null;
        }
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (pollIntervalId) {
          clearInterval(pollIntervalId);
          pollIntervalId = null;
        }
      };

      const checkCondition = () => {
        if (isCleanedUp) return false;
        if (isReadyNow()) {
          cleanup();
          resolve();
          return true;
        }
        return false;
      };

      // 1. Observe the smallest stable ancestor that survives question-view replacement
      let observedTarget = this.portal.getStableAssessmentAncestor();

      const attachObserver = (target) => {
        if (!target) return;
        try {
          if (observer) observer.disconnect();
          observer = new MutationObserver(() => {
            checkCondition();
          });
          observer.observe(target, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ["class", "aria-current", "aria-selected"],
          });
          observedTarget = target;
        } catch (err) {
          console.warn("[Unfold Traverser] MutationObserver setup warning:", err);
        }
      };

      attachObserver(observedTarget);

      // Check condition once immediately after observer setup
      checkCondition();

      // 2. Bounded fallback poller for slow/synchronous edge cases and ancestor re-arming
      pollIntervalId = setInterval(() => {
        if (isCleanedUp) return;
        const currentAncestor = this.portal.getStableAssessmentAncestor();
        if (currentAncestor && currentAncestor !== observedTarget) {
          attachObserver(currentAncestor);
        }
        checkCondition();
      }, FALLBACK_POLL_INTERVAL_MS);

      // 3. Deterministic safety timeout with actionable diagnostic payload
      timeoutId = setTimeout(() => {
        if (isCleanedUp) return;
        cleanup();
        const currentActive = this.portal.getActiveLogicalNumber();
        reject(
          new NavigationTimeoutError({
            targetNumber,
            targetIndex: targetNumber - 1,
            currentNumber: currentActive,
            timeoutMs,
          })
        );
      }, timeoutMs);
    });
  }

  /**
   * Observes the paginator until the visible window identity changes.
   * Cleans up observers and timers deterministically.
   * 
   * @param {string} previousWindowId
   * @param {number} timeoutMs
   * @returns {Promise<boolean>}
   */
  async waitForWindowChange(previousWindowId, timeoutMs = this.defaultTimeoutMs) {
    const isChangedNow = () => this.portal.getPaginatorWindowIdentity() !== previousWindowId;
    if (isChangedNow()) return true;

    const paginator = this.portal.getPaginator() || this.portal.getStableAssessmentAncestor();

    return new Promise((resolve) => {
      let timeoutId = null;
      let observer = null;
      let pollIntervalId = null;
      let isCleanedUp = false;

      const cleanup = () => {
        if (isCleanedUp) return;
        isCleanedUp = true;
        if (observer) {
          observer.disconnect();
          observer = null;
        }
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (pollIntervalId) {
          clearInterval(pollIntervalId);
          pollIntervalId = null;
        }
      };

      const check = () => {
        if (isCleanedUp) return false;
        if (isChangedNow()) {
          cleanup();
          resolve(true);
          return true;
        }
        return false;
      };

      try {
        observer = new MutationObserver(() => {
          check();
        });
        observer.observe(paginator, {
          childList: true,
          subtree: true,
          characterData: true,
          attributeFilter: ["class", "disabled", "aria-disabled"],
        });
      } catch {}

      pollIntervalId = setInterval(check, FALLBACK_POLL_INTERVAL_MS);

      timeoutId = setTimeout(() => {
        if (isCleanedUp) return;
        cleanup();
        resolve(isChangedNow());
      }, timeoutMs);
    });
  }

  /**
   * Advances the paginator window and verifies that the window identity changed.
   * Throws PaginatorAdvanceTimeoutError if the control is missing, disabled, or fails to change window.
   * 
   * @param {number} timeoutMs
   * @returns {Promise<string>} Fresh window identity token
   */
  async advanceWindow(timeoutMs = this.defaultTimeoutMs) {
    const previousWindowId = this.portal.getPaginatorWindowIdentity();

    if (!this.portal.canAdvanceWindow()) {
      throw new PaginatorAdvanceTimeoutError({
        currentWindow: previousWindowId,
        reason: "Next window paginator control is unavailable or disabled",
        timeoutMs,
      });
    }

    const clicked = this.portal.advanceWindow();
    if (!clicked) {
      throw new PaginatorAdvanceTimeoutError({
        currentWindow: previousWindowId,
        reason: "Failed to trigger click on next window control",
        timeoutMs,
      });
    }

    const changed = await this.waitForWindowChange(previousWindowId, timeoutMs);
    const freshWindowId = this.portal.getPaginatorWindowIdentity();

    if (!changed || freshWindowId === previousWindowId) {
      throw new PaginatorAdvanceTimeoutError({
        currentWindow: previousWindowId,
        freshWindow: freshWindowId,
        reason: "Paginator window identity did not change after advance click",
        timeoutMs,
      });
    }

    return freshWindowId;
  }

  /**
   * Rewinds the paginator window and verifies that the window identity changed.
   * Throws PaginatorAdvanceTimeoutError if the control is missing, disabled, or fails to change window.
   * 
   * @param {number} timeoutMs
   * @returns {Promise<string>} Fresh window identity token
   */
  async rewindWindow(timeoutMs = this.defaultTimeoutMs) {
    const previousWindowId = this.portal.getPaginatorWindowIdentity();

    if (!this.portal.canRewindWindow()) {
      throw new PaginatorAdvanceTimeoutError({
        currentWindow: previousWindowId,
        reason: "Previous window paginator control is unavailable or disabled",
        timeoutMs,
      });
    }

    const clicked = this.portal.rewindWindow();
    if (!clicked) {
      throw new PaginatorAdvanceTimeoutError({
        currentWindow: previousWindowId,
        reason: "Failed to trigger click on previous window control",
        timeoutMs,
      });
    }

    const changed = await this.waitForWindowChange(previousWindowId, timeoutMs);
    const freshWindowId = this.portal.getPaginatorWindowIdentity();

    if (!changed || freshWindowId === previousWindowId) {
      throw new PaginatorAdvanceTimeoutError({
        currentWindow: previousWindowId,
        freshWindow: freshWindowId,
        reason: "Paginator window identity did not change after rewind click",
        timeoutMs,
      });
    }

    return freshWindowId;
  }

  /**
   * Navigates to a specific question chip, awaiting mutation readiness.
   * @param {HTMLButtonElement} chip
   * @param {number} logicalNumber
   * @param {number} timeoutMs
   */
  async navigateToQuestion(chip, logicalNumber, timeoutMs, signal = null) {
    if (signal?.aborted) {
      throw new TraversalCancellationError("Traversal cancelled by user");
    }
    if (this.portal.getActiveLogicalNumber() !== logicalNumber) {
      chip.click();
    }
    await this.waitForQuestionReady(logicalNumber, timeoutMs, signal);
  }

  /**
   * Restores user to their originally active question and paginator window.
   * @param {number} targetNumber
   * @param {number} timeoutMs
   */
  async restoreLocation(targetNumber, timeoutMs = this.defaultTimeoutMs) {
    try {
      if (this.portal.getActiveLogicalNumber() === targetNumber) {
        return;
      }

      // If target chip is not in current window, navigate windows to find it
      let attempts = 0;
      const maxWindowAttempts = 15;

      while (attempts++ < maxWindowAttempts) {
        const chips = this.portal.getQuestionChips();
        const matchingChip = chips.find(
          (c) => this.portal.getChipLogicalNumber(c) === targetNumber
        );

        if (matchingChip) {
          await this.navigateToQuestion(matchingChip, targetNumber, timeoutMs);
          return;
        }

        // Determine navigation direction
        const numbers = chips
          .map((c) => this.portal.getChipLogicalNumber(c))
          .filter((n) => n !== null);

        if (numbers.length === 0) {
          // If chips are unnumbered, rewind to initial window if target is 1
          if (targetNumber === 1 && this.portal.canRewindWindow()) {
            await this.rewindWindow(timeoutMs);
            continue;
          }
          if (chips[targetNumber - 1]) {
            await this.navigateToQuestion(chips[targetNumber - 1], targetNumber, timeoutMs);
            return;
          }
        }

        const minVisible = numbers.length ? Math.min(...numbers) : 1;
        const maxVisible = numbers.length ? Math.max(...numbers) : 1;

        if (targetNumber < minVisible && this.portal.canRewindWindow()) {
          await this.rewindWindow(timeoutMs);
        } else if (targetNumber > maxVisible && this.portal.canAdvanceWindow()) {
          await this.advanceWindow(timeoutMs);
        } else {
          break;
        }
      }

      // Final check
      if (this.portal.getActiveLogicalNumber() !== targetNumber) {
        throw new Error(`Target question ${targetNumber} not reachable in paginator`);
      }
    } catch (err) {
      this.lastRestorationError = new RestorationError({
        targetNumber,
        actualNumber: this.portal.getActiveLogicalNumber(),
        reason: err.message,
      });
      console.warn("[Unfold Traverser] Restoration warning:", this.lastRestorationError.message);
    }
  }

  /**
   * Traverses all questions in the assessment across all paginator windows.
   * Discovers chips dynamically and prevents duplicate captures.
   * 
   * @param {Object} options
   * @param {Function} [options.onProgress] - Callback (processedCount, totalCount)
   * @param {Function} [options.onQuestion] - Callback with QuestionContext { index, number, total, chip, isReview }
   * @param {number} [options.timeoutMs]
   * @param {AbortSignal} [options.signal] - Optional cancellation signal
   */
  async traverseAll({ onProgress = null, onQuestion = null, timeoutMs = this.defaultTimeoutMs, signal = null } = {}) {
    this.lastRestorationError = null;
    let originalLogicalNumber = 1;

    try {
      originalLogicalNumber = this.portal.getActiveLogicalNumber() || 1;

      const checkAbort = () => {
        if (signal?.aborted) {
          throw new TraversalCancellationError("Traversal cancelled by user");
        }
      };

      checkAbort();

      // 2. Discover total expected questions from header metadata
      const totalExpected = this.portal.getTotalQuestionCount();

      // 3. Logical deduplication registry
      const processedKeys = new Set();

      // 4. Rewind to initial window if assessment supports pagination and questions exist before current view
      let rewindAttempts = 0;
      while (this.portal.canRewindWindow() && rewindAttempts++ < 15) {
        checkAbort();
        try {
          await this.rewindWindow(timeoutMs);
        } catch {
          break;
        }
      }

      // 5. Main traversal loop across paginator windows
      let hasMoreWindows = true;
      let windowCycleGuard = 0;
      const seenWindowIdentities = new Set();

      while (hasMoreWindows && windowCycleGuard++ < 30) {
        checkAbort();
        const currentWindowId = this.portal.getPaginatorWindowIdentity();
        seenWindowIdentities.add(currentWindowId);

        // Always query fresh chips from live DOM — no stale button references!
        const currentChips = this.portal.getQuestionChips();

        for (let chipIdx = 0; chipIdx < currentChips.length; chipIdx++) {
          checkAbort();
          const chip = currentChips[chipIdx];
          
          // Stable logical identity determination
          const explicitNumber = this.portal.getChipLogicalNumber(chip);
          let questionKey;
          let logicalNumber;

          if (explicitNumber !== null) {
            questionKey = `num_${explicitNumber}`;
            logicalNumber = explicitNumber;
          } else {
            // Window-aware identity prevents false cross-window deduplication when chips are unnumbered
            questionKey = `win_${currentWindowId}_idx_${chipIdx}`;
            logicalNumber = processedKeys.size + 1;
          }

          if (processedKeys.has(questionKey)) {
            continue; // Skip already traversed question
          }

          const processedCount = processedKeys.size;
          if (onProgress) {
            onProgress(processedCount, totalExpected || currentChips.length);
          }

          // Navigate and await mutation-aware readiness
          await this.navigateToQuestion(chip, logicalNumber, timeoutMs, signal);
          checkAbort();

          // Verify target is confirmed active
          const verifiedActive = this.portal.getActiveLogicalNumber();
          if (verifiedActive !== null && verifiedActive !== logicalNumber) {
            throw new NavigationMismatchError({
              expected: logicalNumber,
              actual: verifiedActive,
            });
          }

          // Mark question as processed
          processedKeys.add(questionKey);

          // Invoke onQuestion callback with explicit, unambiguous context
          if (onQuestion) {
            const isReview = this.portal.isReviewMode();
            const freshActiveChip = this.portal.getActiveChip() || chip;
            const reportedTotal =
              totalExpected ||
              (hasMoreWindows ? processedKeys.size + 1 : processedKeys.size);

            await onQuestion({
              index: logicalNumber - 1, // 0-based global index
              number: logicalNumber,     // 1-based human question number
              total: totalExpected || reportedTotal,
              chip: freshActiveChip,
              isReview,
            });
          }
          checkAbort();
        }

        // Check if all expected questions have been visited
        if (totalExpected && processedKeys.size >= totalExpected) {
          hasMoreWindows = false;
          break;
        }

        checkAbort();
        // Check if there are further windows to advance
        if (this.portal.canAdvanceWindow()) {
          try {
            const nextWindowId = await this.advanceWindow(timeoutMs);
            if (seenWindowIdentities.has(nextWindowId)) {
              hasMoreWindows = false; // Looped back to an already seen window
            }
          } catch (err) {
            if (totalExpected && processedKeys.size >= totalExpected) {
              hasMoreWindows = false;
            } else {
              throw err;
            }
          }
        } else {
          hasMoreWindows = false;
        }
      }

      if (onProgress) {
        onProgress(processedKeys.size, totalExpected || processedKeys.size);
      }
    } finally {
      // 6. Guarantee restoration of original location even if traversal encountered errors or cancellation
      await this.restoreLocation(originalLogicalNumber, timeoutMs);
    }
  }
}
