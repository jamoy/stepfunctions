import { EventEmitter } from 'events';

/** Options accepted by `startExecution`. */
export interface ExecutionOptions {
  /** Respect the real durations of `Wait` states instead of capping them. */
  respectTime?: boolean;
  /** Maximum number of seconds a `Wait` state may block for. Defaults to 30. */
  maxWaitTime?: number;
  /** Maximum number of branches/iterations run concurrently. Defaults to 10. */
  maxConcurrency?: number;
}

/** A bound Task handler, e.g. a Serverless/Lambda handler. */
export type TaskResource = (input: any) => any;

/** An Amazon States Language state machine definition. */
export type StateMachine = Record<string, any>;

export interface Options {
  /** Friendly name for the execution. Defaults to the StateMachine `StartAt`. */
  Name?: string;
  StateMachine: StateMachine;
  /** Map of Task state name to its handler. */
  Resources?: Record<string, TaskResource>;
}

/**
 * An in-memory AWS Step Functions / Amazon States Language interpreter, made to
 * run Node.js Lambda handlers inside a test environment.
 */
export declare class StepFunction extends EventEmitter {
  constructor(sm: Options | StateMachine);

  /**
   * Start an execution, passing `input` to the first state. Resolves to the
   * final output (the same value as `getExecutionResult()`).
   */
  startExecution(input?: any, opts?: ExecutionOptions): Promise<any>;

  /** Return the final output of the most recent execution. */
  getExecutionResult(): any;

  /** Pretty-print the recorded transitions with `console.table`. */
  getReport(): void;

  /** Replace a Task's resource with the provided handler. */
  bindTaskResource(task: string, fn: TaskResource): void;
}

export default StepFunction;
