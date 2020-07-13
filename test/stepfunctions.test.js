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

    // it('replicates a lambda call', async () => {
    //   const sm = new Sfn({ StateMachine: require('./steps/task.json') });
    //   const mockfn = jest.fn((input) => input.test === 1);
    //   sm.bindTaskResource('Test', mockfn);
    //   const mockSpy = jest.fn();
    //   await sm.startExecution({ test: 1 });
    //   sm.on('LambdaFunctionStarted', mockSpy);
    //   expect(mockSpy).toHaveBeenCalled();
    // });
  });

  describe('Map', () => {
    it('supports ItemsPath', () => {});
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

  describe('Fail', () => {});

  describe('Succeed', () => {});

  describe('Wait', () => {});

  describe('Choice', () => {});

  describe('Retry', () => {});

  describe('Catch', () => {});

  describe('Input and Output', () => {
    it('can modify input with Parameters', () => {});

    it('can modify input with InputPath', () => {});

    it('can modify output with ResultPath', () => {});

    it('can modify output OutputPath', () => {});
  });
});
