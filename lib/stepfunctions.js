const EventEmitter = require('events').EventEmitter;
const { performance } = require('perf_hooks');
const jsonpath = require('jsonpath');
const aslValidator = require('asl-validator');

const comparators = [
  'BooleanEquals',
  'StringEquals',
  'StringGreaterThan',
  'StringGreaterThanEquals',
  'StringLessThan',
  'StringLessThanEquals',
  'NumericEquals',
  'NumericGreaterThan',
  'NumericGreaterThanEquals',
  'NumericLessThan',
  'NumericLessThanEquals',
  'TimestampEquals',
  'TimestampGreaterThan',
  'TimestampGreaterThanEquals',
  'TimestampLessThan',
  'TimestampLessThanEquals',
];

class ErrorState extends Error {
  static ALL = 'States.ALL';
  static Runtime = 'States.Runtime';
  static Timeout = 'States.Timeout';
  static TaskFailed = 'States.TaskFailed';

  constructor(state, message, original) {
    super(typeof message === 'object' && message.message ? message.message : message);
    this.state = state;
    this.original = typeof original === 'object' ? original : undefined;
  }
}

class StepFunction extends EventEmitter {
  /**
   * @typedef opts
   * @type {Object}
   * @property {string} Name
   * @property {Object} StateMachine
   * @property {Object} Resources
   */

  /**
   * constructor
   *
   * @access public
   * @param {opts} sm
   */
  constructor(sm) {
    super();
    const { isValid, errorsText } = aslValidator(sm.StateMachine);
    if (!isValid) {
      throw new Error(errorsText());
    }

    this.Name = sm.Name || sm.StateMachine.StartAt;
    this.StateMachine = sm.StateMachine;
    this.Resources = typeof sm.Resources === 'object' ? sm.Resources : {};

    this.refresh();
  }

  /**
   * startExecution
   *
   * start an execution of a defined statemachine.
   *
   * @access public
   * @param {any} input an input that will be passed to the first task
   * @param {object} opts execution options
   */
  async startExecution(input, opts = {}) {
    this.refresh();
    this.runtime = {
      respectTime: opts.respectTime === true,
      maxWaitTime: opts.maxWaitTime || 30,
      maxConcurrency: opts.maxConcurrency || 10,
    };
    this.transition('ExecutionStarted', { input });
    try {
      const output = await this.step(
        this.StateMachine.StartAt,
        input,
        this.StateMachine.States,
      );
      this.transition('ExecutionSucceeded', { output });
    } catch (err) {
      const output = err.output || undefined;
      if (err.state === 'Internal.Aborted') {
        this.transition('ExecutionAborted', { output });
      }
      if (err.state === 'States.Timeout') {
        this.transition('ExecutionTimedOut', { output });
      }
      this.transition('ExecutionFailed', { output, error: err });
    }
  }

  /**
   * getExecutionResult
   *
   * should be executed after an execution was made. this will return the value of the statemachine if it ends.
   *
   * @access public
   * @returns {any}
   */
  getExecutionResult() {
    return this.steps.pop().output;
  }

  /**
   * bindTaskResource
   *
   * binds a function that a Task can use as it's resource
   *
   * @access public
   * @param {string} key Task Name
   * @param {function} fn The function to be called. usually a serverless handler
   */
  bindTaskResource(task, fn) {
    this.Resources[task] = fn;
  }

