// Smoke test for the dual ESM/CJS entry points and the ergonomic API.
// Run with `npm run test:smoke` (and in CI on every supported Node version).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Sfn, { StepFunction } from '../index.mjs';

const require = createRequire(import.meta.url);
const SfnCjs = require('../index.js');

assert.equal(typeof Sfn, 'function', 'ESM default export is the class');
assert.equal(StepFunction, Sfn, 'ESM named export equals default');
assert.equal(SfnCjs, Sfn, 'CJS require resolves to the same class');

// Ergonomics: a bare state-machine definition, and startExecution that
// resolves to the result and a non-mutating getExecutionResult().
const sm = new Sfn({
  StartAt: 'A',
  States: { A: { Type: 'Pass', End: true } },
});
const result = await sm.startExecution({ ok: 1 });
assert.deepEqual(result, { ok: 1 }, 'startExecution resolves to the result');
assert.deepEqual(sm.getExecutionResult(), { ok: 1 });
assert.deepEqual(
  sm.getExecutionResult(),
  { ok: 1 },
  'getExecutionResult is idempotent',
);

console.log('smoke: dual ESM/CJS entry points + ergonomic API OK');
