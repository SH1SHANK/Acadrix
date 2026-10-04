/**
 * Traversal Error Hierarchy.
 * Provides structured diagnostic information for navigation, pagination, and readiness failures.
 */

export class TraversalError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "TraversalError";
    this.details = details;
  }
}

export class NavigationTimeoutError extends TraversalError {
  constructor({ targetNumber, targetIndex, currentNumber, timeoutMs }) {
    const msg = `Question ${targetNumber} failed to become ready within ${timeoutMs}ms (expected index: ${targetIndex}, current active number: ${currentNumber ?? "unknown"}).`;
    super(msg, { targetNumber, targetIndex, currentNumber, timeoutMs });
    this.name = "NavigationTimeoutError";
  }
}

export class NavigationMismatchError extends TraversalError {
  constructor({ expected, actual }) {
    const msg = `Navigation mismatch: expected active question ${expected}, but portal resolved to ${actual}.`;
    super(msg, { expected, actual });
    this.name = "NavigationMismatchError";
  }
}

export class PaginatorAdvanceTimeoutError extends TraversalError {
  constructor({ previousWindowId, currentWindow, newWindow, freshWindow, reason, timeoutMs }) {
    const fromWin = previousWindowId ?? currentWindow ?? "unknown";
    const reasonText = reason ? `: ${reason}` : "";
    const msg = `Paginator window failed to advance from "${fromWin}" within ${timeoutMs}ms${reasonText}.`;
    super(msg, {
      previousWindowId: fromWin,
      currentWindow: fromWin,
      newWindow: newWindow ?? freshWindow,
      reason,
      timeoutMs,
    });
    this.name = "PaginatorAdvanceTimeoutError";
  }
}

export class RestorationError extends TraversalError {
  constructor({ targetNumber, actualNumber, reason }) {
    const msg = `Failed to restore original question location (${targetNumber}). Currently at ${actualNumber ?? "unknown"}: ${reason}`;
    super(msg, { targetNumber, actualNumber, reason });
    this.name = "RestorationError";
  }
}

export class TraversalCancellationError extends TraversalError {
  constructor(message = "Traversal cancelled by user") {
    super(message);
    this.name = "TraversalCancellationError";
  }
}
