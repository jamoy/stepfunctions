const Sfn = require('../lib/stepfunctions');

describe('StateMachine', () => {
  it('validates states definition', async () => {
    expect(() => new Sfn({ statemachine: { willThrow: false } })).toThrow(
      'data should NOT have additional properties',
    );
  });

  it('Check if a task was run', async () => {
    const sm = new Sfn({ statemachine: require('./steps/simple.json') });
    const mockfn = jest.fn((input) => input.test === 1);
    const spy = jest.spyOn(sm, '_step');
    sm.bindTaskResource('Test', mockfn);
    await sm.startExecution({ test: 1 });
    expect(mockfn).toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    expect(sm.getExecutionResult()).toBe(true);
  });

  it('can get the execution result', () => {});

  describe('supports Task', () => {});

  describe('supports Map', () => {
    it('supports ItemsPath', () => {});
  });

  describe('supports Parallel', () => {});

  describe('supports Pass', () => {});

  describe('supports Fail', () => {});

  describe('supports Succeed', () => {});

  describe('supports Wait', () => {});

  describe('supports Choice', () => {});

  describe('supports Retry', () => {});

  describe('supports Catch', () => {});

  describe('supports Parameters', () => {});

  describe('supports InputPath', () => {});

  describe('supports ResultPath', () => {});

  describe('supports OutputPath', () => {});
});
