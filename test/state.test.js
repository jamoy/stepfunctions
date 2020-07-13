const StateMachine = require('../lib/sf');

describe('StateMachine', () => {
  it('validates states definition', async () => {
    expect(() => new StateMachine({ statemachine: { test } })).toThrow(
      'data should NOT have additional properties',
    );
  });

  it('can run steps successfully', async () => {
    const mocked = jest.fn(() => 1);
    const sm = new StateMachine({
      statemachine: {
        StartAt: 'test',
        States: {
          test: {
            Type: 'Task',
            Resource:
              'arn:aws:lambda:ap-southeast-1:123456789012:function:test',
            End: true,
          },
        },
      },
      resolvers: {
        test: mocked,
      },
    });
    const spy = jest.spyOn(sm, 'step');
    await sm.startExecution({ nothing: true });
    expect(spy).toHaveBeenCalled();
    expect(mocked.mock.calls.length).toBe(1);
  });

  describe('supports Lambda Tasks', () => {});

  describe('supports Tasks', () => {});

  describe('supports Map', () => {});

  describe('supports Parallel', () => {});

  describe('supports Pass', () => {});

  describe('supports Choice', () => {});

  describe('supports Retry', () => {});

  describe('supports Catch', () => {});
});
