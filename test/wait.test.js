const Sfn = require('../lib/stepfunctions');

// The Wait tests use jest fake timers. They live in their own file so the
// timer globals are sandboxed by jest's per-file environment and cannot leak
// into the rest of the suite (some Node releases don't cleanly restore the
// global timers via `useRealTimers()`). A fresh `useFakeTimers()` per test
// resets the clock; a fixed system time (after the past Timestamp in wait.json)
// lets the Timestamp branch resolve once we advance past the target time.
describe('Wait', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2020-06-01T00:00:00Z'));
  });

  it('can wait for 1 second', async () => {
    const sm = new Sfn({ StateMachine: require('./steps/wait.json') });
    const mockFn = jest.fn();
    sm.bindTaskResource('Final', mockFn);
    const execution = sm.startExecution({ value: 'Wait' });
    await jest.advanceTimersByTimeAsync(1000);
    await execution;
    expect(mockFn).toHaveBeenCalled();
  });

  it('can wait for 1 second using SecondsPath', async () => {
    const sm = new Sfn({ StateMachine: require('./steps/wait.json') });
    const mockFn = jest.fn();
    sm.bindTaskResource('Final', mockFn);
    const execution = sm.startExecution({ value: 'WaitPath', until: 1 });
    await jest.advanceTimersByTimeAsync(1000);
    await execution;
    expect(mockFn).toHaveBeenCalled();
  });

  it('can wait until a specified time', async () => {
    const sm = new Sfn({ StateMachine: require('./steps/wait.json') });
    const mockFn = jest.fn();
    sm.bindTaskResource('Final', mockFn);
    const execution = sm.startExecution({ value: 'WaitUntil' });
    // wait.json's Timestamp is in the past, so the first interval tick fires
    await jest.advanceTimersByTimeAsync(500);
    await execution;
    expect(mockFn).toHaveBeenCalled();
  });

  it('can wait until a specified time using TimestampPath', async () => {
    const sm = new Sfn({ StateMachine: require('./steps/wait.json') });
    const mockFn = jest.fn();
    sm.bindTaskResource('Final', mockFn);
    const until = new Date('2020-06-01T00:00:01Z').getTime(); // 1s ahead
    const execution = sm.startExecution({ value: 'WaitUntilPath', until });
    await jest.advanceTimersByTimeAsync(1000);
    await execution;
    expect(mockFn).toHaveBeenCalled();
  });

  it.skip('can abort a running statemachine', () => {});

  it.skip('can expect a timeout when a wait step is running for a long time', () => {});
});