  /**
   * inputPath
   *
   * modifies the inputs via the InputPath or Parameters respectively
   *
   * @access private
   * @param {Object} state
   * @param {any} input
   * @param {any} output
   */
  inputPath(state, input) {
    if (state.InputPath) {
      input = jsonpath.query(input, state.InputPath).shift();
    }
    if (state.Parameters) {
      let newInput = {};
      const context = this.getContext();
      Object.keys(state.Parameters)
        .filter((parameter) => parameter !== 'comment')
        .map((parameter) => {
          if (typeof state.Parameters[parameter] === 'object') {
            newInput[parameter] = {};
            Object.keys(state.Parameters[parameter]).map((key) => {
              if (
                key.includes('.$') &&
                !state.Parameters[parameter][key].includes('$$.')
              ) {
                newInput[parameter][key.replace('.$', '')] = jsonpath
                  .query(input, state.Parameters[parameter][key])
                  .shift();
              } else if (
                key.includes('.$') &&
                state.Parameters[parameter][key].includes('$$.')
              ) {
                newInput[parameter][key.replace('.$', '')] = jsonpath
                  .query(
                    context,
                    state.Parameters[parameter][key].replace('$$.', '$.'),
                  )
                  .shift();
              } else {
                newInput[parameter][key] = state.Parameters[parameter][key];
              }
            });
          } else if (
            parameter.includes('.$') &&
            !state.Parameters[parameter].includes('$$.')
          ) {
            newInput[parameter.replace('.$', '')] = jsonpath
              .query(input, state.Parameters[parameter])
              .shift();
          } else if (
            parameter.includes('.$') &&
            state.Parameters[parameter].includes('$$.')
          ) {
            newInput[parameter.replace('.$', '')] = jsonpath
              .query(context, state.Parameters[parameter].replace('$$.', '$.'))
              .shift();
          } else {
            newInput[parameter] = state.Parameters[parameter];
          }
        });
      return newInput;
    }
    return input;
  }

  /**
   * outputPath
   *
   * modifies the result via the ResultPath and OutputPath respectively
   *
   * @access private
   * @param {Object} state
   * @param {any} input
   * @param {any} output
   */
  outputPath(state, input, output) {
    if (typeof input !== 'object' && !Array.isArray(input)) {
      throw new ErrorState(ErrorState.Runtime, 'input is not an object');
    }
    if (state.ResultPath) {
      const originalValue = jsonpath.query(input, state.ResultPath).shift();
      jsonpath.value(input, state.ResultPath, output || originalValue);
      output = input;
    }
    if (state.OutputPath) {
      output = jsonpath.query(output, state.OutputPath).shift();
    }
    return output;
  }

  /**
   * step
   *
   * recursive function that runs through the statemachine definition
   *
   * @access private
   * @param {string} task
   * @param {any} input
   * @param {Object} states
   */
  async step(task, input, states) {
    const originalInput = input;
    const state = states[task];
    try {
      if (state === undefined) {
        throw new ErrorState(ErrorState.Runtime, 'state not defined');
      }
      if (state.Type === 'Map') {
        return this.map(state, task, input, states);
      } else if (state.Type === 'Parallel') {
        return this.parallel(state, task, input, states);
      } else {
        this.createContext(state, task, input);
        input = this.inputPath(state, input);
      }
      if (state.Type === 'Task') {
        const output = await this.task(state, task, input, states);
        return this.outputPath(state, originalInput, output);
      }
      if (state.Type === 'Choice') {
        const output = await this.choice(state, task, input, states);
        return this.outputPath(state, input, output);
      }
      if (state.Type === 'Pass') {
        let output = await this.pass(state, task, input, states);
        return this.outputPath(state, input, output);
      }
      if (state.Type === 'Fail') {
        return this.fail(state, task, input);
      }
      if (state.Type === 'Succeed') {
        return this.succeed(state, task, input);
      }
      if (state.Type === 'Wait') {
        const output = await this.wait(state, task, input, states);
        return this.outputPath(state, input, output);
      }
    } catch (err) {
      if (state && ['Task', 'Parallel'].includes(state.Type)) {
        // if (err.state === ErrorState.TaskFailed && state.Retry) {
        //   return this.retry(state.Retry, input, states);
        // }
        if (state.Catch) {
          err.output = await this.finally(state.Catch, input, states, err);
        }
      }
      throw err;
    }
  }

