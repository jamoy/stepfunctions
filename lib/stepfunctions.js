const EventEmitter = require('events').EventEmitter;
const { performance } = require('perf_hooks');
const crypto = require('crypto');
const jsonpath = require('jsonpath');
const aslValidator = require('asl-validator');

class ErrorState extends Error {
  constructor(state, message, original) {
    super(
      typeof message === 'object' && message.message
        ? message.message
        : message,
    );
    this.state = state;
    this.original = typeof original === 'object' ? original : undefined;
  }
}

// Just to get around 10.x
ErrorState.ALL = 'States.ALL';
ErrorState.Runtime = 'States.Runtime';
ErrorState.Timeout = 'States.Timeout';
ErrorState.TaskFailed = 'States.TaskFailed';
ErrorState.IntrinsicFailure = 'States.IntrinsicFailure';

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
      if (!err.caught) {
        // only throw if it doesnt have a Catch or a Retry handler
        if (err.original && err.original.original) {
          throw err.original.original;
        }
        if (err.original) {
          throw err.original;
        }
        throw err;
      }
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
   * getReport
   *
   * @access public
   * @returns {any}
   */
  getReport() {
    console.table(this.steps);
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
    // `Parameters` (Task/Pass/Parallel) and `ItemSelector` (Map, the newer
    // spelling of a Map's per-item `Parameters`) share the same payload
    // template semantics, evaluated against the (InputPath-narrowed) input.
    const template = state.Parameters || state.ItemSelector;
    if (template) {
      return this.evaluatePayloadTemplate(template, input, this.getContext());
    }
    return input;
  }

  /**
   * evaluatePayloadTemplate
   *
   * Resolves a "Payload Template" (Parameters / ItemSelector / ResultSelector).
   * Keys ending in `.$` are evaluated as a Reference Path, a context-object
   * reference (`$$.`) or an intrinsic function (`States.*`). Nested objects are
   * resolved recursively; every other value is copied verbatim.
   *
   * @access private
   * @param {Object} template
   * @param {any} input
   * @param {Object} context
   * @param {boolean} topLevel
   */
  evaluatePayloadTemplate(template, input, context, topLevel = true) {
    const result = {};
    for (const key of Object.keys(template)) {
      if (topLevel && key === 'comment') {
        continue;
      }
      const value = template[key];
      if (key.endsWith('.$')) {
        result[key.slice(0, -2)] = this.evaluatePayloadValue(
          value,
          input,
          context,
        );
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = this.evaluatePayloadTemplate(
          value,
          input,
          context,
          false,
        );
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  /**
   * evaluatePayloadValue
   *
   * Resolves a single `.$` payload-template value: an intrinsic function, a
   * context-object reference or a Reference Path into the input.
   *
   * @access private
   */
  evaluatePayloadValue(expr, input, context) {
    if (typeof expr !== 'string') {
      return expr;
    }
    if (expr.startsWith('States.')) {
      return this.evaluateIntrinsic(expr, input, context);
    }
    if (expr.startsWith('$$')) {
      return jsonpath.query(context, '$' + expr.slice(2)).shift();
    }
    return jsonpath.query(input, expr).shift();
  }

  /**
   * resultSelector
   *
   * Applies a state's ResultSelector to its raw result. Per the ASL data-flow
   * pipeline this runs before ResultPath and OutputPath.
   *
   * @access private
   * @param {Object} state
   * @param {any} output
   */
  resultSelector(state, output) {
    if (state.ResultSelector) {
      return this.evaluatePayloadTemplate(
        state.ResultSelector,
        output,
        this.getContext(),
      );
    }
    return output;
  }

  /**
   * evaluateIntrinsic
   *
   * Parses and evaluates an intrinsic function expression such as
   * `States.Format('{}', $.x)`.
   *
   * @access private
   */
  evaluateIntrinsic(expr, input, context) {
    const { name, tokens } = this.parseIntrinsic(expr);
    if (name === 'States.Format') {
      return this.intrinsicFormat(tokens, input, context);
    }
    const args = tokens.map((token) =>
      this.evaluateIntrinsicArg(token, input, context),
    );
    return this.applyIntrinsic(name, args);
  }

  /**
   * parseIntrinsic
   *
   * Splits an intrinsic expression into its function name and the list of
   * top-level argument tokens, respecting single-quoted string literals and
   * nested parentheses.
   *
   * @access private
   */
  parseIntrinsic(expr) {
    expr = expr.trim();
    const open = expr.indexOf('(');
    if (open === -1 || !expr.endsWith(')')) {
      throw new ErrorState(
        ErrorState.IntrinsicFailure,
        `Invalid intrinsic function: ${expr}`,
      );
    }
    const name = expr.slice(0, open).trim();
    const argStr = expr.slice(open + 1, -1);
    const tokens = [];
    let current = '';
    let inQuote = false;
    let depth = 0;
    for (let i = 0; i < argStr.length; i++) {
      const ch = argStr[i];
      if (inQuote) {
        if (ch === '\\' && i + 1 < argStr.length) {
          current += ch + argStr[i + 1];
          i++;
          continue;
        }
        if (ch === "'") {
          inQuote = false;
        }
        current += ch;
        continue;
      }
      if (ch === "'") {
        inQuote = true;
        current += ch;
      } else if (ch === '(') {
        depth++;
        current += ch;
      } else if (ch === ')') {
        depth--;
        current += ch;
      } else if (ch === ',' && depth === 0) {
        tokens.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim() !== '') {
      tokens.push(current.trim());
    }
    return { name, tokens };
  }

  /**
   * evaluateIntrinsicArg
   *
   * Resolves a single intrinsic argument token to its runtime value.
   *
   * @access private
   */
  evaluateIntrinsicArg(token, input, context) {
    token = token.trim();
    if (token.startsWith('States.')) {
      return this.evaluateIntrinsic(token, input, context);
    }
    if (token.startsWith('$$')) {
      return jsonpath.query(context, '$' + token.slice(2)).shift();
    }
    if (token.startsWith('$')) {
      return jsonpath.query(input, token).shift();
    }
    if (token.startsWith("'") && token.endsWith("'")) {
      return this.unescapeIntrinsicString(token.slice(1, -1));
    }
    if (token === 'true') return true;
    if (token === 'false') return false;
    if (token === 'null') return null;
    if (token !== '' && !Number.isNaN(Number(token))) {
      return Number(token);
    }
    throw new ErrorState(
      ErrorState.IntrinsicFailure,
      `Invalid intrinsic argument: ${token}`,
    );
  }

  /**
   * unescapeIntrinsicString
   *
   * Unescapes the reserved characters (`\\`, `\'`, `\{`, `\}`) inside an
   * intrinsic string literal.
   *
   * @access private
   */
  unescapeIntrinsicString(str) {
    let out = '';
    for (let i = 0; i < str.length; i++) {
      if (str[i] === '\\') {
        const next = str[i + 1];
        if (next === "'" || next === '{' || next === '}' || next === '\\') {
          out += next;
          i++;
        } else {
          throw new ErrorState(
            ErrorState.Runtime,
            'Invalid escape sequence in intrinsic string',
          );
        }
      } else {
        out += str[i];
      }
    }
    return out;
  }

  /**
   * intrinsicFormat
   *
   * Implements States.Format, handling `{}` placeholders and escaped braces in
   * the template.
   *
   * @access private
   */
  intrinsicFormat(tokens, input, context) {
    const templateToken = tokens[0];
    let template;
    let literal = false;
    if (templateToken.startsWith("'") && templateToken.endsWith("'")) {
      template = templateToken.slice(1, -1);
      literal = true;
    } else {
      template = String(
        this.evaluateIntrinsicArg(templateToken, input, context),
      );
    }
    const values = tokens
      .slice(1)
      .map((token) => this.evaluateIntrinsicArg(token, input, context));
    let out = '';
    let vi = 0;
    for (let i = 0; i < template.length; i++) {
      const ch = template[i];
      if (literal && ch === '\\') {
        const next = template[i + 1];
        if (next === "'" || next === '{' || next === '}' || next === '\\') {
          out += next;
          i++;
          continue;
        }
        throw new ErrorState(
          ErrorState.Runtime,
          'Invalid escape sequence in States.Format template',
        );
      }
      if (ch === '{' && template[i + 1] === '}') {
        if (vi >= values.length) {
          throw new ErrorState(
            ErrorState.IntrinsicFailure,
            'States.Format has more placeholders than arguments',
          );
        }
        out += this.formatScalar(values[vi++]);
        i++;
        continue;
      }
      out += ch;
    }
    if (vi !== values.length) {
      throw new ErrorState(
        ErrorState.IntrinsicFailure,
        'States.Format has more arguments than placeholders',
      );
    }
    return out;
  }

  /**
   * formatScalar
   *
   * Renders a value for interpolation by States.Format.
   *
   * @access private
   */
  formatScalar(value) {
    if (typeof value === 'string') {
      return value;
    }
    if (value === null || typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  }

  /**
   * applyIntrinsic
   *
   * Dispatches an intrinsic function (other than States.Format) to its
   * implementation.
   *
   * @access private
   */
  applyIntrinsic(name, args) {
    const fail = (message) => {
      throw new ErrorState(ErrorState.IntrinsicFailure, message);
    };
    switch (name) {
      case 'States.StringToJson':
        try {
          return JSON.parse(args[0]);
        } catch {
          return fail(`States.StringToJson could not parse: ${args[0]}`);
        }
      case 'States.JsonToString':
        return JSON.stringify(args[0]);
      case 'States.Array':
        return args;
      case 'States.ArrayPartition': {
        const [array, size] = args;
        if (!Array.isArray(array)) {
          return fail('States.ArrayPartition requires an array');
        }
        const chunk = Math.round(size);
        if (!chunk || chunk < 1) {
          return fail('States.ArrayPartition requires a positive chunk size');
        }
        const out = [];
        for (let i = 0; i < array.length; i += chunk) {
          out.push(array.slice(i, i + chunk));
        }
        return out;
      }
      case 'States.ArrayContains': {
        const [array, value] = args;
        if (!Array.isArray(array)) {
          return fail('States.ArrayContains requires an array');
        }
        return array.some((item) => this.deepEquals(item, value));
      }
      case 'States.ArrayRange': {
        const [start, end, step] = args.map((n) => Math.round(n));
        if (!step) {
          return fail('States.ArrayRange requires a non-zero step');
        }
        const out = [];
        if (step > 0) {
          for (let i = start; i <= end; i += step) out.push(i);
        } else {
          for (let i = start; i >= end; i += step) out.push(i);
        }
        if (out.length > 1000) {
          return fail('States.ArrayRange produced more than 1000 items');
        }
        return out;
      }
      case 'States.ArrayGetItem': {
        const [array, index] = args;
        if (!Array.isArray(array)) {
          return fail('States.ArrayGetItem requires an array');
        }
        return array[Math.round(index)];
      }
      case 'States.ArrayLength':
        if (!Array.isArray(args[0])) {
          return fail('States.ArrayLength requires an array');
        }
        return args[0].length;
      case 'States.ArrayUnique': {
        if (!Array.isArray(args[0])) {
          return fail('States.ArrayUnique requires an array');
        }
        const seen = new Set();
        const out = [];
        for (const item of args[0]) {
          const key = JSON.stringify(item);
          if (!seen.has(key)) {
            seen.add(key);
            out.push(item);
          }
        }
        return out;
      }
      case 'States.Base64Encode':
        return Buffer.from(String(args[0]), 'utf8').toString('base64');
      case 'States.Base64Decode':
        return Buffer.from(String(args[0]), 'base64').toString('utf8');
      case 'States.Hash': {
        const [data, algorithm] = args;
        const algorithms = {
          MD5: 'md5',
          'SHA-1': 'sha1',
          'SHA-256': 'sha256',
          'SHA-384': 'sha384',
          'SHA-512': 'sha512',
        };
        const nodeAlgorithm = algorithms[algorithm];
        if (!nodeAlgorithm) {
          return fail(`States.Hash unsupported algorithm: ${algorithm}`);
        }
        return crypto
          .createHash(nodeAlgorithm)
          .update(String(data))
          .digest('hex');
      }
      case 'States.JsonMerge':
        return this.jsonMerge(args[0], args[1], args[2] === true);
      case 'States.MathRandom': {
        const start = Math.round(args[0]);
        const end = Math.round(args[1]);
        const random =
          args[2] === undefined ? Math.random() : this.seededRandom(args[2]);
        return start + Math.floor(random * (end - start));
      }
      case 'States.MathAdd':
        return Math.round(args[0]) + Math.round(args[1]);
      case 'States.StringSplit': {
        const delimiters = new Set(String(args[1]).split(''));
        const out = [];
        let current = '';
        for (const ch of String(args[0])) {
          if (delimiters.has(ch)) {
            if (current !== '') {
              out.push(current);
              current = '';
            }
          } else {
            current += ch;
          }
        }
        if (current !== '') out.push(current);
        return out;
      }
      case 'States.UUID':
        return crypto.randomUUID();
      default:
        return fail(`Unknown intrinsic function: ${name}`);
    }
  }

  /**
   * deepEquals
   *
   * Structural JSON value equality used by array intrinsics.
   *
   * @access private
   */
  deepEquals(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  /**
   * jsonMerge
   *
   * Merges two objects. Shallow by default (ASL's documented behavior); a deep
   * merge is performed when `deep` is true.
   *
   * @access private
   */
  jsonMerge(a, b, deep) {
    const merged = { ...a };
    for (const key of Object.keys(b)) {
      const target = merged[key];
      const source = b[key];
      if (
        deep &&
        target &&
        typeof target === 'object' &&
        !Array.isArray(target) &&
        source &&
        typeof source === 'object' &&
        !Array.isArray(source)
      ) {
        merged[key] = this.jsonMerge(target, source, true);
      } else {
        merged[key] = source;
      }
    }
    return merged;
  }

  /**
   * seededRandom
   *
   * Deterministic PRNG (mulberry32) used by States.MathRandom when a seed is
   * supplied, so repeated evaluations with the same seed are reproducible.
   *
   * @access private
   */
  seededRandom(seed) {
    let t = (seed + 0x6d2b79f5) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
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
    if (
      state.ResultPath !== undefined &&
      typeof input !== 'object' &&
      !Array.isArray(input)
    ) {
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
      } else if (state.Type === 'Task') {
        const output = await this.task(state, task, input, states);
        return this.outputPath(state, originalInput, output);
      } else {
        this.createContext(state, task, input);
        input = this.inputPath(state, input);
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
      if (['Task', 'Parallel'].includes(state.Type) && state.Catch) {
        err.output = await this.finally(state.Catch, input, states, err);
        err.caught = true;
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
    let output = await this.retry(state, input, states, async (retries) => {
      try {
        this.transition('TaskStateEntered', { task, input });
        this.createContext(state, task, input, null, retries);
        // Resolve into a local so the closed-over `input` keeps its original
        // value across retries; otherwise each retry would re-apply Parameters
        // to the previous attempt's transformed input and compound it.
        const stepInput = this.inputPath(state, input);
        const output = await this.resolveResource(task, stepInput, states);
        this.transition('TaskStateExited', { task, output });
        return output;
      } catch (err) {
        if (err.state === 'Internal.Aborted') {
          this.transition('TaskStateAborted', { task });
        }
        this.transition('TaskStateFailed', { task, error: err });
        this.transition('TaskStateExited', { task });
        throw new ErrorState(ErrorState.TaskFailed, 'TaskFailed', err);
      }
    });
    // ResultSelector runs against the raw result, before ResultPath/OutputPath.
    output = this.resultSelector(state, output);
    if (state.Next) {
      return this.step(state.Next, output, states);
    }
    return output; // End: true
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
      // `ItemProcessor` is the newer spelling of `Iterator`; accept either.
      const processor = state.ItemProcessor || state.Iterator;
      let output = [];
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
          processor.StartAt,
          payload,
          processor.States,
        );
        output.push(this.outputPath(state, payload, result));
        this.transition('MapIterationSucceeded', { task, index });
        index++;
      }
      this.transition('MapStateSucceeded', { task });
      this.transition('MapStateExited', { task, output });
      output = this.resultSelector(state, output);
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
      // Iterate over a copy so the (shared, require-cached) Branches array is
      // not drained, which would break a second execution of the same machine.
      const branches = [...state.Branches];
      while (branches.length) {
        const result = await Promise.all(
          branches.splice(0, this.runtime.maxConcurrency).map((branch) => {
            this.createContext(branch, task, input);
            input = this.inputPath(branch, input);
            this.transition('ParallelStateStarted', {
              task: branch.StartAt,
              input,
            });
            return this.step(branch.StartAt, input, branch.States);
          }),
        );
        output = this.outputPath(state, input, [...output, ...result]);
      }
      this.transition('ParallelStateSucceeded', { task });
      this.transition('ParallelStateExited', { task, output });
      output = this.resultSelector(state, output);
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
      // An Or matches when *any* of its rules match.
      return choice.Or.filter((or) => this.compare(or, input)).length > 0;
    }
    if (choice.Not) {
      const comparison = this.compare(choice.Not, input);
      return comparison !== undefined ? !comparison : false;
    }

    const matches = jsonpath.query(input, choice.Variable);
    const present = matches.length > 0;
    const variable = matches.shift();

    // `IsPresent` is the only data-test that is meaningful for an absent field
    // (`IsPresent: false` is true precisely when the field is missing).
    if (choice.IsPresent !== undefined) {
      return present === choice.IsPresent;
    }
    // For every other data-test operator a missing field never matches, so the
    // negated forms (e.g. `IsString: false`) are still false when absent.
    if (choice.IsNull !== undefined) {
      return present && (variable === null) === choice.IsNull;
    }
    if (choice.IsString !== undefined) {
      return present && (typeof variable === 'string') === choice.IsString;
    }
    if (choice.IsNumeric !== undefined) {
      return present && (typeof variable === 'number') === choice.IsNumeric;
    }
    if (choice.IsBoolean !== undefined) {
      return present && (typeof variable === 'boolean') === choice.IsBoolean;
    }
    if (choice.IsTimestamp !== undefined) {
      return present && this.isTimestamp(variable) === choice.IsTimestamp;
    }

    // The remaining operators cannot compare an absent value.
    if (!present || variable === undefined) {
      return undefined;
    }

    if (choice.StringMatches !== undefined) {
      return (
        typeof variable === 'string' &&
        this.stringMatches(choice.StringMatches, variable)
      );
    }

    const literalOperator = [
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
    ]
      .filter((operator) => Object.keys(choice).includes(operator))
      .shift();
    if (literalOperator) {
      return this.compareValues(
        literalOperator,
        variable,
        choice[literalOperator],
      );
    }

    // `*Path` operators compare the variable against the value found at another
    // Reference Path in the same input rather than against a literal.
    const pathOperator = Object.keys(choice)
      .filter((key) => key.endsWith('Path'))
      .shift();
    if (pathOperator) {
      const value = jsonpath.query(input, choice[pathOperator]).shift();
      return this.compareValues(
        pathOperator.replace(/Path$/, ''),
        variable,
        value,
      );
    }

    return undefined;
  }

  /**
   * compareValues
   *
   * Applies a single comparison operator to a variable and a value. Shared by
   * the literal operators and their `*Path` counterparts.
   *
   * @access private
   * @param {string} operator
   * @param {any} variable
   * @param {any} value
   */
  compareValues(operator, variable, value) {
    let result;
    if (operator.includes('Boolean') && typeof variable === 'boolean') {
      result = operator === 'BooleanEquals' && Boolean(variable) === value;
    }
    if (
      (operator.includes('Numeric') && typeof variable === 'number') ||
      (operator.includes('String') && typeof variable === 'string') ||
      (operator.includes('Timestamp') && new Date(variable).getTime() > 0)
    ) {
      if (operator.includes('Timestamp')) {
        variable = new Date(variable).getTime();
        value = new Date(value).getTime();
      }
      switch (operator) {
        case 'NumericEquals':
        case 'TimestampEquals':
          result = variable === value;
          break;
        case 'NumericGreaterThan':
        case 'TimestampGreaterThan':
          result = variable > value;
          break;
        case 'NumericGreaterThanEquals':
        case 'TimestampGreaterThanEquals':
          result = variable >= value;
          break;
        case 'NumericLessThan':
        case 'TimestampLessThan':
          result = variable < value;
          break;
        case 'NumericLessThanEquals':
        case 'TimestampLessThanEquals':
          result = variable <= value;
          break;
        case 'StringEquals':
          result = String(variable).localeCompare(value) === 0;
          break;
        case 'StringGreaterThan':
          result = String(variable).localeCompare(value) > 0;
          break;
        case 'StringGreaterThanEquals':
          result = String(variable).localeCompare(value) >= 0;
          break;
        case 'StringLessThan':
          result = String(variable).localeCompare(value) < 0;
          break;
        case 'StringLessThanEquals':
          result = String(variable).localeCompare(value) <= 0;
          break;
      }
    }
    return result;
  }

  /**
   * isTimestamp
   *
   * Reports whether a value is a valid RFC3339-profile timestamp string (the
   * format accepted by the Timestamp* and IsTimestamp Choice operators).
   *
   * @access private
   */
  isTimestamp(value) {
    return (
      typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(
        value,
      ) &&
      !Number.isNaN(Date.parse(value))
    );
  }

  /**
   * stringMatches
   *
   * Glob-style matching for the StringMatches Choice operator. `*` matches zero
   * or more characters; `\\*` matches a literal `*` and `\\\\` a literal
   * backslash. No other character is special.
   *
   * @access private
   */
  stringMatches(pattern, value) {
    const escapeRe = (ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let regex = '^';
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i];
      if (ch === '\\') {
        const next = pattern[i + 1];
        if (next === '*' || next === '\\') {
          regex += escapeRe(next);
          i++;
        } else {
          throw new ErrorState(
            ErrorState.Runtime,
            'Invalid escape sequence in StringMatches pattern',
          );
        }
      } else if (ch === '*') {
        regex += '.*';
      } else {
        regex += escapeRe(ch);
      }
    }
    regex += '$';
    return new RegExp(regex).test(value);
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

  /**
   * canCatch
   *
   * @access private
   * @param {Object} states
   * @param {any} input
   * @param {Object} originalState
   * @param {Error} error
   */
  canCatch(states, input, originalState, error) {
    for (let state of states) {
      const errors = state.ErrorEquals.filter((err) => {
        // handled error
        if (
          error.toString().includes(err) ||
          (error.original && error.original.toString().includes(err)) ||
          (error.original && error.original.constructor.name.includes(err)) ||
          (error && error.constructor.name.includes(err))
        ) {
          return true;
        }
        if (error.toString().includes('Lambda.')) {
          return true;
        }
        if (
          error.toString().includes('TaskFailed') &&
          error.state === ErrorState.TaskFailed
        ) {
          return true;
        }
        if (
          error.toString().includes('Timeout') &&
          error.state === ErrorState.Timeout
        ) {
          return true;
        }
        if (
          error.state === ErrorState.ALL ||
          error.toString().includes('Lambda.') ||
          error.toString().includes(err) ||
          (error.original && error.original.toString().includes(err)) ||
          (error.original && error.original.constructor.name.includes(err)) ||
          (error && error.constructor.name.includes(err)) ||
          (error.toString().includes('TaskFailed') &&
            error.state === ErrorState.TaskFailed) ||
          (error.toString().includes('Timeout') &&
            error.state === ErrorState.Timeout)
        ) {
          return true;
        }
        // TODO: not comprehensive error set
        if (
          err === ErrorState.Runtime &&
          error.original &&
          !!error.original
            .toString()
            .match(
              /States.Runtime|Eval|Type|Syntax|URI|Range|Error|parse|Parsing|Unexpected|token|Reference|undefined|of null|read property|JSON/g,
            )
        ) {
          return true;
        }
        return false;
      });
      if (errors.length > 0) {
        let errorType;
        if (error.state) {
          errorType = error.state;
        }
        errors.find((err) => {
          if (
            error.toString().includes(err) ||
            (error.original && error.original.toString().includes(err)) ||
            (error.original && error.original.constructor.name.includes(err)) ||
            (error && error.constructor.name.includes(err))
          ) {
            errorType = err;
          }
        });
        if (errors.find((e) => e === ErrorState.ALL)) {
          errorType = ErrorState.ALL;
        }
        const output = this.outputPath(state, input, {
          Error: errorType,
          Cause: {
            errorMessage: error.message,
            errorType,
            stackTrace: error.stack,
          },
        });
        return { state, output, originalState };
      }
    }
    return false;
  }

  /**
   * retry
   *
   * an AWS Step function Retry definition
   *
   * @access private
   */
  async retry(state, input, originalState, cb) {
    const wrapperFn = async (fn, increment) => {
      try {
        const output = await fn(increment);
        return output;
      } catch (err) {
        if (state.Retry) {
          const output = this.canCatch(state.Retry, input, originalState, err);
          if (increment < output.state.MaxAttempts) {
            increment += 1;
            let timeoutRef;
            await new Promise((resolve) => {
              const waitFor =
                output.state.IntervalSeconds *
                (increment * output.state.BackoffRate) *
                1000;
              timeoutRef = setTimeout(() => {
                resolve();
                clearTimeout(timeoutRef);
              }, waitFor);
            });
            return wrapperFn(cb, increment);
          }
        }
        throw err; // pass it to a catch if available or just fail
      }
    };
    return wrapperFn(cb, 0);
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
    const output = this.canCatch(states, input, originalState, error);
    if (output) {
      return this.step(output.state.Next, output.output, output.originalState);
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
      // NOTE: resolve *Path values into locals instead of mutating the state
      // definition. The state machine object is shared (require cache) and
      // re-validated on each execution; mutating it would make a Wait state
      // illegally contain both e.g. `SecondsPath` and `Seconds`.
      let seconds = state.Seconds;
      if (state.SecondsPath) {
        seconds = jsonpath.query(input, state.SecondsPath).shift();
      }
      if (seconds) {
        let lifetime =
          respectTime && seconds > maxWaitTime ? maxWaitTime : seconds;
        await new Promise((resolve) => {
          setTimeout(() => resolve(), lifetime * 1000);
        });
      }
      let timestamp = state.Timestamp;
      if (state.TimestampPath) {
        timestamp = jsonpath.query(input, state.TimestampPath).shift();
      }
      if (timestamp) {
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
            if (new Date() >= new Date(timestamp)) {
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
   * @param {number} retries
   */
  createContext(state, task, input, index = null, retries) {
    const id = +new Date();
    // Capture the input on the first attempt (retries falsy) and reuse it for
    // subsequent retries so Execution.Input stays stable across attempts.
    this._lastInputBeforeRetry = retries ? this._lastInputBeforeRetry : input;
    this._current.context = {
      Execution: {
        Id: `arn:aws:states:ap-southeast-1:123456789012:execution:stateMachineName:${id}`,
        Input: this._lastInputBeforeRetry,
        Name: +new Date(),
        RoleArn: 'arn:aws:iam::123456789012:role...',
        StartTime: new Date().toISOString(),
      },
      State: {
        EnteredTime: new Date().toISOString(),
        Name: task,
        RetryCount: retries || this._current.retries || 0,
      },
      StateMachine: {
        Id: 'arn:aws:states:ap-southeast-1:123456789012:stateMachine:stateMachineName',
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
