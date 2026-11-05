const locks = new WeakMap();

// Las ventanas pueden desmontarse en distinto orden al que se abrieron.
export function lockModalScroll(body) {
  let state = locks.get(body);
  if (!state) {
    state = { count: 0, overflow: body.style.overflow };
    locks.set(body, state);
    body.style.overflow = 'hidden';
  }
  state.count++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--state.count === 0) {
      body.style.overflow = state.overflow;
      locks.delete(body);
    }
  };
}
