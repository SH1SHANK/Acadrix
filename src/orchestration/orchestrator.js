/**
 * Export Orchestrator.
 * 
 * Central coordinator for Unfold export sessions.
 * Manages session creation, concurrency guards (preventing overlapping runs),
 * document reuse, and lifecycle delegation.
 */

import { ExportState, DoubleExportError } from "./types.js";
import { ExportSession } from "./session.js";

export class ExportOrchestrator {
  /**
   * @param {Object} [runtime] - Optional UnfoldRuntime instance
   */
  constructor(runtime = null) {
    this.runtime = runtime;
    this.activeSession = null;
  }

  /**
   * Checks whether an export session is currently in flight.
   * @returns {boolean}
   */
  isBusy() {
    if (!this.activeSession) return false;
    const s = this.activeSession.state;
    return (
      s === ExportState.EXTRACTING ||
      s === ExportState.RESOLVING_RESOURCES ||
      s === ExportState.RENDERING
    );
  }

  /**
   * Creates a new managed ExportSession, enforcing single-concurrency guard.
   * 
   * @param {Object} [options]
   * @returns {ExportSession}
   */
  createSession(options = {}) {
    if (this.isBusy()) {
      throw new DoubleExportError("An export session is already in progress. Please wait or cancel it first.");
    }

    const session = new ExportSession({
      runtime: this.runtime,
      traverser: options.traverser || this.runtime?.traverser,
      extractor: options.extractor || this.runtime?.extractor,
      document: options.document || this.runtime?.activeDocument,
      options,
    });

    this.activeSession = session;
    return session;
  }

  /**
   * Executes an end-to-end export workflow.
   * 
   * @param {Object} request
   * @returns {Promise<Object>}
   */
  export(request = {}) {
    const session = this.createSession(request);
    return session.run(request);
  }

  /**
   * Cancels any active export session.
   */
  cancel() {
    if (this.activeSession) {
      this.activeSession.abort();
    }
  }

  /**
   * Clears the cached AssignmentDocument on the runtime, forcing re-extraction on next export.
   */
  invalidateDocument() {
    if (this.runtime) {
      if (typeof this.runtime.invalidateDocument === "function") {
        this.runtime.invalidateDocument();
      } else {
        this.runtime.activeDocument = null;
      }
    }
  }

  /**
   * Returns currently cached canonical document, if any.
   * @returns {Object|null}
   */
  getActiveDocument() {
    return this.runtime?.activeDocument || null;
  }
}

/**
 * Functional entry point for standalone or scripted export execution.
 * @param {Object} params
 * @returns {Promise<Object>}
 */
export async function exportAssignment(params = {}) {
  const orchestrator = new ExportOrchestrator(params.runtime || null);
  return orchestrator.export(params);
}
