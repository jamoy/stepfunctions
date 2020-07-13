const { performance } = require('perf_hooks');
const dotProp = require('dot-prop');
const aslValidator = require('asl-validator');

class Sf {
  constructor(sm) {
    const { isValid, errorsText } = aslValidator(sm.statemachine);
    if (!isValid) {
      throw new Error(errorsText());
    }

    this.name = sm.name || sm.statemachine.StartAt;
    this.statemachine = sm.statemachine;
    this.resolvers = sm.resolvers;
    this.stopwatch = [];

    this._elapsedRef = null;
    this.refresh();
  }

  bindResolver(key, fn) {
    this.resolvers[key] = fn;
  }

  refresh() {
    this._elapsedRef = null;
    this.stopwatch = [];
    this.elapsed(true);

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
    };
    this.steps.push(this._current);
  }

  async startExecution(input) {
    this.refresh();
    this.transition('ExecutionStarted', { input });
    try {
      const output = await this.step(
        this.statemachine.StartAt,
        input,
        this.statemachine.States,
      );
      this.transition('ExecutionSucceeded', { output });
    } catch (err) {
      this.transition('ExecutionFailed', {});
      throw err;
    }
  }

  async step(task, input, states) {
    const state = states[task];
    if (state.Type === 'Task') {
      try {
        this.transition('TaskStateEntered', { task, input });
        const output = await this._resolveResource(task, input, states);
        this.transition('TaskStateExited', { task, output });
        if (state.Next) {
          return this.step(state.Next, output, states);
        }
        return output; // End: true
      } catch (err) {
        this.transition('TaskStateFailed', { task });
        this.transition('TaskStateExited', { task });
        throw err;
      }
    }
    if (state.Type === 'Map') {
      this.transition('MapStateEntered', { task, input });
      if (state.InputPath) {
        input = dotProp.get(input, state.InputPath.replace('$.', ''));
      }
      if (state.ItemsPath) {
        input = dotProp.get(input, state.ItemsPath.replace('$.', ''));
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
        this.transition('MapStateFailed', { task });
        this.transition('MapStateExited', { task });
        throw err;
      }
    }
    if (state.Type === 'Choice') {
      this.transition('ChoiceStateEntered', { task, input });
      for (let choice of state.Choices) {
        const variable = dotProp.get(input, choice.Variable.replace('$.', ''));
        // TODO: need to support AND
        this.transition('ChoiceStateExited', { task, output: input });
        if (variable > choice.NumericGreaterThan) {
          return this.step(choice.Next, input, states); // Next is always required
        } else {
          return this.step(state.Default, input, states);
        }
      }
    }
    if (state.Type === 'Pass') {
      this.transition('PassStateEntered', { task, input });
      this.transition('PassStateExited', { task, output: input });
      if (state.Next) {
        return this.step(state.Next, input, states);
      }
      return input;
    }
  }

  elapsed(reset = false) {
    if (reset) {
      this._elapsedRef = performance.now();
    }
    const diff = Math.round((performance.now() - this._elapsedRef) * 100);
    this.stopwatch.push(diff);
    return diff;
  }

  async _resolveResource(task, input, states) {
    if (states[task].Resource) {
      // it's a lambda
      return this._executeLambda(task, input);
    }
  }

  async _executeLambda(task, input) {
    const taskFn = this.resolvers[task];
    this.transition('LambdaFunctionScheduled', { task, input });
    this.transition('LambdaFunctionStarted', { task, input });
    let output;
    if (typeof taskFn === 'function') {
      output = await taskFn(input);
    }
    // TODO: support sls invoke local
    this.transition('LambdaFunctionSucceeded', { task, output });
    return output;
  }
}

module.exports = Sf;
