# stepfunctions

![Stepfunctions](https://github.com/jamoy/stepfunctions/workflows/Stepfunctions/badge.svg)
[![codecov](https://codecov.io/gh/jamoy/stepfunctions/branch/master/graph/badge.svg)](https://codecov.io/gh/jamoy/stepfunctions)

AWS Step Functions implementation in Node, so you can run your Node.js lambda handlers in your test environments. Made to support Serverless JS testing.

## Installation

```
pnpm add -D stepfunctions
```

or with npm / yarn:

```
npm i -D stepfunctions
yarn add -D stepfunctions
```

> This repository itself is developed with [pnpm](https://pnpm.io) (`pnpm install`, `pnpm test`, `pnpm lint`).

## Motivation

I was working on getting step functions orchestrated using Serverless, Lambda, and Step functions and there was no way to run through the statemachine in Jest. So I made the spec, or parts of it, work in JS so that I can spy and mock the statemachine.

I am perfectly aware of the existence of step-functions-offline and local-stepfunctions, but none of those can be orchestrated natively in a testing context.

## Usecase

If you are:

- using Node, Lambda, AWS Step Functions
- using Serverless
- writing Integration tests with AWS Step Functions
- trying to see how the statemachine runs before creating it in AWS

## Usage

The package ships both ESM and CommonJS entry points with TypeScript types, so use whichever you prefer:

```js
// ESM
import Sfn from 'stepfunctions';
// or: import { StepFunction } from 'stepfunctions';

// CommonJS
const Sfn = require('stepfunctions');
```

Include it in your test files (tested with Jest so far). You can pass a bare Amazon States Language definition straight to the constructor, and `startExecution` resolves to the final output:

```js
const Sfn = require('stepfunctions');

const sm = new Sfn({
  StartAt: 'Test',
  States: {
    Test: {
      Type: 'Task',
      Resource: 'arn:aws:lambda:ap-southeast-1:123456789012:function:test',
      End: true,
    },
  },
});

describe('StateMachine Test', () => {
  it('Check if a task was run', async () => {
    const mockfn = jest.fn((input) => input.test === 1);
    sm.bindTaskResource('Test', mockfn);
    const result = await sm.startExecution({ test: 1 });
    expect(mockfn).toHaveBeenCalled();
    expect(result).toBe(true);
  });
});
```

The `new Sfn({ StateMachine })` form is still supported for backwards compatibility, as is calling `getExecutionResult()` after `startExecution` (it is now idempotent — it no longer consumes the result).

You can see more examples in `/test/stepfunctions.test.js`.

## API

### startExecution(Input, Options);

Resolves to the final output of the execution.

```js
const output = await sm.startExecution(input, {
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

```js
const sm = new Sfn({
  StateMachine: {
    StartAt: 'HelloWorld',
    States: {
      HelloWorld: {
        Type: 'Task',
        Resource: 'arn:aws:lambda:ap-southeast-1:123456789012:function:test',
        End: true,
      },
    },
  },
});
sm.bindTaskResource('HelloWorld', (input) => `hello ${input}`);
await sm.startExecution('world');
// will output `hello world`
```

Must be called before `startExecution`, binds to `Tasks` and replaces their handler to the provided `Callback` parameter.

The first argument may be the **state name** or the task's **Resource ARN**. The second may be a function, or a Serverless-style handler reference (`'path/to/file.exportedFn'` or `{ handler: 'path/to/file.exportedFn' }`) which is loaded and invoked — pass `handlerBasePath` to the constructor to control where those paths resolve from:

```js
const sm = new Sfn({ StateMachine, handlerBasePath: __dirname });
sm.bindTaskResource('HelloWorld', 'handlers/hello.handler'); // runs the real handler
```

### trace(Input, Options)

Run an execution and walk it generator-style, yielding each transition. The iterator's return value is the final output.

```js
for await (const step of sm.trace('world')) {
  console.log(step.state, step.step); // e.g. 'TaskStateEntered' 'HelloWorld'
}
```

### CLI

```
stepfunctions run definition.json --input '{"hello":"world"}' [--report]
```

Runs a state machine definition file and prints the result as JSON. Tasks without a bound/real handler pass their input through. Use `--base-path` to resolve Serverless-style handler references.

### getExecutionResult()

Must be called after `startExecution`. This function returns the absolute result from the statemachine if it has finished. It is idempotent — repeated calls return the same value. (`startExecution` also resolves to this value, so you often don't need it.)

### getReport()

Use `console.table` to list down the transitions that occured.

### Task.abort()

`abort` is made available within the replaced Task handlers made with `bindTaskResource`. this allows you to abort a call
from within a handler itself.

## Requirements

Node.js `>= 20`. The library is tested on Node 20, 24, and 26.

## Support

The spec implemented in https://states-language.net/spec.html is supported by this library, including the newer (post-2020) JSONPath additions:

- **Intrinsic functions** inside `Parameters`, `ItemSelector` and `ResultSelector` payload templates: `States.Format`, `States.StringToJson`, `States.JsonToString`, `States.Array`, `States.ArrayPartition`, `States.ArrayContains`, `States.ArrayRange`, `States.ArrayGetItem`, `States.ArrayLength`, `States.ArrayUnique`, `States.Base64Encode`, `States.Base64Decode`, `States.Hash`, `States.JsonMerge`, `States.MathRandom`, `States.MathAdd`, `States.StringSplit` and `States.UUID` (including nested calls).
- **`Choice` operators** `StringMatches`, `IsNull`, `IsPresent`, `IsBoolean`, `IsNumeric`, `IsString`, `IsTimestamp`, and all the `*Path` comparison variants (e.g. `NumericGreaterThanPath`, `StringEqualsPath`).
- **`ResultSelector`** on `Task`, `Map` and `Parallel` (applied before `ResultPath` and `OutputPath`).
- **`Map`** accepts `ItemProcessor`/`ItemSelector` as aliases of `Iterator`/`Parameters`, and honours `MaxConcurrency`, `ItemBatcher` (`MaxItemsPerBatch`, `BatchInput`) and the `ToleratedFailureCount`/`ToleratedFailurePercentage` thresholds.

### JSONata (Nov 2024)

Set `QueryLanguage: "JSONata"` on the state machine or an individual state. `{% … %}` expressions are evaluated with [`jsonata`](https://www.npmjs.com/package/jsonata), with the `$states` object (`$states.input`, `$states.result`, `$states.context`) and any assigned variables bound. Supported on `Pass` (`Output`), `Task` (`Arguments`, `Output`), `Choice` (`Condition`), `Map` (`Items`, `ItemSelector`, `Output`) and `Parallel` (`Output`).

### Variables (Nov 2024)

`Assign` is supported in both JSONPath and JSONata modes. Assigned variables are referenced as `$name` in later states and follow AWS scoping: a `Map`/`Parallel` child can read outer variables but its own assignments do not leak back to the parent scope.

`Retry` and `Catch` are supported on `Task`, `Map` and `Parallel` (error matching, `States.ALL`, `IntervalSeconds`/`BackoffRate`/`MaxAttempts`, and `ResultPath` for the caught error). They remain best-effort for some AWS-specific error names.

**Not yet supported**

- JSONata on `Wait`/`Succeed`/`Fail`, and the `$states.errorOutput` binding inside a `Catch`.
- Distributed `Map` infrastructure (`ItemReader`, `ResultWriter`); `ItemProcessor` always runs inline.

## Caveats

1. `Wait` will wait for at most 30 seconds. This is because it's expected that this library
   will be used within a testing context. You can override this behaviour by adding the `respectTime` option to true in the `startExecution` method.
2. No support for Handling `States.Permissions` as the library will not have context on AWS related permissions.

## Done

- [x] Bind in `bindTaskResource` by the Resource ARN as well as the state name
- [x] Run real handler modules (Serverless-style `file.export` refs) instead of binding resolvers
- [x] Typescript typings
- [x] Run via CLI
- [x] Remove the "experimental" label on retry and catch
- [x] More accurate timing mechanism
- [x] use `jest.fakeTimers()` in the test
- [x] Walk through states ala "generator" style (`for await (const step of sm.trace(input))`)
- [x] Support the JSONata query language and Variables (`Assign`)

## License

stepfunctions is [MIT Licensed](LICENSE)
