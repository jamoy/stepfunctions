import { EventEmitter } from 'events';

declare namespace StepFunction {
  /** Options accepted by `startExecution`. */
  interface ExecutionOptions {
    /** Respect the real durations of `Wait` states instead of capping them. */
    respectTime?: boolean;
    /** Maximum number of seconds a `Wait` state may block for. Defaults to 30. */
    maxWaitTime?: number;
    /** Maximum number of branches/iterations run concurrently. Defaults to 10. */
    maxConcurrency?: number;
  }

  /** A bound Task handler, e.g. a Serverless/Lambda handler. */
  type TaskResource = (input: any) => any;

  /** An Amazon States Language state machine definition. */
  type StateMachine = Record<string, any>;

  interface Options {
    /** Friendly name for the execution. Defaults to the StateMachine `StartAt`. */
    Name?: string;
    StateMachine: StateMachine;
    /** Map of Task state name to its handler. */
    Resources?: Record<string, TaskResource>;
  }
}

/**
 * An in-memory AWS Step Functions / Amazon States Language interpreter, made to
 * run Node.js Lambda handlers inside a test environment.
 */
declare class StepFunction extends EventEmitter {
  constructor(sm: StepFunction.Options | StepFunction.StateMachine);

  /**
   * Start an execution, passing `input` to the first state. Resolves to the
   * final output (the same value as `getExecutionResult()`).
   */
  startExecution(
    input?: any,
    opts?: StepFunction.ExecutionOptions,
  ): Promise<any>;

  /** Return the final output of the most recent execution. */
  getExecutionResult(): any;

  /** Pretty-print the recorded transitions with `console.table`. */
  getReport(): void;

  /** Replace a Task's resource with the provided handler. */
  bindTaskResource(task: string, fn: StepFunction.TaskResource): void;
}

export = StepFunction;
