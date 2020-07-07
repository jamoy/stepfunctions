# stepfunctions

AWS Step Functions implementation in Node, so you can run your Node.js lambda handlers in your test environments. Made to support Serverless JS testing.

### Motivation

I was working on getting step functions orchestrated using Serverless, Lambda, and Step functions and there was no way to run through the statemachine in Jest. So I made the spec, or parts of it, work in JS so that I can spy, and mock the state machine. 

I am perfectly aware of the existence of step functions offline and local stepfunctions, but none of those can be orchestrated natively in a testing context.

### Usecase

If you are:

- using Node, Lambda, AWS Step Functions
- using Serverless
- writing Integration tests with AWS Step Functions
- trying to see how the statemachine runs before creating it in AWS

### License

stepfunctions is [MIT Licensed](LICENSE)
