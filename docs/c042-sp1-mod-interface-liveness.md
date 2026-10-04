# C042 SP1 — is the host's mod interface live on this install?

**Current verdict:** see the last entry of [Verdict log](#verdict-log). As of 2026-10-04 it is **live**.
**Tracker item:** WF-1048 (charter C042 SUB-1, OUT-1). Later re-checks: WF-1055 (SUB-12).
**Consumers:** the cockpit sub-tasks (C042 SUB-7 to SUB-10) and the C044 component-kit gate, which calls this verdict SP0.
**Model:** claude-opus-5-5

## Why this check exists

The host shipped its mod interface (plugins of function hooks) on 2026-10-01. It is documented as on by default, but the vendor can switch installed mods off remotely, with no local override. Until someone checks, nobody knows whether a mod actually loads on this install. This document records that check and its result.

A verdict holds only for the install and host release it names. The interface may change between releases without notice, so each new release needs a fresh entry.

## What each verdict means

| Verdict | Meaning | Effect on the cockpit (SUB-7 to SUB-10) |
|---|---|---|
| `live` | A mod's hook was seen to run in an unattended session. | Design and build may proceed. |
| `not live` | The trial's stderr showed the host refused, failed to load or switched off the mod. A trial that prints the baseline with no stderr refusal is `untested`, not `not live`. | Design and build wait. The first `not live` entry's date is when the cockpit started waiting. WF-1055 owns what ends the wait. |
| `untested` | Nothing could be observed unattended, or the 30-minute time box ran out first. The entry gives the reason. | Neither waits nor retires. Design and build proceed, and liveness is recorded as untested. |

How `untested` reads for the C044 gate is C044's own rule. This document does not set it.

## How to repeat the check

An agent can run every step unattended, with no maintainer action. The 30-minute time box runs from step 2 (start time noted) to step 7 (verdict decided), and covers nothing else.

1. Make sure no other session or fleet item is running a mod trial on this install.
2. Note the start time in UTC and record what `claude --version` prints.
3. Inside the repository's scratch area (`_local/scratch/<task-id>-mod/`), write a three-file mod:
   - `.claude-plugin/plugin.json`: `{ "name": "<probe-name>", "version": "0.1.0", "description": "<one line>" }`
   - `hooks/hooks.json`: `{ "modules": ["./register.ts"] }`
   - `hooks/register.ts`: exports `register(on)`, which adds exactly one hook, `on('prompt.submit', ($, e, next) => next({ ...e, text: 'Reply with exactly this token and nothing else: <NONCE>' }))`. It must not add a permission-deciding handler, such as a `tool.call` allow or deny.
4. Run `claude plugin validate <mod folder>` and keep its output as supporting evidence. A passing validation does not prove the mod is live on its own.
5. **Trial run:** `timeout 300 claude -p --plugin-dir <mod folder> "Reply with exactly this token and nothing else: BASELINE-0000"`. The mod loads only in this child session. Never put it in user-level or shared settings, `CLAUDE_CODE_PLUGIN_DIRS`, project settings, or a hot-reload mods folder.
6. **Control run:** run the same command without `--plugin-dir`. It should print `BASELINE-0000`.
7. Decide the verdict:
   - `live`: the trial printed `<NONCE>` and the control printed `BASELINE-0000`.
   - `not live`: the trial's stderr names the probe plugin as not loaded, refused or switched off, whatever its stdout printed.
   - `untested`: anything else, with the reason. Examples: the child could not authenticate or reach the network, the run timed out, the output was ambiguous, or the time box ran out.
8. Delete the scratch mod folder as the last act of the trial.
9. Add a new entry at the **end** of the Verdict log below. Never edit or remove an earlier entry; later entries supersede earlier ones. Each entry records the date, verdict, host version, elapsed time, the observation, and what stayed untested.

## Verdict log

### 2026-10-04 — live

- **Verdict:** `live`
- **Host:** `claude --version` printed `2.1.289 (Claude Code)`. The charter had cited 2.1.288; this check ran on 2.1.289.
- **Time box:** started 2026-10-04T14:25:21Z, verdict decided 2026-10-04T14:25:59Z, 38 seconds elapsed (well inside 30 minutes).
- **Run by:** an unattended agent (WF-1048 fleet shipper) on Linux (WSL2), in its own isolated worktree, with no other fleet item running.
- **Observation:**
  - `claude plugin validate` passed with one warning (no author). It reported `./register.ts hooks: prompt.submit` and `calls: nothing on $`.
  - The trial run (`claude -p --plugin-dir <probe>` with prompt `BASELINE-0000`) printed `MODLIVE-7Q4X`, exited 0, and wrote nothing to stderr. The probe's `prompt.submit` hook ran and rewrote the prompt.
  - The control run (same prompt, no `--plugin-dir`) printed `BASELINE-0000` and exited 0. The rewrite came from the mod alone.
- **Untested (not observable unattended):**
  - What a mod draws on any surface: panes, bands, the status line, toasts, on terminal or desktop.
  - Hot reloading of the session mods folder, which needs a person's answer.
  - Loading through `CLAUDE_CODE_PLUGIN_DIRS`.
  - Whether a remote switch-off would later take effect mid-session.
- **Cleanup:** the probe folder was deleted after the trial. No settings file was edited.
