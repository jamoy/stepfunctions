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
  });

  describe('Parallel', () => {});

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
        /Transitioned to a FAIL state for Fail/,
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
        /Transitioned to a FAIL state for Fail/,
      );
      expect(mockFn).toHaveBeenCalled();
      expect(succeedingFn).toHaveBeenCalled();
    });
  });

  // TODO: maybe use faketimers
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
      // 3 seconds in the future
      const date = new Date();
      await sm.startExecution({
        value: 'WaitUntilPath',
        until: date.setSeconds(date.getSeconds() + 1),
      });
      expect(mockFn).toHaveBeenCalled();
    }, 1500);

    it.skip('can abort a running statemachine', () => {});
  });

  describe('Choice', () => {});

  describe('Retry', () => {});

  describe('Catch', () => {});

  describe('Input and Output', () => {
    it.skip('can modify input with Parameters', () => {});

    it.skip('can modify input with InputPath', () => {});

    it.skip('can modify output with ResultPath', () => {});

    it.skip('can modify output OutputPath', () => {});
  });
});
