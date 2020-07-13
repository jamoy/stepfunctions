# stepfunctions

AWS Step Functions implementation in Node, so you can run your Node.js lambda handlers in your test environments. Made to support Serverless JS testing.

## Installation

```
npm install --save-dev stepfunctions
```

## Motivation

I was working on getting step functions orchestrated using Serverless, Lambda, and Step functions and there was no way to run through the statemachine in Jest. So I made the spec, or parts of it, work in JS so that I can spy, and mock the state machine.

I am perfectly aware of the existence of step functions offline and local stepfunctions, but none of those can be orchestrated natively in a testing context.

## Usecase

If you are:

- using Node, Lambda, AWS Step Functions
- using Serverless
- writing Integration tests with AWS Step Functions
- trying to see how the statemachine runs before creating it in AWS

## Usage

Include it in your test files, tested with Jest so far.

```js
const Sfn = require('stepfunctions');

const sm = new Sfn({
  statemachine: {
    StartAt: 'Test',
    States: {
      Test: {
        Type: 'Task',
        Resource: 'arn:lambda',
        End: true,
      },
    },
  },
});

describe('StateMachine Test', () => {
  it('Check if a task was run', async () => {
    const mockfn = jest.fn((input) => input.test === 1);
    sm.bindResolver('Test', mockfn);
    await sm.startExecution({ test: 1 });
    expect(mockfn).toHaveBeenCalled();
    expect(mockfn).toHaveBeenCalled();
  });
});
```

## Supported States

The following states are supported by this library:

- [x] Task
- [x] Map
- [x] Choice
- [ ] Parallel
- [ ] Retry
- [ ] Catch
- [x] Pass
- [ ] Succeed
- [ ] Fail
- [ ] Wait

and input and output processing via:

- [x] InputPath
- [x] ItemsPath
- [ ] Parameters
- [ ] OutputPath
- [ ] DefaultPath
- [ ] ResultPath

More information on the spec above https://states-language.net/spec.html

## Roadmap

- [ ] Run `sls invoke local` instead of binding resolvers
- [ ] More accurate timing mechanism
- [ ] Walk through states ala "generator" style. e.g, `yield sm.next()`

## License

stepfunctions is [MIT Licensed](LICENSE)