  /**
   * task
   *
   * an AWS Step function Task definition
   *
   * @access private
   * @param {Object} state
   * @param {string} task
   * @param {any} input
   * @param {Object} states
   */
  async task(state, task, input, states) {
    try {
      this.transition('TaskStateEntered', { task, input });
      const output = await this.resolveResource(task, input, states);
      this.transition('TaskStateExited', { task, output });
      if (state.Next) {
        return this.step(state.Next, output, states);
      }
      return output; // End: true
    } catch (err) {
      if (err.state === 'Internal.Aborted') {
        this.transition('TaskStateAborted', { task });
      }
      this.transition('TaskStateFailed', { task, error: err });
      this.transition('TaskStateExited', { task });
      throw new ErrorState(ErrorState.TaskFailed, 'TaskFailed', err);
    }
  }

  /**
   * map
   *
   * an AWS Step function Map definition
   *
   * @access private
   * @param {Object} state
   * @param {string} task
   * @param {any} input
   * @param {Object} states
   */
  async map(state, task, input, states) {
    this.transition('MapStateEntered', { task, input });
    try {
      const output = [];
      let index = 0;
      if (state.ItemsPath) {
        input = jsonpath.query(input, state.ItemsPath).shift();
        if (!input) {
          input = [];
        }
      }
      this.transition('MapStateStarted', { task, length: input.length });
      for (let payload of input) {
        this.transition('MapIterationStarted', { task, index, input: payload });
        this.createContext(state, task, payload, index);
        payload = this.inputPath(state, payload);
        const result = await this.step(
          state.Iterator.StartAt,
          payload,
          state.Iterator.States,
        );
        output.push(this.outputPath(state, payload, result));
        this.transition('MapIterationSucceeded', { task, index });
        index++;
      }
      this.transition('MapStateSucceeded', { task });
      this.transition('MapStateExited', { task, output });
      if (state.Next) {
        return this.step(state.Next, output, states);
      }
      return output;
    } catch (err) {
      if (err.state === 'Internal.Aborted') {
        this.transition('MapStateAborted', { task });
      }
      this.transition('MapStateFailed', { task, error: err });
      this.transition('MapStateExited', { task });
      throw new ErrorState(ErrorState.All, 'MapStateFailed', err);
    }
  }

  /**
   * parallel
   *
   * an AWS Step function Parallel definition
   *
   * @access private
   * @param {Object} state
   * @param {string} task
   * @param {any} input
   * @param {Object} states
   */
  async parallel(state, task, input, states) {
    this.transition('ParallelStateEntered', { task, input });
    try {
      let output = [];
      while (state.Branches.length) {
        const result = await Promise.all(
          state.Branches.splice(0, this.runtime.maxConcurrency).map(
            (branch) => {
              this.createContext(branch, task, input);
              input = this.inputPath(branch, input);
              this.transition('ParallelStateStarted', {
                task: branch.StartAt,
                input,
              });
              const output = this.step(branch.StartAt, input, branch.States);
              return this.outputPath(branch, input, output);
            },
          ),
        );
        output = [...output, ...result];
      }
      this.transition('ParallelStateSucceeded', { task });
      this.transition('ParallelStateExited', { task, output });
      if (state.Next) {
        return this.step(state.Next, output, states);
      }
      return output;
    } catch (err) {
      if (err.state === 'Internal.Aborted') {
        this.transition('ParallelStateAborted', { task, input });
      }
      this.transition('ParallelStateExited', { task, input, error: err });
      throw new ErrorState(ErrorState.All, 'ParallelStateFailed', err);
    }
  }

  /**
   * choice
   *
   * an AWS Step function Choice definition
   *
   * @access private
   * @param {Object} state
   * @param {string} task
   * @param {any} input
   * @param {Object} states
   */
  async choice(state, task, input, states) {
    try {
      this.transition('ChoiceStateEntered', { task, input });
      for (let choice of state.Choices) {
        if (this.compare(choice, input) === true) {
          this.transition('ChoiceStateExited', { task, output: input });
          if (choice.Next) {
            return this.step(choice.Next, input, states);
          }
          throw new ErrorState(ErrorState.Runtime, 'No next state');
        }
      }
      if (state.Default) {
        this.transition('ChoiceStateExited', { task, output: input });
        return this.step(state.Default, input, states);
      }
      throw new ErrorState(ErrorState.Runtime, 'No default state');
    } catch (err) {
      this.transition('ChoiceStateFailed', { task, error: err });
      this.transition('ChoiceStateExited', { task });
      throw new ErrorState(ErrorState.All, 'ChoiceStateFailed', err);
    }
  }

