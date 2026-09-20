#!/usr/bin/env node
import { run } from "./cli.js";

run(process.argv.slice(2), {
  stdout: (s) => process.stdout.write(s + "\n"),
  stderr: (s) => process.stderr.write(s + "\n"),
})
  .then((c) => {
    process.exitCode = c;
  })
  .catch((e) => {
    process.stderr.write(String(e) + "\n");
    process.exitCode = 1;
  });
