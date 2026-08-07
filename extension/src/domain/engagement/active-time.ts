/**
 * Pure active-time accumulator: only counts while the tab is visible and the
 * document is focused (handoff §9 — hidden / unfocused time does not count).
 */

export type ActiveTimeState = {
  /** Accumulated active milliseconds. */
  activeMs: number;
  visible: boolean;
  focused: boolean;
  /** Wall-clock ms when the current active segment started; null if idle. */
  segmentStartedAt: number | null;
};

export function createActiveTimeState(
  now = 0,
  visible = true,
  focused = true,
): ActiveTimeState {
  const counting = visible && focused;
  return {
    activeMs: 0,
    visible,
    focused,
    segmentStartedAt: counting ? now : null,
  };
}

function isCounting(state: ActiveTimeState): boolean {
  return state.visible && state.focused;
}

function closeSegment(state: ActiveTimeState, now: number): ActiveTimeState {
  if (state.segmentStartedAt === null) {
    return state;
  }
  const delta = Math.max(0, now - state.segmentStartedAt);
  return {
    ...state,
    activeMs: state.activeMs + delta,
    segmentStartedAt: null,
  };
}

function openSegment(state: ActiveTimeState, now: number): ActiveTimeState {
  if (state.segmentStartedAt !== null || !isCounting(state)) {
    return state;
  }
  return { ...state, segmentStartedAt: now };
}

/** Flush the open segment into `activeMs` without changing visibility/focus. */
export function flushActiveTime(state: ActiveTimeState, now: number): ActiveTimeState {
  if (state.segmentStartedAt === null) {
    return state;
  }
  const closed = closeSegment(state, now);
  return isCounting(closed) ? openSegment(closed, now) : closed;
}

export function setVisibility(
  state: ActiveTimeState,
  visible: boolean,
  now: number,
): ActiveTimeState {
  const closed = closeSegment(state, now);
  const next = { ...closed, visible };
  return openSegment(next, now);
}

export function setFocused(
  state: ActiveTimeState,
  focused: boolean,
  now: number,
): ActiveTimeState {
  const closed = closeSegment(state, now);
  const next = { ...closed, focused };
  return openSegment(next, now);
}

export function readActiveMs(state: ActiveTimeState, now: number): number {
  return flushActiveTime(state, now).activeMs;
}
