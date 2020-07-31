const Sfn = require('../lib/stepfunctions');

describe('Stepfunctions', () => {
  it('validates states definition via asl-validator', async () => {
    const message = 'data should NOT have additional properties';
    expect(() => new Sfn({ StateMachine: { willThrow: true } })).toThrow(
      message,
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
      await expect(sm.startExecution()).rejects.toThrowError(
        /Transitioned to a FAIL state/,
      );
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
      await expect(sm.startExecution()).rejects.toThrowError(
        /Transitioned to a FAIL state/,
      );
      expect(mockFn).toHaveBeenCalled();
      expect(succeedingFn).toHaveBeenCalled();
    });
  });

  // TODO: maybe use jest.fakeTimers
  describe('Wait', () => {
    it('can wait for 1 second', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/wait.json') });
      const mockFn = jest.fn();
      sm.bindTaskResource('Final', mockFn);
      await sm.startExecution({ value: 'Wait' });
      expect(mockFn).toHaveBeenCalled();
    }, 1500);

    it('can wait for 1 second using SecondsPath', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/wait.json') });
      const mockFn = jest.fn();
      sm.bindTaskResource('Final', mockFn);
      await sm.startExecution({ value: 'WaitPath', until: 1 });
      expect(mockFn).toHaveBeenCalled();
    }, 1500);

    it('can wait until a specified time', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/wait.json') });
      const mockFn = jest.fn();
      sm.bindTaskResource('Final', mockFn);
      await sm.startExecution({ value: 'WaitUntil' });
      expect(mockFn).toHaveBeenCalled();
    });

    it('can wait until a specified time using TimestampPath', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/wait.json') });
      const mockFn = jest.fn();
      sm.bindTaskResource('Final', mockFn);
      // 1 second in the future
      const date = new Date();
      await sm.startExecution({
        value: 'WaitUntilPath',
        until: date.setSeconds(date.getSeconds() + 1),
      });
      expect(mockFn).toHaveBeenCalled();
    }, 2000);

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
      await sm.startExecution({ param1: 'tester' });
      expect(mockFn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.objectContaining({ param1: 'tester' }),
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
      await sm.startExecution({ param2: -1 });
      expect(mockFn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.objectContaining({ param2: -1 }),
      );
    });

    it('can test less than against strings', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/choice.json') });
      const mockFn = jest.fn((input) => input);
      sm.bindTaskResource('Test', mockFn);
      await sm.startExecution({ param2: 'tes' });
      expect(mockFn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.objectContaining({ param2: 'tes' }),
      );
    });

    it('can test less than against timestamps', async () => {
      const sm = new Sfn({ StateMachine: require('./steps/choice.json') });
      const mockFn = jest.fn((input) => input);
      sm.bindTaskResource('Test', mockFn);
      await sm.startExecution({ param2: '2001-01-01T11:00:00Z' });
      expect(mockFn).toHaveBeenCalled();
      expect(sm.getExecutionResult()).toEqual(
        expect.objectContaining({ param2: '2001-01-01T11:00:00Z' }),
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

  describe('Retry', () => {});

  describe('Catch', () => {});

  describe('Input and Output', () => {
    it.skip('can modify input with Parameters', () => {});

    it.skip('can modify input with InputPath', () => {});

    it.skip('can modify output with ResultPath', () => {});

    it.skip('can modify output OutputPath', () => {});
  });
});
