#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const Sfn = require('../index.js');

const USAGE = `Usage: stepfunctions run <definition.json> [options]

Options:
  --input <json>        JSON input passed to the first state
  --input-file <path>   Read the JSON input from a file
  --base-path <dir>     Base dir for Serverless-style handler refs (default: cwd)
  --report              Print the transition report (console.table)
  -h, --help            Show this help
`;

async function main(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
    process.stdout.write(USAGE);
    return undefined;
  }
  if (args[0] !== 'run' || !args[1]) {
    process.stderr.write(USAGE);
    process.exitCode = 1;
    return undefined;
  }

  const file = args[1];
  let inputJson;
  let report = false;
  let basePath = process.cwd();
  for (let i = 2; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--input') {
      inputJson = args[++i];
    } else if (flag === '--input-file') {
      inputJson = fs.readFileSync(args[++i], 'utf8');
    } else if (flag === '--base-path') {
      basePath = args[++i];
    } else if (flag === '--report') {
      report = true;
    } else {
      process.stderr.write(`Unknown option: ${flag}\n`);
      process.exitCode = 1;
      return undefined;
    }
  }

  const definition = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  const input = inputJson === undefined ? undefined : JSON.parse(inputJson);
  const sm = new Sfn({ StateMachine: definition, handlerBasePath: basePath });
  const result = await sm.startExecution(input);
  if (report) {
    sm.getReport();
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (require.main === module) {
  main(process.argv).catch((err) => {
    process.stderr.write(`${err && err.message ? err.message : err}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main };
