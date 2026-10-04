/**
 * Runtime Lifecycle State Machine.
 * Manages explicit lifecycle states and transitions.
 */

export const LifecycleState = Object.freeze({
  UNINITIALIZED: "uninitialized",
  IDLE: "idle",
  ACTIVE: "active",
  TRAVERSING: "traversing",
  OPEN: "open",
  DESTROYED: "destroyed",
});

export class Lifecycle {
  constructor() {
    this.state = LifecycleState.UNINITIALIZED;
    this.listeners = new Set();
  }

  transition(nextState) {
    const prevState = this.state;
    this.state = nextState;
    this.listeners.forEach((fn) => {
      try {
        fn(nextState, prevState);
      } catch (err) {
        console.warn("[Acadrix Lifecycle] Listener error:", err);
      }
    });
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  is(state) {
    return this.state === state;
  }
}
