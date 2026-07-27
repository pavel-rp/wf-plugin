#!/usr/bin/env node
// mechanism-signals.cli.mjs — the CLI entry for the mechanism-signal validator/evaluator.
//
// **Model:** claude-opus-5[1m]
//
// This file exists so that mechanism-signals.mjs can be IMPORT-PURE. It calls main() unconditionally:
// there is no `argv[1]`-versus-`import.meta.url` comparison here or in the module, and none may be
// added. Two rounds of trying to make such a comparison correct each left a path on which it was
// false while the file genuinely WAS the entry point (node realpaths `import.meta.url`, `argv[1]`
// stays logical, `path.resolve` follows no symlink), and its false branch was a SILENT SUCCESS —
// exit 0 having validated nothing, which every caller reads as "all signals validate".
//
// Being a separate file is what removes the failure mode rather than narrowing it: a file whose only
// job is to run main() has no condition to get wrong. Invoke this, never the module.
import { main, SignalError } from "./mechanism-signals.mjs";

// EVERY throw is caught, named, and exited as 2 — never rethrown.
//
// A rethrow here lands on node's default handler: a raw stack trace with no `mechanism-signals:
// ERROR — ` prefix to say which tool failed, and **exit 1**, which in this vocabulary means
// MISMATCH. An unwritable --out, a planted symlink refused by the exclusive create, a permissions
// error — each of them is a tool/IO failure, and each was reporting itself to the caller as "the
// evidence diverged from the committed inventory". That is the impersonation the 0/1/2 split
// exists to prevent, and narrowing the catch to SignalError left every other failure inside it.
//
// The stack still reaches stderr for a genuine defect; only the exit code and the prefix are
// asserted here, because those are what a caller branches on.
// `process.exitCode`, never `process.exit()`. Node's stdout is ASYNC on a pipe, so `process.exit()`
// tears the process down with whatever is still queued unwritten — output is cut at the pipe buffer
// (65536 bytes) and the trailing lines a caller greps are simply gone, while the exit code still
// says success. Setting the code and letting the process end on its own drains the queue first.
// The exit code is the only thing these branches need to control; stopping the process is not.
try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  if (e instanceof SignalError) {
    process.stderr.write(`mechanism-signals: ERROR — ${e.message}\n`);
    process.exitCode = 2;
  } else {
    process.stderr.write(`mechanism-signals: ERROR — ${e && e.message ? e.message : e}\n`);
    if (e && e.stack) process.stderr.write(`${e.stack}\n`);
    process.exitCode = 2;
  }
}
