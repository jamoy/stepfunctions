const { performance } = require('perf_hooks');
const dotProp = require('dot-prop');
const aslValidator = require('asl-validator');

class StepFunction {
  /**
   * @typedef opts
   * @type {Object}
   * @property {string} name
   * @property {Object} statemachine
   * @property {Object} resolvers
   */

  /**
   * constructor
   *
   * @access public
   * @param {opts} sm
   */
  constructor(sm) {
    const { isValid, errorsText } = aslValidator(sm.statemachine);
    if (!isValid) {
      throw new Error(errorsText());
    }

    this.name = sm.name || sm.statemachine.StartAt;
    this.statemachine = sm.statemachine;
    this.resolvers = typeof sm.resolvers === 'object' ? sm.resolvers : {};

    this._refresh();
  }

  /**
   * startExecution
   *
   * start an execution of a defined statemachine.
   *
   * @access public
   * @param {any} input an input that will be passed to the first task
   */
  async startExecution(input) {
    this._refresh();
    this._transition('ExecutionStarted', { input });
    try {
      const output = await this._step(
        this.statemachine.StartAt,
        input,
        this.statemachine.States,
      );
      this._transition('ExecutionSucceeded', { output });
    } catch (err) {
      this._transition('ExecutionFailed', {});
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
  async getExecutionResult() {
    return this.steps
      .filter((step) => step.state === 'ExecutionSucceeded')
      .map((step) => step.output);
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
    this.resolvers[task] = fn;
  }

  /**
   * _step
   *
   * recursive function that runs through the statemachine definition
   *
   * @access private
   * @param {string} task
   * @param {any} input
   * @param {Object} states
   */
  async _step(task, input, states) {
    const state = states[task];
    if (state.Type === 'Task') {
      return this._task(state, task, input, states);
    }
    if (state.Type === 'Map') {
      return this._map(state, task, input, states);
    }
    if (state.Type === 'Choice') {
      return this._choice(state, task, input, states);
    }
    if (state.Type === 'Pass') {
      return this._pass(state, task, input, states);
    }
  }

  /**
   * _task
   *
   * an AWS Step function Task definition
   *
   * @access private
   * @param {Object} state
   * @param {string} task
   * @param {any} input
   * @param {Object} states
   */
  async _task(state, task, input, states) {
    try {
      this._transition('TaskStateEntered', { task, input });
      const output = await this._resolveResource(task, input, states);
      this._transition('TaskStateExited', { task, output });
      if (state.Next) {
        return this._step(state.Next, output, states);
      }
      return output; // End: true
    } catch (err) {
      this._transition('TaskStateFailed', { task });
      this._transition('TaskStateExited', { task });
      throw err;
    }
  }

  /**
   * _map
   *
   * an AWS Step function Map definition
   *
   * @access private
   * @param {Object} state
   * @param {string} task
   * @param {any} input
   * @param {Object} states
   */
  async _map(state, task, input, states) {
    this._transition('MapStateEntered', { task, input });
    if (state.InputPath) {
      input = dotProp.get(input, state.InputPath.replace('$.', ''));
    }
    if (state.ItemsPath) {
      input = dotProp.get(input, state.ItemsPath.replace('$.', ''));
    }
    try {
      const output = [];
      let index = 0;
      this._transition('MapStateStarted', { task, length: input.length });
      for (let payload of input) {
        this._transition('MapIterationStarted', { task, index });
        const result = await this._step(
          state.Iterator.StartAt,
          payload,
          state.Iterator.States,
        );
        output.push(result);
        this._transition('MapIterationSucceeded', { task, index });
        index++;
      }
      this._transition('MapStateSucceeded', { task });
      this._transition('MapStateExited', { task, output });
      if (state.Next) {
        return this._step(state.Next, output, states);
      }
      return output;
    } catch (err) {
      this._transition('MapStateFailed', { task });
      this._transition('MapStateExited', { task });
      throw err;
    }
  }

  /**
   * _choice
   *
   * an AWS Step function Choice definition
   *
   * @access private
   * @param {Object} state
   * @param {string} task
   * @param {any} input
   * @param {Object} states
   */
  async _choice(state, task, input, states) {
    try {
      this._transition('ChoiceStateEntered', { task, input });
      for (let choice of state.Choices) {
        const variable = dotProp.get(input, choice.Variable.replace('$.', ''));
        // TODO: need to support AND
        this._transition('ChoiceStateExited', { task, output: input });
        if (variable > choice.NumericGreaterThan) {
          return this._step(choice.Next, input, states); // Next is always required
        } else {
          return this._step(state.Default, input, states);
        }
      }
    } catch (err) {
      this._transition('ChoiceStateFailed', { task });
      this._transition('ChoiceStateExited', { task });
      throw err;
    }
  }

  /**
   * _pass
   *
   * an AWS Step function Pass definition
   *
   * @access private
   * @param {Object} state
   * @param {string} task
   * @param {any} input
   * @param {Object} states
   */
  async _pass(state, task, input, states) {
    this._transition('PassStateEntered', { task, input });
    this._transition('PassStateExited', { task, output: input });
    if (state.Next) {
      return this._step(state.Next, input, states);
    }
    return input;
  }

  /**
   * _elapsed
   *
   * keeps a reference of the timings when called
   *
   * @access private
   * @param {boolean} state
   */
  _elapsed(reset = false) {
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
  _refresh() {
    this.stopwatch = [];
    this._elapsedRef = null;
    this._elapsed(true);

    this.transitions = 0;
    this.steps = [];

    this._current = {
      id: this.id,
      increment: 0,
      state: '',
      previousStep: {},
      step: {},
      nextStep: {},
      elapsed: 0,
      timestamp: '',
      input: {},
      output: {},
      index: null,
      length: 0,
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
  _transition(label, state) {
    this.transitions += 1;
    this._current = {
      increment: this.transitions,
      state: label,
      step: state.task,
      elapsed: this._elapsed(),
      timestamp: new Date(),
      input: state.input,
      output: state.output,
      index: state.index,
      length: state.length,
    };
    this.steps.push(this._current);
  }

  /**
   * _resolveResource
   *
   * resolves the resource needed for a Task
   *
   * @access private
   * @param {string} task
   * @param {any} input
   * @param {Object} states
   */
  async _resolveResource(task, input, states) {
    if (states[task].Resource) {
      // it's a lambda
      return this._executeLambda(task, input);
    }
  }

  /**
   * _executeLambda
   *
   * a simulator for executing lambda functions
   *
   * @access private
   * @param {string} task
   * @param {any} input
   */
  async _executeLambda(task, input) {
    this._transition('LambdaFunctionScheduled', { task, input });
    this._transition('LambdaFunctionStarted', { task, input });
    let output;
    const taskFn = this.resolvers[task];
    if (typeof taskFn === 'function') {
      output = await taskFn(input);
    }
    // TODO: support sls invoke local
    this._transition('LambdaFunctionSucceeded', { task, output });
    return output;
  }
}

module.exports = StepFunction;