  /**
   * choice
   *
   * Determine the operations required for the Choice step
   *
   * @access private
   * @param {Object} choice
   * @param {Object} input
   */
  compare(choice, input) {
    choice = { ...choice }; // because `choice` leaks
    if (choice.And) {
      return (
        choice.And.filter((and) => this.compare(and, input)).length ===
        choice.And.length
      );
    }
    if (choice.Or) {
      return choice.Or.filter((or) => this.compare(or, input)).length > 1;
    }
    if (choice.Not) {
      const comparison = this.compare(choice.Not, input);
      return comparison !== undefined ? !comparison : false;
    }

    let variable = jsonpath.query(input, choice.Variable).shift();
    if (variable === undefined) {
      return undefined;
    }
    const operator = comparators.filter((operator) =>
      Object.keys(choice).includes(operator),
    ).shift();

    let result;
    if (operator.includes('Boolean') && typeof variable === 'boolean') {
      result =
        operator === 'BooleanEquals' && Boolean(variable) === choice[operator];
    }
    if (
      (operator.includes('Numeric') && typeof variable === 'number') ||
      (operator.includes('String') && typeof variable === 'string') ||
      (operator.includes('Timestamp') && new Date(variable).getTime() > 0)
    ) {
      if (operator.includes('Timestamp')) {
        variable = new Date(variable).getTime();
        choice[operator] = new Date(choice[operator]).getTime();
      }
      switch (operator) {
        case 'NumericEquals':
        case 'TimestampEquals':
          result = variable === choice[operator];
          break;
        case 'NumericGreaterThan':
        case 'TimestampGreaterThan':
          result = variable > choice[operator];
          break;
        case 'NumericGreaterThanEquals':
        case 'TimestampGreaterThanEquals':
          result = variable >= choice[operator];
          break;
        case 'NumericLessThan':
        case 'TimestampLessThan':
          result = variable < choice[operator];
          break;
        case 'NumericLessThanEquals':
        case 'TimestampLessThanEquals':
          result = variable <= choice[operator];
          break;
        case 'StringEquals':
          result = String(variable).localeCompare(choice[operator]) === 0;
          break;
        case 'StringGreaterThan':
          result = String(variable).localeCompare(choice[operator]) > 0;
          break;
        case 'StringGreaterThanEquals':
          result = String(variable).localeCompare(choice[operator]) >= 0;
          break;
        case 'StringLessThan':
          result = String(variable).localeCompare(choice[operator]) < 0;
          break;
        case 'StringLessThanEquals':
          result = String(variable).localeCompare(choice[operator]) <= 0;
          break;
      }
    }
    return result;
  }

  /**
   * pass
   *
   * an AWS Step function Pass definition
   *
   * @access private
   * @param {Object} state
   * @param {string} task
   * @param {any} input
   * @param {Object} states
   */
  async pass(state, task, input, states) {
    this.transition('PassStateEntered', { task, input });
    this.transition('PassStateExited', { task, output: input });
    if (state.Next) {
      return this.step(state.Next, input, states);
    }
    return input;
  }

  /**
   * fail
   *
   * an AWS Step function Fail definition
   *
   * @access private
   * @param {Object} state
   * @param {string} task
   * @param {any} input
   */
  async fail(state, task, input) {
    this.transition('FailStateEntered', { task, input });
    throw new ErrorState(ErrorState.TaskFailed, 'TaskFailed');
  }

  /**
   * succeed
   *
   * an AWS Step function Succeed definition
   *
   * @access private
   * @param {Object} state
   * @param {string} task
   * @param {any} input
   */
  async succeed(state, task, input) {
    this.transition('SucceedStateEntered', { task, input });
    this.transition('SucceedStateExited', { task, input });
    return input;
  }

