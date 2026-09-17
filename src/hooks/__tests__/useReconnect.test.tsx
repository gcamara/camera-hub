import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useReconnect, type ReconnectState } from '../useReconnect';

function Probe({ enabled, onState }: { enabled: boolean; onState: (state: ReconnectState) => void }) {
  onState(useReconnect(enabled));
  return null;
}

/** Renders the hook and returns a way to read its latest state and re-render it. */
function mount(enabled: boolean) {
  let latest!: ReconnectState;
  let renderer!: ReactTestRenderer;
  const onState = (state: ReconnectState) => {
    latest = state;
  };
  act(() => {
    renderer = create(<Probe enabled={enabled} onState={onState} />);
  });
  return {
    get state() {
      return latest;
    },
    setEnabled(next: boolean) {
      act(() => renderer.update(<Probe enabled={next} onState={onState} />));
    },
  };
}

describe('useReconnect', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('starts with a single attempt', () => {
    const hook = mount(true);
    expect(hook.state.attempt).toBe(0);
    expect(hook.state.status).toBe('connecting');
  });

  it('keeps the same attempt when re-enabled, so the remount is the only new player', () => {
    const hook = mount(true);
    hook.setEnabled(false);
    expect(hook.state.status).toBe('stopped');

    hook.setEnabled(true);
    expect(hook.state.attempt).toBe(0);
    expect(hook.state.status).toBe('connecting');
    expect(hook.state.retryIn).toBeNull();
  });

  it('backs off after an error and bumps the attempt when the timer fires', () => {
    const hook = mount(true);
    act(() => hook.state.handleStatus('error', 'No video'));
    expect(hook.state.status).toBe('error');
    expect(hook.state.retryIn).toBe(3);
    expect(hook.state.attempt).toBe(0);

    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(hook.state.attempt).toBe(1);
    expect(hook.state.retryIn).toBeNull();
    expect(hook.state.status).toBe('connecting');

    act(() => hook.state.handleStatus('error', 'No video'));
    expect(hook.state.retryIn).toBe(6);
  });

  it('forgets the back-off once live and when re-enabled', () => {
    const hook = mount(true);
    act(() => hook.state.handleStatus('error'));
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    act(() => hook.state.handleStatus('live'));
    act(() => hook.state.handleStatus('error'));
    expect(hook.state.retryIn).toBe(3);

    hook.setEnabled(false);
    expect(hook.state.retryIn).toBeNull();
    hook.setEnabled(true);
    act(() => hook.state.handleStatus('error'));
    expect(hook.state.retryIn).toBe(3);
  });

  it('does not schedule a retry while disabled', () => {
    const hook = mount(false);
    act(() => hook.state.handleStatus('error'));
    expect(hook.state.retryIn).toBeNull();
    act(() => {
      jest.advanceTimersByTime(30000);
    });
    expect(hook.state.attempt).toBe(0);
  });
});
