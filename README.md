# stepfunctions

![Stepfunctions](https://github.com/jamoy/stepfunctions/workflows/Stepfunctions/badge.svg)
[![codecov](https://codecov.io/gh/jamoy/stepfunctions/branch/master/graph/badge.svg)](https://codecov.io/gh/jamoy/stepfunctions)

AWS Step Functions implementation in Node, so you can run your Node.js lambda handlers in your test environments. Made to support Serverless JS testing.

## Installation

```
npm i -D stepfunctions
```

or if you're using yarn like me:

```
yarn add -D stepfunctions
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
  StateMachine: {
    StartAt: 'Test',
    States: {
      Test: {
        Type: 'Task',
        Resource: 'arn:aws:lambda:ap-southeast-1:123456789012:function:test',
        End: true,
      },
    },
  },
});

describe('StateMachine Test', () => {
  it('Check if a task was run', async () => {
    const mockfn = jest.fn((input) => input.test === 1);
    sm.bindTaskResource('Test', mockfn);
    await sm.startExecution({ test: 1 });
    expect(mockfn).toHaveBeenCalled();
  });
});
```

You can see more examples in the test file at `/test/stepfunctions.test.js`.

## API

### startExecution(Input, Options);

```
sm.startExecution(input, {
  respectTime: false,
  maxWaitTime: 30,
  maxConcurrency: 10,
});
```

- respectTime - will ensure that the time used in Wait steps will be respected and not use the maximum
  wait time in the library. defaults to false.
- maxWaitTime - the maximum amount of time a wait step can function. defaults to 30s.
- maxConcurrency - allows the amount of parallel tasks to be ran concurrently. defaults to 10.

### bindTaskResource(Task, Callback)

```
new sm = new Sfn({});
sm.bindTaskResource('HelloWorld', (input) => `hello ${input}`);
await sm.startExecution('world');
// will output `hello world`
```

Must be called before `startExecution`, binds to `Tasks` and replaces their callback to the provided `Callback` parameter.

### getExecutionResult()

Must be called after `startExecution`. This function returns the absolute result from the statemachine if it has finished.

### Task.abort()

`abort` is made available within the replaced Task callbacks made with `bindTaskResource`. this allows you to abort a call
from within the callback itself.

## Supported States

The following states are supported by this library:

- [x] Task
- [x] Map
- [x] Choice
- [x] Parallel
- [ ] Retry
- [ ] Catch
- [x] Pass
- [x] Succeed
- [x] Fail
- [x] Wait

and input and output processing via:

- [x] InputPath
- [x] ItemsPath
- [x] Parameters
- [x] OutputPath
- [x] ResultPath
- [x] Context

and choice support:

- [x] And
- [x] Not
- [x] Or
- [x] DefaultState
- [x] BooleanEquals
- [x] NumericEquals
- [x] NumericGreaterThan
- [x] NumericGreaterThanEquals
- [x] NumericLessThan
- [x] NumericLessThanEquals
- [x] StringEquals
- [x] StringGreaterThan
- [x] StringGreaterThanEquals
- [x] StringLessThan
- [x] StringLessThanEquals
- [x] TimestampEquals
- [x] TimestampGreaterThan
- [x] TimestampGreaterThanEquals
- [x] TimestampLessThan
- [x] TimestampLessThanEquals

More information on the spec above https://states-language.net/spec.html

## Caveats

1. `Wait` will wait for at most 30 seconds. This is because it's expected that this library
   will be used within a testing context. You can override this behaviour by adding the `respectTime` option to true in the `startExecution` method.

## Future

PR's are welcome to help finish the ones below :)

- [ ] Better error handling and messages
- [ ] Change arn in bindTaskResource instead of the State name
- [ ] Run `sls invoke local` instead of binding resolvers
- [ ] More accurate timing mechanism
- [ ] use `jest.fakeTimers()` in the test
- [ ] Walk through states ala "generator" style. e.g, `yield sm.next()`

## License

stepfunctions is [MIT Licensed](LICENSE)