  async retry(state, input, states) {
    try {

    } catch (err) {
      if (err) {
        // can still retry, get retry context
        return this.retry(state, input, states);
      }
      if (state.Catch) {
        return this.finally(state, input, states, err);
      }
      throw err;
    }
  }

  /**
   * finally
   *
   * an AWS Step function Catch definition
   *
   * @access private
   * @param {Object} states
   * @param {any} input
   * @param {Object} originalState
   * @param {Error} error
   */
  async finally(states, input, originalState, error) {
    for (let state of states) {
      const errors = state.ErrorEquals.filter(err => {
        // handled error
        if (error.toString().includes(err) || error.original.constructor.name.includes(err) || (error.original && error.original.toString().includes(err))) {

          return true;
        }
        if (error.toString().includes('Lambda.')) {
          return true;
        }
        if (error.toString().includes('TaskFailed') && err.state === ErrorState.TaskFailed) {
          return true;
        }
        if (error.toString().includes('Timeout') && err.state === ErrorState.Timeout) {
          return true;
        }
        if (err === ErrorState.ALL ||
          error.toString().includes('Lambda.') ||
          (error.toString().includes(err) || error.original.constructor.name.includes(err) || (error.original && error.original.toString().includes(err))) ||
          (error.toString().includes('TaskFailed') && err.state === ErrorState.TaskFailed) ||
          (error.toString().includes('Timeout') && err.state === ErrorState.Timeout)
        ) {
          return true;
        }
        // TODO: not comprehensive error set
        if (err === ErrorState.Runtime && (error.original && !!error.original.toString().match(/States.Runtime|Eval|Type|Syntax|URI|Range|Error|parse|Reference|undefined|of null|read property|JSON/g))) {
          return true;
        }
        return false;
      });
      if (errors.length > 0) {
        const errorType = errors.shift();
        const output = this.outputPath(state, input, {
          Error: errorType,
          Cause: { errorMessage: error.message, errorType, stackTrace: error.stack },
        });
        return this.step(state.Next, output, originalState);
      }
    }
    throw new ErrorState(ErrorState.ALL, 'ExecutionFailed');
  }

  /**
   * wait
   *
   * an AWS Step function Wait definition
   *
   * @access private
   * @param {Object} state
   * @param {string} task
   * @param {any} input
   * @param {Object} states
   */
  async wait(state, task, input, states) {
    try {
      this.transition('WaitStateEntered', { task, input });
      const respectTime = this.runtime.respectTime;
      const maxWaitTime = this.runtime.maxWaitTime;
      if (state.SecondsPath) {
        state.Seconds = jsonpath.query(input, state.SecondsPath).shift();
      }
      if (state.Seconds) {
        let lifetime =
          respectTime && state.Seconds > maxWaitTime
            ? maxWaitTime
            : state.Seconds;
        await new Promise((resolve) => {
          setTimeout(() => resolve(), lifetime * 1000);
        });
      }
      if (state.TimestampPath) {
        state.Timestamp = jsonpath.query(input, state.TimestampPath).shift();
      }
      if (state.Timestamp) {
        let timeout, interval;
        if (!respectTime) {
          timeout = setTimeout(() => {
            clearTimeout(timeout);
            clearInterval(interval);
            throw new ErrorState(ErrorState.Timeout, 'Task timed out');
          }, maxWaitTime * 1000);
        }
        await new Promise((resolve) => {
          interval = setInterval(() => {
            if (new Date() >= new Date(state.Timestamp)) {
              clearTimeout(timeout);
              clearInterval(interval);
              resolve();
            }
          }, 500);
        });
      }
      return this.step(state.Next, input, states);
    } catch (err) {
      if (err.state === 'Internal.Aborted') {
        this.transition('WaitStateAborted', { task, input });
      }
      this.transition('WaitStateExited', { task, input, error: err });
      throw new ErrorState(ErrorState.All, 'WaitStateFailed', err);
    }
  }

