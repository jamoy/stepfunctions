const EventEmitter = require('events').EventEmitter;
const { performance } = require('perf_hooks');
const jsonpath = require('jsonpath');
const aslValidator = require('asl-validator');

const COMPARISONS = [
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
      if (err.message === 'ABORT') {
        this.transition('ExecutionAborted', {});
      }
      if (err.message === 'TIMEOUT') {
        this.transition('ExecutionTimedOut', {});
      }
      this.transition('ExecutionFailed', {});
      throw err;
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
    const state = states[task];
    if (state === undefined) {
      throw new Error('State is undefined');
    }
    if (state.Type === 'Task') {
      return this.task(state, task, input, states);
    }
    if (state.Type === 'Parallel') {
      return this.parallel(state, task, input, states);
    }
    if (state.Type === 'Map') {
      return this.map(state, task, input, states);
    }
    if (state.Type === 'Choice') {
      return this.choice(state, task, input, states);
    }
    if (state.Type === 'Pass') {
      return this.pass(state, task, input, states);
    }
    if (state.Type === 'Fail') {
      return this.fail(state, task, input);
    }
    if (state.Type === 'Succeed') {
      return this.succeed(state, task, input);
    }
    if (state.Type === 'Wait') {
      return this.wait(state, task, input, states);
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
      if (err.message === 'ABORT') {
        this.transition('TaskStateAborted', { task });
      }
      this.transition('TaskStateFailed', { task });
      this.transition('TaskStateExited', { task });
      throw err;
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
    if (state.InputPath) {
      input = jsonpath.query(input, state.InputPath).pop();
    }
    if (state.ItemsPath) {
      input = jsonpath.query(input, state.ItemsPath).pop();
    }
    if (!input) {
      input = [];
    }
    try {
      const output = [];
      let index = 0;
      this.transition('MapStateStarted', { task, length: input.length });
      for (let payload of input) {
        this.transition('MapIterationStarted', { task, index });
        const result = await this.step(
          state.Iterator.StartAt,
          payload,
          state.Iterator.States,
        );
        output.push(result);
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
      if (err.message === 'ABORT') {
        this.transition('MapStateAborted', { task });
      }
      this.transition('MapStateFailed', { task });
      this.transition('MapStateExited', { task });
      throw err;
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
              this.transition('ParallelStateStarted', {
                task: branch.StartAt,
                input,
              });
              return this.step(branch.StartAt, input, branch.States);
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
      if (err.message === 'ABORT') {
        this.transition('ParallelStateAborted', { task, input });
      }
      this.transition('ParallelStateExited', { task, input });
      throw err;
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
          throw new Error('No next state');
        }
      }
      if (state.Default) {
        this.transition('ChoiceStateExited', { task, output: input });
        return this.step(state.Default, input, states);
      }
      throw new Error('No default state');
    } catch (err) {
      this.transition('ChoiceStateFailed', { task });
      this.transition('ChoiceStateExited', { task });
      throw err;
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

    let variable = jsonpath.query(input, choice.Variable).pop();
    if (variable === undefined) {
      return undefined;
    }
    const operator = COMPARISONS.filter((operator) =>
      Object.keys(choice).includes(operator),
    ).pop();

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
    throw new Error('Transitioned to a FAIL state');
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
        state.Seconds = jsonpath.query(input, state.SecondsPath).pop();
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
        state.Timestamp = jsonpath.query(input, state.TimestampPath).pop();
      }
      if (state.Timestamp) {
        let timeout, interval;
        if (!respectTime) {
          timeout = setTimeout(() => {
            clearTimeout(timeout);
            clearInterval(interval);
            throw new Error('TIMEOUT');
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
      if (err.message === 'ABORT') {
        this.transition('WaitStateAborted', { task, input });
      }
      this.transition('WaitStateExited', { task, input });
      throw err;
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
      throw new Error('ABORT');
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
    };
    this.steps.push(this._current);
    this.emit(label, this._current);
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
