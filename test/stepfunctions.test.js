const Sfn = require('../lib/stepfunctions');

describe('StateMachine Test', () => {});

describe('StateMachine', () => {
  it('validates states definition', async () => {
    expect(() => new Sfn({ statemachine: { willThrow: false } })).toThrow(
      'data should NOT have additional properties',
    );
  });

  it('Check if a task was run', async () => {
    const sm = new Sfn({
      statemachine: {
        StartAt: 'Test',
        States: {
          Test: {
            Type: 'Task',
            Resource:
              'arn:aws:lambda:ap-southeast-1:123456789012:function:test',
            End: true,
          },
        },
      },
    });
    const mockfn = jest.fn((input) => input.test === 1);
    const spy = jest.spyOn(sm, 'step');
    sm.bindResolver('Test', mockfn);
    await sm.startExecution({ test: 1 });
    expect(mockfn).toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    // expect(sm.getExecutionResult()).toBe(true)
  });

  describe('supports Task', () => {});

  describe('supports Map', () => {});

  describe('supports Parallel', () => {});

  describe('supports Pass', () => {});

  describe('supports Fail', () => {});

  describe('supports Succeed', () => {});

  describe('supports Wait', () => {});

  describe('supports Choice', () => {});

  describe('supports Retry', () => {});

  describe('supports Catch', () => {});
});