  /**
   * abort
   *
   * aborts a running statemachine. useful when using Wait
   *
   * @access private
   * @param {boolean} state
   */
  abort() {
    if (this.steps.length > 0) {
      throw new ErrorState('Internal.Aborted', 'Aborted');
    }
  }

  /**
   * elapsed
   *
   * keeps a reference of the timings when called
   *
   * @access private
   * @param {boolean} state
   */
  elapsed(reset = false) {
    if (reset) {
      this._elapsedRef = performance.now();
    }
    const diff = Math.round((performance.now() - this._elapsedRef) * 100);
    this.stopwatch.push(diff);
    return diff;
  }

  /**
   * _refresh
   *
   * refreshes all internal class properties
   *
   * @access private
   */
  refresh() {
    this.runtime = {};
    this.stopwatch = [];
    this._elapsedRef = null;
    this.elapsed(true);

    this.transitions = 0;
    this.steps = [];

    this._current = {
      id: this.Name,
      increment: 0,
      state: '',
      step: {},
      elapsed: 0,
      timestamp: '',
      input: {},
      output: {},
      index: null,
      length: 0,
      error: null,
      retries: 0,
    };
  }

  /**
   * _transition
   *
   * keeps track of the internal state when transitioning
   *
   * @access private
   * @param {string} label the AWS designated states for each function in the statemachine
   * @param {Object} state
   */
  transition(label, state) {
    this.transitions += 1;
    this._current = {
      increment: this.transitions,
      state: label,
      step: state.task,
      elapsed: this.elapsed(),
      timestamp: new Date(),
      input: state.input,
      output: state.output,
      index: state.index,
      length: state.length,
      error: state.error,
      retries: state.retries,
    };
    this.steps.push(this._current);
    this.emit(label, this._current);
  }

  /**
   * createContext
   *
   * Creates a context object that is accessible via Parameters
   *
   * @access private
   * @param {Object} state
   * @param {string} task
   * @param {any} input
   */
  createContext(state, task, input, index = null) {
    const id = +new Date();
    this._current.context = {
      Execution: {
        Id: `arn:aws:states:ap-southeast-1:123456789012:execution:stateMachineName:${id}`,
        Input: input,
        Name: +new Date(),
        RoleArn: 'arn:aws:iam::123456789012:role...',
        StartTime: new Date().toISOString(),
      },
      State: {
        EnteredTime: new Date().toISOString(),
        Name: task,
        RetryCount: this._current.retries || 0,
      },
      StateMachine: {
        Id:
          'arn:aws:states:ap-southeast-1:123456789012:stateMachine:stateMachineName',
        Name: this.Name,
      },
      Task: {
        Token: null,
      },
      Map: {
        Item: {
          Index: index,
          Value: this._current.input || null,
        },
      },
    };
  }

  /**
   * getContext
   *
   * @access private
   */
  getContext() {
    return this._current.context;
  }

  /**
   *_resolveResource
   *
   * resolves the resource needed for a Task
   *
   * @access private
   * @param {string} task
   * @param {any} input
   * @param {Object} states
   */
  async resolveResource(task, input, states) {
    // is it a Lambda ARN?
    if (states[task].Resource) {
      return this.executeLambda(task, input);
    }
  }

  /**
   * executeLambda
   *
   * a simulator for executing lambda functions
   *
   * @access private
   * @param {string} task
   * @param {any} input
   */
  async executeLambda(task, input) {
    this.transition('LambdaFunctionScheduled', { task, input });
    this.transition('LambdaFunctionStarted', { task, input });
    let output;
    try {
      const taskFn = this.Resources[task];
      if (typeof taskFn === 'function') {
        output = await taskFn.call(
          { ...taskFn.prototype, abort: this.abort },
          input,
        );
      } else {
        output = input;
      }
      this.transition('LambdaFunctionSucceeded', { task, output });
    } catch (err) {
      this.transition('LambdaFunctionFailed', { task, error: err });
      throw err;
    }
    return output;
  }
}

module.exports = StepFunction;
