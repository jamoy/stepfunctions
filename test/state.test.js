const StateMachine = require('../lib/statemachine');
//
// module.exports.serverless = function(opts) {
//   const definition = yaml.safeLoad(fs.readFileSync(path.resolve(process.cwd(), opts.manifest), 'utf8'));
//   return new StateMachine(definition.stepFunctions.stateMachines, opts);
// }

const sm = new StateMachine({
  statemachine: {
    StartAt: 'Test',
    States: {
      'Test': {
        Type: 'Task',
        Resource: 'arn:aws:lambda:ap-southeast-1:123456789012:function:test',
        Next: 'Map'
      },
      'Map': {
        Type: 'Map',
        Iterator: {
          StartAt: 'Test2',
          States: {
            'Test2': {
              Type: 'Task',
              Resource: 'arn:aws:lambda:ap-southeast-1:123456789012:function:Next',
              Next: 'Test3'
            },
            'Test3': {
              Type: 'Task',
              Resource: 'arn:aws:lambda:ap-southeast-1:123456789012:function:Next',
              End: true
            },
          }
        },
        Next: 'Next'
      },
      'Next': {
        Type: 'Task',
        Resource: 'arn:aws:lambda:ap-southeast-1:123456789012:function:next',
        End: true
      }
    }
  },
  resolvers: {
    Test: async (event) => ([event, event]),
    Test2: async (event) => event,
    Test3: async (event) => event,
    Next: async (event) => event
  }
});

(async () => {
  await sm.startLazy({ test: true });
  sm.debug()
  await sm.next();
  sm.debug();
  await sm.next();
  sm.debug();
  await sm.next();
  sm.debug();
  await sm.next();
  sm.debug();
  await sm.next();
  // await sm.next();
  // sm.debug();

  // sm.report();
})();