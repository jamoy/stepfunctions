const Sfn = require('../lib/stepfunctions');

describe('Stepfunctions', () => {
  it('validates states definition via asl-validator', async () => {
    expect(() => new Sfn({ StateMachine: { willThrow: true } })).toThrow(
      /required property 'StartAt'/,
    );
  });

  it('can run a simple task with a mock', async () => {
    const sm = new Sfn({ StateMachine: require('./steps/simple.json') });
    const mockfn = jest.fn((input) => input.test === 1);
    sm.bindTaskResource('Test', mockfn);
    await sm.startExecution({ test: 1 });
    expect(mockfn).toHaveBeenCalled();
    expect(sm.getExecutionResult()).toBe(true);
  });

  it('can run a simple task with a spy', async () => {
    const sm = new Sfn({ StateMachine: require('./steps/simple.json') });
    const spy = jest.spyOn(sm, 'step');
    await sm.startExecution({ test: 1 });
    expect(spy).toHaveBeenCalled();
  });

  it('can run a simple task and get the result', async () => {
    const sm = new Sfn({ StateMachine: require('./steps/simple.json') });
    const mockfn = jest.fn((input) => input.test !== 1);
    sm.bindTaskResource('Test', mockfn);
    await sm.startExecution({ test: 1 });
    expect(sm.getExecutionResult()).toBe(false);
  });

  it('can modify input with InputPath and Parameters', async () => {
    const sm = new Sfn({ StateMachine: require('./steps/input.json') });
    const mockfn = jest.fn((input) => ({
      comment: 'Example for Parameters.',
      product: {
        details: {
          color: 'blue',
          size: 'small',
          material: 'cotton',
        },
        availability: 'in stock',
        sku: '2317',
        cost: input,
      },
    }));
    const mock2fn = jest.fn((input) => input);
    sm.bindTaskResource('Test', mockfn);
    sm.bindTaskResource('Test2', mock2fn);
    await sm.startExecution({ value: '$23' });
    expect(mockfn).toHaveBeenCalled();
    expect(sm.getExecutionResult()).toEqual(
      expect.objectContaining({
        MyDetails: {
          size: 'small',
          exists: 'in stock',
          StaticValue: 'foo',
        },
      }),
    );
  });

  it('can modify input with Context', async () => {
    const sm = new Sfn({ StateMachine: require('./steps/context.json') });
    const mockfn = jest.fn((input) => input);
    sm.bindTaskResource('Test', mockfn);
    await sm.startExecution({ value: 'test' });
    expect(mockfn).toHaveBeenCalled();
    expect(sm.getExecutionResult()).toEqual(
      expect.objectContaining({
        MyDetails: {
          Execution: expect.any(String),
          Retries: expect.any(Number),
          Name: expect.any(String),
        },
      }),
    );
  });

  it('can modify output with ResultPath and OutputPath', async () => {
    const sm = new Sfn({ StateMachine: require('./steps/output.json') });
    const mockfn = jest.fn((input) => 'Hello, ' + input.who + '!');
    sm.bindTaskResource('Test', mockfn);
    await sm.startExecution({
      comment: 'An input comment.',
      data: {
        val1: 23,
        val2: 17,
      },
      extra: 'foo',
      lambda: {
        who: 'AWS Step Functions',
      },
    });
    expect(mockfn).toHaveBeenCalled();
    expect(sm.getExecutionResult()).toEqual(
      expect.objectContaining({
        val1: 23,
        val2: 17,
        lambdaresult: 'Hello, AWS Step Functions!',
      }),
    );
  });

  describe('Task', () => {
    it('can run a bound task', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/task.json') });
      const mockfn = jest.fn((input) => input.test === 1);
      sm.bindTaskResource('Test', mockfn);
      await sm.startExecution({ test: 1 });
      expect(mockfn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toBe(true);
    });

    it('can run if there are no bound task', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/task.json') });
      await sm.startExecution({ test: 1 });
      expect(sm.getExecutionResult()).toEqual(
        expect.objectContaining({ test: 1 }),
      );
    });

    it('can bind multiple tasks', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/tasks.json') });
      const mockfn = jest.fn((input) => ({ test: input.test + 1 }));
      const mockfn1 = jest.fn((input) => ({ test: input.test + 2 }));
      const mockfn2 = jest.fn((input) => input.test + 3);
      sm.bindTaskResource('Test', mockfn);
      sm.bindTaskResource('Test1', mockfn1);
      sm.bindTaskResource('Test2', mockfn2);
      await sm.startExecution({ test: 1 });
      expect(mockfn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toBe(7);
    });
  });

  describe('Map', () => {
    it('starts with a simple Map', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/map.json') });
      const mockfn = jest.fn((input) => input);
      const mockMapfn = jest.fn((input) => ({ test: input.test + 1 }));
      sm.bindTaskResource('Test', mockfn);
      sm.bindTaskResource('Mapper', mockMapfn);
      await sm.startExecution([{ test: 1 }, { test: 2 }]);
      expect(mockfn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.arrayContaining([{ test: 2 }]),
      );
      expect(sm.getExecutionResult()).toEqual(
        expect.arrayContaining([{ test: 3 }]),
      );
    });

    it('aggregates from a Task to a Map', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/map-task.json') });
      const mockfn = jest.fn((input) => input);
      const mockMapfn = jest.fn((input) => ({ test: input.test + 1 }));
      sm.bindTaskResource('Mapper', mockMapfn);
      sm.bindTaskResource('Test', mockfn);
      await sm.startExecution([{ test: 1 }, { test: 2 }]);
      expect(mockfn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.arrayContaining([{ test: 2 }]),
      );
      expect(sm.getExecutionResult()).toEqual(
        expect.arrayContaining([{ test: 3 }]),
      );
    });

    it('supports nested Map', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/map-nested.json') });
      const mockfn = jest.fn((input) => input);
      const mockMapfn = jest.fn((input) => [
        { test: input.test + 1 },
        { test: input.test + 2 },
      ]);
      const mockMapdfn = jest.fn((input) => ({ test: input.test + 1 }));
      const mockLastfn = jest.fn((input) => input);
      sm.bindTaskResource('Test', mockfn);
      sm.bindTaskResource('Mapper', mockMapfn);
      sm.bindTaskResource('Mapped', mockMapdfn);
      sm.bindTaskResource('Last', mockLastfn);
      await sm.startExecution([{ test: 1 }, { test: 2 }]);
      expect(mockfn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.arrayContaining([[{ test: 3 }, { test: 4 }]]),
      );
      expect(sm.getExecutionResult()).toEqual(
        expect.arrayContaining([[{ test: 4 }, { test: 5 }]]),
      );
    });

    it('supports ItemsPath', async () => {
      const definition = require('./steps/map.json');
      definition.States.Map.ItemsPath = '$.items';
      const sm = new Sfn({ StateMachine: definition });
      const mockfn = jest.fn((input) => input);
      const mockMapfn = jest.fn((input) => ({ test: input.test + 1 }));
      sm.bindTaskResource('Test', mockfn);
      sm.bindTaskResource('Mapper', mockMapfn);
      await sm.startExecution({ items: [{ test: 1 }, { test: 2 }] });
      expect(mockfn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.arrayContaining([{ test: 2 }]),
      );
      expect(sm.getExecutionResult()).toEqual(
        expect.arrayContaining([{ test: 3 }]),
      );
    });

    it('can modify input with Context within Map', async () => {
      const definition = require('./steps/map-context.json');
      const sm = new Sfn({ StateMachine: definition });
      const mockfn = jest.fn((input) => input);
      const mockMapfn = jest.fn((input) => input);
      sm.bindTaskResource('Test', mockfn);
      sm.bindTaskResource('Mapper', mockMapfn);
      await sm.startExecution([{ who: 'bob' }, { who: 'meg' }, { who: 'joe' }]);
      expect(mockfn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.arrayContaining([
          { ContextIndex: 1, ContextValue: { who: 'meg' } },
        ]),
      );
    });

    it.skip('can run sequential tasks while limiting concurrency using MaxConcurrency', async () => {});
  });

  describe('Parallel', () => {
    it('can run multiple tasks at once', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/parallel.json') });
      const mock1Fn = jest.fn((input) => input[0] + input[1]);
      const mock2Fn = jest.fn((input) => input[0] - input[1]);
      sm.bindTaskResource('ParallelTask1', mock1Fn);
      sm.bindTaskResource('ParallelTask2', mock2Fn);
      await sm.startExecution([1, 1]);
      expect(mock1Fn).toHaveBeenCalled();
      expect(mock2Fn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(expect.arrayContaining([2, 0]));
    });

    it('can run nested parallels', async () => {
      const sm = new Sfn({
        StateMachine: require('./steps/parallel-nested.json'),
      });
      const mock1Fn = jest.fn((input) => input[0] + input[1]);
      const mock2Fn = jest.fn((input) => input[0] + input[1]);
      const mock3Fn = jest.fn((input) => input + 1);
      const mock4Fn = jest.fn((input) => input + 2);
      sm.bindTaskResource('ParallelTask1', mock1Fn);
      sm.bindTaskResource('ParallelTask2', mock2Fn);
      sm.bindTaskResource('ParallelTask3', mock3Fn);
      sm.bindTaskResource('ParallelTask4', mock4Fn);
      await sm.startExecution([1, 1]);
      expect(mock1Fn).toHaveBeenCalled();
      expect(mock2Fn).toHaveBeenCalled();
      expect(mock3Fn).toHaveBeenCalled();
      expect(mock4Fn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.arrayContaining([[3, 4], 2]),
      );
    });

    it.skip('can run multiple tasks and aggregate the results into ResultPath', async () => {});

    it.skip('can run multiple tasks that respects maxConcurrency', async () => {});
  });

  describe('Pass', () => {
    it('can continue to another task via Pass', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/pass.json') });
      const mockFn = jest.fn();
      sm.on('PassStateEntered', mockFn);
      await sm.startExecution();
      expect(mockFn).toHaveBeenCalled();
    });
  });

  describe('Fail', () => {
    it('throws a full stop and an error when a fail state is encountered', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/fail.json') });
      const mockFn = jest.fn();
      sm.on('FailStateEntered', mockFn);
      await expect(sm.startExecution()).rejects.toThrow(/TaskFailed/);
      expect(mockFn).toHaveBeenCalled();
    });
  });

  describe('Succeed', () => {
    it('stops the statemachine after receiving a succeeding option', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/succeed.json') });
      const succeedingFn = jest.fn(() => ({ value: 0 }));
      const mockFn = jest.fn();
      sm.bindTaskResource('Test', succeedingFn);
      sm.on('SucceedStateEntered', mockFn);
      await sm.startExecution();
      expect(mockFn).toHaveBeenCalled();
      expect(succeedingFn).toHaveBeenCalled();
    });

    it('fails the statemachine after receiving a failing option', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/succeed.json') });
      const succeedingFn = jest.fn(() => ({ value: 1 }));
      const mockFn = jest.fn();
      sm.bindTaskResource('Test', succeedingFn);
      sm.on('FailStateEntered', mockFn);
      await expect(sm.startExecution()).rejects.toThrow(/TaskFailed/);
      expect(mockFn).toHaveBeenCalled();
      expect(succeedingFn).toHaveBeenCalled();
    });
  });

  describe('Wait', () => {
    // Fake timers keep these instant and deterministic instead of really
    // sleeping. A fixed clock (after the past Timestamp in wait.json) lets the
    // Timestamp branch resolve once we advance past the target time.
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2020-06-01T00:00:00Z'));
    });
    afterEach(() => {
      jest.useRealTimers();
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

  describe('Choice', () => {
    it('can test against boolean', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/choice.json') });
      const mockFn = jest.fn((input) => input);
      sm.bindTaskResource('Test', mockFn);
      await sm.startExecution({ param1: true });
      expect(mockFn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.objectContaining({ param1: true }),
      );
    });

    it('can test equality against numbers', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/choice.json') });
      const mockFn = jest.fn((input) => input);
      sm.bindTaskResource('Test', mockFn);
      await sm.startExecution({ param1: 0 });
      expect(mockFn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.objectContaining({ param1: 0 }),
      );
    });

    it('can test equality against strings', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/choice.json') });
      const mockFn = jest.fn((input) => input);
      sm.bindTaskResource('Test', mockFn);
      await sm.startExecution({ param1: 'test' });
      expect(mockFn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.objectContaining({ param1: 'test' }),
      );
    });

    it('can test equality against timestamps', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/choice.json') });
      const mockFn = jest.fn((input) => input);
      sm.bindTaskResource('Test', mockFn);
      await sm.startExecution({ param1: '2001-01-01T12:00:00Z' });
      expect(mockFn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.objectContaining({ param1: '2001-01-01T12:00:00Z' }),
      );
    });

    it('can test greater than against numbers', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/choice.json') });
      const mockFn = jest.fn((input) => input);
      sm.bindTaskResource('Test', mockFn);
      await sm.startExecution({ param1: 1 });
      expect(mockFn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.objectContaining({ param1: 1 }),
      );
    });

    it('can test greater than against strings', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/choice.json') });
      const mockFn = jest.fn((input) => input);
      sm.bindTaskResource('Test', mockFn);
      await sm.startExecution({ param4: 'tester' });
      expect(mockFn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.objectContaining({ param4: 'tester' }),
      );
    });

    it('can test greater than against timestamps', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/choice.json') });
      const mockFn = jest.fn((input) => input);
      sm.bindTaskResource('Test', mockFn);
      await sm.startExecution({ param1: '2001-02-01T12:00:00Z' });
      expect(mockFn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.objectContaining({ param1: '2001-02-01T12:00:00Z' }),
      );
    });

    it('can test greater than equals against numbers', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/choice.json') });
      const mockFn = jest.fn((input) => input);
      sm.bindTaskResource('Test', mockFn);
      await sm.startExecution({ param1: 10 });
      expect(mockFn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.objectContaining({ param1: 10 }),
      );
      await sm.startExecution({ param1: 11 });
      expect(mockFn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.objectContaining({ param1: 11 }),
      );
    });

    it('can test greater than equals against strings', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/choice.json') });
      const mockFn = jest.fn((input) => input);
      sm.bindTaskResource('Test', mockFn);
      await sm.startExecution({ param1: 'tester' });
      expect(mockFn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.objectContaining({ param1: 'tester' }),
      );
      await sm.startExecution({ param1: 'testers' });
      expect(mockFn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.objectContaining({ param1: 'testers' }),
      );
    });

    it('can test greater than equals against timestamps', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/choice.json') });
      const mockFn = jest.fn((input) => input);
      sm.bindTaskResource('Test', mockFn);
      await sm.startExecution({ param1: '2001-02-01T12:00:00Z' });
      expect(mockFn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.objectContaining({ param1: '2001-02-01T12:00:00Z' }),
      );
      await sm.startExecution({ param1: '2001-02-02T12:00:00Z' });
      expect(mockFn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.objectContaining({ param1: '2001-02-02T12:00:00Z' }),
      );
    });

    it('can test less than against numbers', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/choice.json') });
      const mockFn = jest.fn((input) => input);
      sm.bindTaskResource('Test', mockFn);
      await sm.startExecution({ param3: -1 });
      expect(mockFn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.objectContaining({ param3: -1 }),
      );
    });

    it('can test less than against strings', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/choice.json') });
      const mockFn = jest.fn((input) => input);
      sm.bindTaskResource('Test', mockFn);
      await sm.startExecution({ param3: 'tes' });
      expect(mockFn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.objectContaining({ param3: 'tes' }),
      );
    });

    it('can test less than against timestamps', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/choice.json') });
      const mockFn = jest.fn((input) => input);
      sm.bindTaskResource('Test', mockFn);
      await sm.startExecution({ param3: '2001-01-01T11:00:00Z' });
      expect(mockFn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.objectContaining({ param3: '2001-01-01T11:00:00Z' }),
      );
    });

    it('can test less than equals against numbers', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/choice.json') });
      const mockFn = jest.fn((input) => input);
      sm.bindTaskResource('Test', mockFn);
      await sm.startExecution({ param2: 9 });
      expect(mockFn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.objectContaining({ param2: 9 }),
      );
      await sm.startExecution({ param2: 10 });
      expect(mockFn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.objectContaining({ param2: 10 }),
      );
    });

    it('can test less than equals against strings', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/choice.json') });
      const mockFn = jest.fn((input) => input);
      sm.bindTaskResource('Test', mockFn);
      await sm.startExecution({ param2: 'tes' });
      expect(mockFn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.objectContaining({ param2: 'tes' }),
      );
      await sm.startExecution({ param2: 'test' });
      expect(mockFn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.objectContaining({ param2: 'test' }),
      );
    });

    it('can test less than equals against timestamps', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/choice.json') });
      const mockFn = jest.fn((input) => input);
      sm.bindTaskResource('Test', mockFn);
      await sm.startExecution({ param2: '2001-02-01T12:00:00Z' });
      expect(mockFn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.objectContaining({ param2: '2001-02-01T12:00:00Z' }),
      );
      await sm.startExecution({ param2: '2001-02-01T11:00:00Z' });
      expect(mockFn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.objectContaining({ param2: '2001-02-01T11:00:00Z' }),
      );
    });

    it('can test a simple AND comparison', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/choice.json') });
      const mockFn = jest.fn((input) => input);
      sm.bindTaskResource('Test', mockFn);
      await sm.startExecution({ param1: 1, param2: 'test' });
      expect(mockFn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.objectContaining({ param1: 1, param2: 'test' }),
      );
    });

    it('can test a simple OR comparison', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/choice.json') });
      const mockFn = jest.fn((input) => input);
      sm.bindTaskResource('Test', mockFn);
      await sm.startExecution({ param2: 1, param3: 'test' });
      expect(mockFn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.objectContaining({ param2: 1, param3: 'test' }),
      );
    });

    it('can test a simple NOT comparison', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/choice.json') });
      const mockFn = jest.fn((input) => input);
      sm.bindTaskResource('Test', mockFn);
      await sm.startExecution({ param4: 1 });
      expect(mockFn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.objectContaining({ param4: 1 }),
      );
    });

    it('can test a complex AND/OR/NOT comparison', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/choice.json') });
      const mockFn = jest.fn((input) => input);
      sm.bindTaskResource('Test', mockFn);
      await sm.startExecution({
        param5: 15,
        param6: 'test',
        param7: 0,
        param8: '2001-01-01T12:00:00Z',
      });
      expect(mockFn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.objectContaining({
          param5: 15,
          param6: 'test',
          param7: 0,
          param8: '2001-01-01T12:00:00Z',
        }),
      );
    });
  });

  it('can catch custom errors', async () => {
    const sm = new Sfn({ StateMachine: require('./steps/catch.json') });
    const firstFn = jest.fn(() => {
      class CustomError extends Error {
        // empty
      }
      throw new CustomError('something happened');
    });
    const errorFn = jest.fn((input) => input);
    const lastFn = jest.fn((input) => {
      return input;
    });
    sm.bindTaskResource('First', firstFn);
    sm.bindTaskResource('All', errorFn);
    sm.bindTaskResource('Last', lastFn);
    await sm.startExecution({});
    expect(errorFn).toHaveBeenCalled();
    expect(lastFn).toHaveBeenCalled();
    expect(sm.getExecutionResult()).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          Cause: expect.objectContaining({ errorType: 'CustomError' }),
        }),
      }),
    );
  });

  it('can catch custom States.ALL', async () => {
    const sm = new Sfn({ StateMachine: require('./steps/catch-all.json') });
    const firstFn = jest.fn(() => {
      class Custom2Error extends Error {
        // empty
      }
      throw new Custom2Error('something happened');
    });
    const errorFn = jest.fn((input) => input);
    const lastFn = jest.fn((input) => {
      return input;
    });
    sm.bindTaskResource('First', firstFn);
    sm.bindTaskResource('All', errorFn);
    sm.bindTaskResource('Last', lastFn);
    await sm.startExecution({});
    expect(errorFn).toHaveBeenCalled();
    expect(lastFn).toHaveBeenCalled();
    expect(sm.getExecutionResult()).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          Cause: expect.objectContaining({ errorType: 'States.ALL' }),
        }),
      }),
    );
  });

  it('can catch custom States.TaskFailed', async () => {
    const sm = new Sfn({ StateMachine: require('./steps/catch.json') });
    const firstFn = jest.fn(() => {
      throw new Error('fail the task');
    });
    const errorFn = jest.fn((input) => input);
    const lastFn = jest.fn((input) => {
      return input;
    });
    sm.bindTaskResource('First', firstFn);
    sm.bindTaskResource('All', errorFn);
    sm.bindTaskResource('Last', lastFn);
    await sm.startExecution({});
    expect(errorFn).toHaveBeenCalled();
    expect(lastFn).toHaveBeenCalled();
    expect(sm.getExecutionResult()).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          Cause: expect.objectContaining({ errorType: 'States.TaskFailed' }),
        }),
      }),
    );
  });

  it('can retry failing tasks', async () => {
    const sm = new Sfn({ StateMachine: require('./steps/retry.json') });
    const firstFn = jest.fn((input) => {
      if (input.retries === 2) {
        return input;
      }
      class CustomError extends Error {
        // empty
      }
      throw new CustomError('something happened');
    });
    const errorFn = jest.fn((input) => input);
    const lastFn = jest.fn((input) => {
      return input;
    });
    sm.bindTaskResource('First', firstFn);
    sm.bindTaskResource('All', errorFn);
    sm.bindTaskResource('Last', lastFn);
    await sm.startExecution({});
    expect(firstFn).toHaveBeenCalled();
    expect(errorFn).not.toHaveBeenCalled();
    expect(lastFn).toHaveBeenCalled();
    expect(sm.getExecutionResult()).toEqual(
      expect.objectContaining({ retries: 2 }),
    );
  }, 8000);

  it('can retry failing tasks and maintain the same transformed input', async () => {
    const sm = new Sfn({
      StateMachine: require('./steps/retry-transform-input.json'),
    });
    const args = { bar: 'baz' };
    const firstFn = jest.fn((input) => {
      const { retries, foo } = input;
      expect(foo).toEqual(args);
      if (retries === 3) {
        return input;
      }
      class CustomError extends Error {
        // empty
      }
      throw new CustomError('something happened');
    });
    const errorFn = jest.fn((input) => input);
    const lastFn = jest.fn((input) => {
      return input;
    });
    sm.bindTaskResource('First', firstFn);
    sm.bindTaskResource('All', errorFn);
    sm.bindTaskResource('Last', lastFn);
    await sm.startExecution(args);
    expect(firstFn).toHaveBeenCalled();
    expect(errorFn).not.toHaveBeenCalled();
    expect(lastFn).toHaveBeenCalled();
    expect(sm.getExecutionResult()).toEqual(
      expect.objectContaining({ retries: 3, foo: args }),
    );
  }, 8000);

  it('can retry failing tasks and finally catch', async () => {
    const sm = new Sfn({ StateMachine: require('./steps/retry.json') });
    const firstFn = jest.fn(() => {
      class CustomError extends Error {
        // empty
      }
      throw new CustomError('something happened');
    });
    const errorFn = jest.fn((input) => input);
    const lastFn = jest.fn((input) => {
      return input;
    });
    sm.bindTaskResource('First', firstFn);
    sm.bindTaskResource('All', errorFn);
    sm.bindTaskResource('Last', lastFn);
    await sm.startExecution({});
    expect(firstFn).toHaveBeenCalled();
    expect(errorFn).toHaveBeenCalled();
    expect(lastFn).toHaveBeenCalled();
    expect(sm.getExecutionResult()).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          Cause: expect.objectContaining({ errorType: 'CustomError' }),
        }),
      }),
    );
  });

  describe('Choice (newer operators)', () => {
    const run = async (input) => {
      const sm = new Sfn({ StateMachine: require('./steps/choice-new.json') });
      const mockFn = jest.fn((value) => value);
      sm.bindTaskResource('Test', mockFn);
      await sm.startExecution(input);
      return mockFn;
    };

    it('matches with StringMatches wildcards', async () => {
      expect(await run({ matchStr: 'foobar.log' })).toHaveBeenCalled();
      expect(await run({ matchStr: 'foo.log' })).toHaveBeenCalled();
    });

    it('anchors StringMatches at both ends and is case-sensitive', async () => {
      // `*` spans any run of characters, including a literal dot
      expect(await run({ matchStr: 'foo.log.log' })).toHaveBeenCalled();
      const fail = async (matchStr) => {
        const sm = new Sfn({
          StateMachine: require('./steps/choice-new.json'),
        });
        await expect(sm.startExecution({ matchStr })).rejects.toThrow(
          /TaskFailed/,
        );
      };
      await fail('xfoo.log'); // must start with foo
      await fail('foo.LOG'); // case-sensitive suffix
    });

    it('does not match StringMatches when suffix differs', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/choice-new.json') });
      await expect(sm.startExecution({ matchStr: 'food.txt' })).rejects.toThrow(
        /TaskFailed/,
      );
    });

    it('treats an escaped asterisk as a literal in StringMatches', async () => {
      expect(await run({ lit: 'a*b' })).toHaveBeenCalled();
      const sm = new Sfn({ StateMachine: require('./steps/choice-new.json') });
      await expect(sm.startExecution({ lit: 'axb' })).rejects.toThrow(
        /TaskFailed/,
      );
    });

    it('matches IsPresent for a present (even falsy) value', async () => {
      expect(await run({ maybePresent: 0 })).toHaveBeenCalled();
    });

    it('matches IsNull only when the value is null', async () => {
      expect(await run({ nullable: null })).toHaveBeenCalled();
    });

    it('matches IsNumeric, IsString, IsBoolean type checks', async () => {
      expect(await run({ num: 42 })).toHaveBeenCalled();
      expect(await run({ str: 'hello' })).toHaveBeenCalled();
      expect(await run({ bool: false })).toHaveBeenCalled();
    });

    it('matches IsTimestamp for an RFC3339 timestamp', async () => {
      expect(await run({ ts: '2020-01-01T00:00:00Z' })).toHaveBeenCalled();
    });

    it('compares against another path with NumericGreaterThanPath', async () => {
      expect(await run({ a: 5, b: 3 })).toHaveBeenCalled();
      const sm = new Sfn({ StateMachine: require('./steps/choice-new.json') });
      await expect(sm.startExecution({ a: 2, b: 3 })).rejects.toThrow(
        /TaskFailed/,
      );
    });

    it('compares against another path with StringEqualsPath', async () => {
      expect(await run({ x: 'hi', y: 'hi' })).toHaveBeenCalled();
      const sm = new Sfn({ StateMachine: require('./steps/choice-new.json') });
      await expect(sm.startExecution({ x: 'hi', y: 'bye' })).rejects.toThrow(
        /TaskFailed/,
      );
    });
  });

  describe('Intrinsic functions', () => {
    it('evaluates intrinsics inside Parameters', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/intrinsics.json') });
      await sm.startExecution({
        name: 'Sam',
        age: 5,
        items: [1, 2, 3],
        dups: [1, 1, 2, 3, 3],
        csv: 'a,b,c',
        obj: { x: 1 },
        jsonStr: '{"y":2}',
        j1: { a: 1 },
        j2: { b: 2 },
      });
      expect(sm.getExecutionResult()).toEqual(
        expect.objectContaining({
          formatted: 'Hello, Sam! You are 5.',
          escaped: 'a{b} Sam',
          arr: [5, 1, 'literal, with comma', true, null],
          len: 3,
          first: 1,
          sum: 15,
          nested: 6,
          range: [1, 3, 5, 7, 9],
          partition: [[1, 2], [3]],
          contains: true,
          unique: [1, 2, 3],
          split: ['a', 'b', 'c'],
          b64: 'aGVsbG8=',
          json: '{"x":1}',
          parsed: { y: 2 },
          merged: { a: 1, b: 2 },
        }),
      );
    });

    it('evaluates UUID, Hash and Base64Decode', async () => {
      const sm = new Sfn({
        StateMachine: require('./steps/intrinsics-uuid-hash.json'),
      });
      await sm.startExecution({});
      const result = sm.getExecutionResult();
      expect(result.uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(result.hash).toBe(
        '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      );
      expect(result.decoded).toBe('hello');
    });

    it('evaluates MathRandom (seeded is deterministic, ranged is bounded)', async () => {
      const definition = require('./steps/intrinsics-mathrandom.json');
      const run = async () => {
        const sm = new Sfn({ StateMachine: definition });
        await sm.startExecution({});
        return sm.getExecutionResult();
      };
      const a = await run();
      const b = await run();
      // same seed -> same value
      expect(a.seeded).toBe(b.seeded);
      expect(a.seeded).toBeGreaterThanOrEqual(1);
      expect(a.seeded).toBeLessThan(100);
      // unseeded -> within range
      expect(a.ranged).toBeGreaterThanOrEqual(1);
      expect(a.ranged).toBeLessThan(10);
      expect(Number.isInteger(a.seeded)).toBe(true);
      expect(Number.isInteger(a.ranged)).toBe(true);
    });

    it('fails when States.Format placeholders and arguments mismatch', async () => {
      const sm = new Sfn({
        StateMachine: require('./steps/intrinsics-format-error.json'),
      });
      await expect(sm.startExecution({ only: 'x' })).rejects.toThrow(
        /placeholders/,
      );
    });
  });

  describe('ResultSelector', () => {
    it('transforms a task result before ResultPath', async () => {
      const sm = new Sfn({
        StateMachine: require('./steps/result-selector.json'),
      });
      const mockFn = jest.fn(() => ({
        Payload: { status: 'OK', items: [1, 2, 3] },
        Meta: { requestId: 'abc-123' },
      }));
      sm.bindTaskResource('Select', mockFn);
      await sm.startExecution({ orderId: 'o-1' });
      expect(sm.getExecutionResult()).toEqual({
        orderId: 'o-1',
        result: { status: 'OK', count: 3 },
      });
    });
  });

  describe('Map (ItemProcessor / ItemSelector)', () => {
    it('supports ItemProcessor and ItemSelector aliases', async () => {
      const sm = new Sfn({
        StateMachine: require('./steps/map-itemprocessor.json'),
      });
      await sm.startExecution({ items: [{ v: 1 }, { v: 2 }, { v: 3 }] });
      expect(sm.getExecutionResult()).toEqual([
        { result: 2, idx: 0 },
        { result: 4, idx: 1 },
        { result: 6, idx: 2 },
      ]);
    });
  });

  describe('Map (Distributed)', () => {
    it('limits simultaneous iterations to MaxConcurrency', async () => {
      const sm = new Sfn({
        StateMachine: require('./steps/map-concurrency.json'),
      });
      let active = 0;
      let maxActive = 0;
      sm.bindTaskResource('Work', async (input) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return input;
      });
      await sm.startExecution([1, 2, 3, 4, 5, 6]);
      expect(maxActive).toBeLessThanOrEqual(2);
      expect(sm.getExecutionResult()).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('groups items with ItemBatcher and BatchInput', async () => {
      const sm = new Sfn({
        StateMachine: require('./steps/map-itembatcher.json'),
      });
      sm.bindTaskResource('Batch', (input) => input);
      await sm.startExecution({ items: [1, 2, 3, 4, 5], factor: 10 });
      expect(sm.getExecutionResult()).toEqual([
        { Items: [1, 2], BatchInput: { factor: 10 } },
        { Items: [3, 4], BatchInput: { factor: 10 } },
        { Items: [5], BatchInput: { factor: 10 } },
      ]);
    });

    it('tolerates failures up to ToleratedFailureCount', async () => {
      const sm = new Sfn({
        StateMachine: require('./steps/map-tolerated.json'),
      });
      sm.bindTaskResource('MaybeFail', (input) => {
        if (input === 2) {
          throw new Error('boom');
        }
        return input;
      });
      await sm.startExecution([1, 2, 3]);
      // the failed item is dropped; the rest succeed
      expect(sm.getExecutionResult()).toEqual([1, 3]);
    });

    it('fails the Map when failures exceed the tolerance', async () => {
      const sm = new Sfn({
        StateMachine: require('./steps/map-tolerated.json'),
      });
      sm.bindTaskResource('MaybeFail', (input) => {
        if (input >= 2) {
          throw new Error('boom');
        }
        return input;
      });
      await expect(sm.startExecution([1, 2, 3])).rejects.toThrow();
    });
  });

  describe('InputPath with Parameters', () => {
    it('applies Parameters to the InputPath-narrowed input', async () => {
      const sm = new Sfn({
        StateMachine: require('./steps/input-parameters.json'),
      });
      await sm.startExecution({ inner: { a: 42 }, a: 999 });
      expect(sm.getExecutionResult()).toEqual({ picked: 42 });
    });
  });

  describe('Choice data-test operators on absent fields', () => {
    it('does not match a negated Is* operator when the field is absent', async () => {
      const sm = new Sfn({
        StateMachine: require('./steps/choice-isabsent.json'),
      });
      const matchedFn = jest.fn((input) => input);
      const defaultedFn = jest.fn((input) => input);
      sm.bindTaskResource('Matched', matchedFn);
      sm.bindTaskResource('Defaulted', defaultedFn);
      await sm.startExecution({});
      expect(matchedFn).not.toHaveBeenCalled();
      expect(defaultedFn).toHaveBeenCalled();
    });

    it('matches a negated Is* operator for a present value of another type', async () => {
      const sm = new Sfn({
        StateMachine: require('./steps/choice-isabsent.json'),
      });
      const matchedFn = jest.fn((input) => input);
      const defaultedFn = jest.fn((input) => input);
      sm.bindTaskResource('Matched', matchedFn);
      sm.bindTaskResource('Defaulted', defaultedFn);
      await sm.startExecution({ x: 5 });
      expect(matchedFn).toHaveBeenCalled();
      expect(defaultedFn).not.toHaveBeenCalled();
    });
  });

  describe('Parallel', () => {
    it('does not mutate its definition across executions', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/parallel.json') });
      sm.bindTaskResource('ParallelTask1', (input) => input[0] + input[1]);
      sm.bindTaskResource('ParallelTask2', (input) => input[0] - input[1]);
      await sm.startExecution([1, 1]);
      expect(sm.getExecutionResult()).toEqual(expect.arrayContaining([2, 0]));
      await sm.startExecution([1, 1]);
      expect(sm.getExecutionResult()).toEqual(expect.arrayContaining([2, 0]));
    });
  });

  describe('Variables (Assign)', () => {
    it('assigns variables and references them in a later state (JSONPath)', async () => {
      const sm = new Sfn({
        StateMachine: require('./steps/assign-jsonpath.json'),
      });
      await sm.startExecution({ name: 'Ada', n: 5 });
      expect(sm.getExecutionResult()).toEqual({
        msg: 'Hello Ada',
        doubled: 10,
      });
    });
  });

  describe('JSONata', () => {
    it('evaluates a Pass Output expression', async () => {
      const sm = new Sfn({
        StateMachine: require('./steps/jsonata-pass.json'),
      });
      await sm.startExecution({ a: 2, b: 3 });
      expect(sm.getExecutionResult()).toEqual({ sum: 5 });
    });

    it('passes Arguments to a Task and shapes Output', async () => {
      const sm = new Sfn({
        StateMachine: require('./steps/jsonata-task.json'),
      });
      const mockFn = jest.fn((args) => {
        expect(args).toEqual({ sku: 'A1' });
        return { price: 9.99 };
      });
      sm.bindTaskResource('Price', mockFn);
      await sm.startExecution({ sku: 'A1' });
      expect(mockFn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual({ price: 9.99, sku: 'A1' });
    });

    it('evaluates a Choice Condition', async () => {
      const adult = new Sfn({
        StateMachine: require('./steps/jsonata-choice.json'),
      });
      await adult.startExecution({ age: 20 });
      expect(adult.getExecutionResult()).toEqual({ status: 'adult' });

      const minor = new Sfn({
        StateMachine: require('./steps/jsonata-choice.json'),
      });
      await minor.startExecution({ age: 10 });
      expect(minor.getExecutionResult()).toEqual({ status: 'minor' });
    });

    it('maps items with Items, ItemProcessor and Output expressions', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/jsonata-map.json') });
      await sm.startExecution({
        items: [
          { name: 'Widget', price: 5, quantity: 3 },
          { name: 'Gadget', price: 12, quantity: 2 },
        ],
      });
      expect(sm.getExecutionResult()).toEqual([
        { name: 'Widget', total: 15 },
        { name: 'Gadget', total: 24 },
      ]);
    });

    it('lets a Map child read an outer variable', async () => {
      const sm = new Sfn({
        StateMachine: require('./steps/jsonata-scope.json'),
      });
      await sm.startExecution({ ids: [1, 2] });
      expect(sm.getExecutionResult()).toEqual({
        results: [
          { id: 1, region: 'EU' },
          { id: 2, region: 'EU' },
        ],
        regionStillVisible: 'EU',
      });
    });

    it('does not leak a child-assigned variable to the parent scope', async () => {
      const sm = new Sfn({
        StateMachine: require('./steps/jsonata-scope-leak.json'),
      });
      await expect(sm.startExecution({})).rejects.toThrow();
    });

    it('merges Parallel branch results via an Output expression', async () => {
      const sm = new Sfn({
        StateMachine: require('./steps/jsonata-parallel.json'),
      });
      await sm.startExecution({ x: 1, y: 2 });
      expect(sm.getExecutionResult()).toEqual({ a: 1, b: 2 });
    });

    it('isolates per-iteration variable scopes in a concurrent Map', async () => {
      const sm = new Sfn({
        StateMachine: require('./steps/jsonata-map-assign.json'),
      });
      await sm.startExecution([1, 2, 3, 4, 5]);
      // Each iteration assigns `mine` then reads it in a later state; with
      // shared scope, concurrent iterations would clobber each other.
      expect(sm.getExecutionResult()).toEqual([
        { mine: 1, item: 1 },
        { mine: 2, item: 2 },
        { mine: 3, item: 3 },
        { mine: 4, item: 4 },
        { mine: 5, item: 5 },
      ]);
    });
  });

  describe('ergonomics', () => {
    it('startExecution resolves to the execution result', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/simple.json') });
      sm.bindTaskResource('Test', (input) => input.test === 1);
      const result = await sm.startExecution({ test: 1 });
      expect(result).toBe(true);
    });

    it('getExecutionResult is idempotent (does not mutate)', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/simple.json') });
      sm.bindTaskResource('Test', (input) => input.test === 1);
      await sm.startExecution({ test: 1 });
      expect(sm.getExecutionResult()).toBe(true);
      expect(sm.getExecutionResult()).toBe(true);
      expect(sm.getExecutionResult()).toBe(true);
    });

    it('accepts a raw state machine definition (no StateMachine wrapper)', async () => {
      const sm = new Sfn(require('./steps/simple.json'));
      sm.bindTaskResource('Test', (input) => input.test === 1);
      const result = await sm.startExecution({ test: 1 });
      expect(result).toBe(true);
    });

    it('still validates a raw state machine definition', () => {
      expect(() => new Sfn({ willThrow: true })).toThrow(
        /required property 'StartAt'/,
      );
    });
  });

  describe('Catch on Parallel', () => {
    it('catches a failed branch with a States.ALL catcher', async () => {
      const sm = new Sfn({
        StateMachine: require('./steps/parallel-catch.json'),
      });
      const boomFn = jest.fn(() => {
        throw new Error('branch blew up');
      });
      const recoveredFn = jest.fn((input) => input);
      sm.bindTaskResource('Boom', boomFn);
      sm.bindTaskResource('Recovered', recoveredFn);
      await sm.startExecution({});
      expect(boomFn).toHaveBeenCalled();
      expect(recoveredFn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.objectContaining({
          error: expect.objectContaining({
            Error: 'States.ALL',
          }),
        }),
      );
    });
  });

  describe('resources', () => {
    it('can bind a task resource by its Resource ARN', async () => {
      const sm = new Sfn(require('./steps/simple.json'));
      const arn = 'arn:aws:lambda:ap-southeast-1:123456789012:function:test';
      sm.bindTaskResource(arn, (input) => input.test === 1);
      const result = await sm.startExecution({ test: 1 });
      expect(result).toBe(true);
    });

    it('can run a real handler module via a Serverless-style reference', async () => {
      const sm = new Sfn({
        StateMachine: require('./steps/simple.json'),
        handlerBasePath: __dirname,
      });
      sm.bindTaskResource('Test', 'handlers/echo.handler');
      const result = await sm.startExecution({ test: 1 });
      expect(result).toEqual({ echoed: { test: 1 } });
    });

    it('also accepts a { handler } object reference', async () => {
      const sm = new Sfn({
        StateMachine: require('./steps/simple.json'),
        handlerBasePath: __dirname,
      });
      sm.bindTaskResource('Test', { handler: 'handlers/echo.handler' });
      const result = await sm.startExecution({ test: 1 });
      expect(result).toEqual({ echoed: { test: 1 } });
    });
  });

  describe('trace (generator-style stepping)', () => {
    it('yields each transition and returns the final result', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/tasks.json') });
      sm.bindTaskResource('Test', (i) => ({ test: i.test + 1 }));
      sm.bindTaskResource('Test1', (i) => ({ test: i.test + 2 }));
      sm.bindTaskResource('Test2', (i) => i.test + 3);

      const iterator = sm.trace({ test: 1 });
      const labels = [];
      let next = await iterator.next();
      while (!next.done) {
        labels.push(next.value.state);
        next = await iterator.next();
      }

      expect(labels[0]).toBe('ExecutionStarted');
      expect(labels).toEqual(
        expect.arrayContaining(['TaskStateEntered', 'TaskStateExited']),
      );
      expect(labels[labels.length - 1]).toBe('ExecutionSucceeded');
      // the generator's return value is the final execution output
      expect(next.value).toBe(7);
    });

    it('can be consumed with for-await', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/simple.json') });
      sm.bindTaskResource('Test', (input) => input.test === 1);
      const states = [];
      for await (const step of sm.trace({ test: 1 })) {
        states.push(step.state);
      }
      expect(states).toContain('LambdaFunctionSucceeded');
      expect(sm.getExecutionResult()).toBe(true);
    });
  });

  describe('CLI', () => {
    const { execFileSync } = require('child_process');
    const root = require('path').resolve(__dirname, '..');

    it('runs a state machine definition and prints the result', () => {
      const out = execFileSync(
        'node',
        [
          'bin/cli.js',
          'run',
          'test/steps/simple.json',
          '--input',
          '{"test":1}',
        ],
        { encoding: 'utf8', cwd: root },
      );
      expect(JSON.parse(out)).toEqual({ test: 1 });
    });

    it('prints usage with --help', () => {
      const out = execFileSync('node', ['bin/cli.js', '--help'], {
        encoding: 'utf8',
        cwd: root,
      });
      expect(out).toMatch(/Usage: stepfunctions run/);
    });
  });
});
