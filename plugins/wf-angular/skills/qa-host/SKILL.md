---
name: qa-host
description: Scaffolds a routed Angular test-host page for a component that lacks one — creates a host folder under the stack's configured web root with a real-DI component plus status-panel template, and makes the standard routing-module edits (import, child route with the configured guards, static-components array). Every project-specific token — web/test-host paths, routing-module class, route prefix, sandbox host, and route guards — comes from the angular capability profile. Also augments an existing host with type-driven input controls and output observation, and can temporarily wire a backend method to a controller so a QA scenario can exercise it over HTTP. Idempotent — re-invoking on an existing host returns its route URL. Use when /wf:qa-auto or /wf:qa-followup needs a runnable URL or endpoint for a component or service still in development.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Task]
---

# /wf-angular:qa-host — Routed Angular test-host scaffolder

Scaffolds a persistent, routed test-host page for an Angular component that doesn't yet have a route in the running app. The host mounts the target via its selector, wires real DI services for any `@Input` initial values, and translates each `@Output` event into an incrementing counter surfaced in the template — so a tester (human via `/wf:qa-run` or agent via `/wf:qa-auto`) can drive the component end-to-end and verify observed behavior from the DOM alone.

The host is **git-tracked source**, not a local sandbox. Once scaffolded, it stays until you delete it via `/wf-angular:qa-host clean <component>`. Multiple components, each with its own `<kebab>-test/` folder, coexist under `{test-host-root}/`.

`new` scaffolds a deliberately minimal host (inputs seeded from DI, outputs counted). When a scenario needs to **vary** an input the host pinned, or **observe** an output the host didn't wire, use `augment <component>` (below) to grow that host in place — don't `clean` + `new`. This minimal-then-augment split is intentional: scaffolding can't know which inputs a future scenario will drive, so it stays small and `augment` adds exactly the controls a scenario needs.

For DI-level black-box tests (component method behavior verified via `injector.get(...)`) use `/wf-angular:test-page`. This skill is for full QA flows — clicks, observed UI, real state transitions — that need a routable URL.

**Backend mode.** A backend QA scenario (`Type: API`) needs an HTTP endpoint to exercise, not a routed page. `api-probe <Service>.<method>` resolves the real route if an endpoint already exists, or — when the deliverable is a service with no endpoint — temporarily wires it to the most appropriate controller as an **ephemeral** `__qa` action and returns that route; `api-revert` removes the wiring. Unlike the Angular host, the backend host is a run fixture that must never reach a commit. The full procedure (controller selection, the ephemeral action shape, the rebuild-before-live constraint, revert, safety) lives in [`references/backend-host.md`](references/backend-host.md).

## Stack profile (read first)

This skill carries no project token. Every project-specific value comes from the `angular` capability's **profile** — obtained by calling the bundled `wf-resolver` MCP tool `resolve_profile("angular")`. It returns the override-merged profile **values** directly (`_local/profiles/angular.profile.json` override merged over the capability's `profile.template.json` default, precedence: **override > capability default**) — this skill performs no direct profile-file read and no capability-registry-path walk of its own. If the response reports `present: false`, stop and direct the user to `/wf:init` (which seeds the override on divergence). If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded (restart Claude Code) — do not hand-read the profile files as a fallback. The slots, referenced as placeholders below:

- `{web-root}` — repo-relative root of the Angular web project.
- `{routing-module}` — the routing module the test-host route is added to.
- `{routing-module-class}` — the exported class name of that routing module (its `.components` static array gains the test-host component).
- `{test-host-root}` — root under which `<kebab>-test/` host folders and the sandbox module-test component live (often equal to `{web-root}`).
- `{route-prefix}` — the app route segment the test hosts mount under; the host URL is `/{route-prefix}/<kebab>-test`.
- `{sandbox-host-folder}` — the folder name (under `{test-host-root}`) of the sandbox module-test host that the module-test hub link is added to.
- `{sandbox-host-component}` — the class name of that sandbox module-test host component.
- `{route-guards}` — the route-guard class names applied via `canActivate` on the scaffolded route (comma-separated, or empty for none).
- `{verify-command}` — the typecheck/build command run before reporting success.

Every concrete identifier below (`<kebab>-test`, the routing-module class, the sandbox host, the route guards) is rendered from a slot — substitute the resolved value. Stack identifiers that are not project tokens — selectors, Angular DI/zone.js — are the stack's and stay as-is.

## When to use this

Fit:
- A new Angular component (`*.component.ts`) on the current task with no route yet.
- A component invoked only as a child elsewhere that you need to exercise standalone for QA.
- `/wf:qa-auto` is about to run a scenario whose preconditions say `Host required: <path>`.
- **Backend (`api-probe`/`api-revert`):** a new/changed service or repository method `/wf:qa-auto` needs to exercise over HTTP, whose preconditions say `Backend host required: <Service>.<method>` — or an existing endpoint whose route you just need resolved.

Not fit:
- Component already routed in the real app — use that route, don't scaffold a parallel host.
- DI-level / signature-only assertions — use `/wf-angular:test-page`.
- Pure helper functions — use `/wf-node-ts:test-node`.
- A backend method you want a *lasting* automated smoke test for (not a one-off exercise) — use `/wf-angular:test-page backend-smoke` instead; `api-probe` is ephemeral by design.

---

## Branch-based id inference

When a mode infers `{task-id}` from the current branch (the empty-argument mode below), reach the branch name through the delivery contract's `current-branch-query`, never a direct `git` call — so the skill still degrades cleanly in git-free bare-core mode. Resolve the surface by calling the bundled `wf-resolver` MCP tool `resolve_provider("delivery")` — the typed query that returns the run-scoped resolution record `{ surface, owner, fragmentPath, state, candidates?, degradation }`. The resolver has already resolved the `## Capabilities` registry, the owning capability's `manifest.md`, and any plugin-anchored root (post install-manifest self-heal, `capability-registry.ops.md` §"Recorded-root-first resolution with install-manifest self-heal"); this skill performs no registry / manifest / plugin-root read of its own. Follow the returned `fragmentPath` in-context to dispatch `current-branch-query`. On `state: unconfigured` or `unrecoverable` (no readable `delivery` provider), `current-branch-query` falls back silently to the plain-directory case — no error, no capability term surfaces — yielding no branch token, at which point the mode asks for an explicit target. If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded — do not hand-parse the registry (WF-272 diagnostics/recovery).

---

## Dispatch on arguments

Parse the first token. Recognized forms:

### empty (no arguments) → infer target from branch and scaffold

1. Resolve `{task-id}` from the current branch (first 3+-digit run) via the delivery contract's `current-branch-query` — see "Branch-based id inference" below; never call `git` directly for it. If no branch token can be resolved (extraction fails, or no delivery provider is registered in git-free bare-core mode), stop with: "Can't infer target. Pass `<component-path>` explicitly: `/wf-angular:qa-host new <path>`."
2. Find candidate components from the branch diff (union of `git diff --name-only main...HEAD`, `git diff --name-only HEAD`, untracked). Filter to `*.component.ts` under `{web-root}`, excluding existing `*-test/*-test.component.ts`.
3. Drop candidates already routed (grep `{routing-module}` for the kebab-name).
4. Pick or ask: 0 → stop with "no new unrouted Angular components on this branch"; 1 → scaffold; 2+ → list, ask which.
5. Run the `new` flow on the chosen target.

### `new <component>` → scaffold

`<component>`: target's `.component.ts` path (relative or absolute), OR the selector (`app-<kebab>`), OR the class name (`<Pascal>Component`). Skill greps for the file when given a non-path form.

Steps:

1. **Resolve target.** Read the target component file. Extract signature-only:
   - Selector → kebab-name.
   - Class name (`export class <Pascal>Component`).
   - `@Input` declarations — name + type. Stop reading at the first `{` of any method body.
   - `@Output` declarations — name + event type.
   - Constructor service deps — type + import path.

2. **Compute host names.** Given target kebab `date-range-picker`:
   - Folder: `{test-host-root}/date-range-picker-test/`
   - Files: `date-range-picker-test.component.ts` + `.component.html`
   - Class: `DateRangePickerTestComponent`
   - Selector: `app-date-range-picker-test`
   - Route path: `date-range-picker-test`

3. **Idempotence.** If the folder exists with both files, run the `route` flow instead and exit (returns the existing URL). Don't overwrite a hand-edited host.

4. **Generate host TS, HTML, and SASS.** The three scaffold archetypes — the component TS (inputs seeded from DI, outputs counted), the status-panel HTML (`data-qa` handles + mandatory 3-scenario panel), and the baseline SASS — live at [`references/scaffold-templates.md`](references/scaffold-templates.md). They are read only on this `new` write path, so they stay out of the boot body. Read that file, then emit each archetype with the resolved names (`<kebab>`, `<Pascal>`, `<Service>`, per-`@Input`/`@Output` slots) substituted: `<kebab>-test.component.ts`, `.component.html`, and `.component.sass` under the host folder. The reference carries the sensible-default rule, the `data-qa` handle convention, and the baseline visual pattern.

5. **Three edits to `{routing-module}`:**

   a. **Import** appended to the test-component import group:
      ```ts
      import { <Pascal>TestComponent } from './<kebab>-test/<kebab>-test.component';
      ```

   b. **Child route** appended to the test-route group inside the root path's `children:` array:
      ```ts
      {
        path: '<kebab>-test', component: <Pascal>TestComponent, canActivate: [{route-guards}]
      },
      ```

      Render `canActivate: [{route-guards}]` from the profile's `{route-guards}` slot (e.g. `[SessionGuard, ScopeGuard]`). If `{route-guards}` is empty, omit the `canActivate` key entirely.

   c. **Static components** array entry on `{routing-module-class}.components`:
      ```ts
      <Pascal>TestComponent,
      ```

   Use `Edit` with exact-string matches. If any of the three is already present, leave it alone (idempotent).

6. **Add navigation link in the sandbox module-test component's template** — `{test-host-root}/{sandbox-host-folder}/{sandbox-host-folder}.component.html`:

   Append a link to the new test host in the Test Area card body. Example:
   ```html
   <p class="mt-2">
     <a routerLink="/{route-prefix}/<kebab>-test" class="btn btn-sm btn-outline-primary">
       Test → <kebab>-test
     </a>
   </p>
   ```

   This makes the test page discoverable from the module-test hub page. Skip this step if `{sandbox-host-folder}` is not configured (no sandbox hub in the project).

7. **Typecheck.** Run `{verify-command}` (from the `angular` profile — see "Stack profile"). On exit-0, continue. On errors touching the new files or the routing module's three markers, do NOT report success — show the TSC output, identify likely cause, offer to fix or roll back (delete the new folder + reverse the routing edits). Errors only in untouched files are flagged as pre-existing.

8. **Report:** new folder + files, the route URL (`/{route-prefix}/<kebab>-test` relative to the app root), `Typecheck: PASS`, login+entity reminder.

After typecheck passes, invoke `/wf:index <task-id> qa-host "<kebab>-test · /{route-prefix}/<kebab>-test"` (string slot — file lives in source tree, not under `_local/`).

### `augment <component>` → add controls / observation to an EXISTING host

Used when a host already exists but a QA scenario can't run because the host **pins an `@Input` the scenario must vary**, **lacks a control to reach a required state**, or **doesn't surface an `@Output` the scenario must observe**. This is the retrofit path: `new` scaffolds a minimal host; `augment` grows it per scenario need *without* re-scaffolding or clobbering hand edits. `/wf:qa-followup` drives this automatically when it triages a host-capability block — it is the primary way the harness gets unblocked.

The caller (`/wf:qa-followup`) supplies each needed control/observation as an identifier drawn from the scenario's block reason via `--control`/`--observe`/`--show`; this provider validates those identifiers against the target's real `@Input`/`@Output` surface and wires them, rejecting any it can't find. That validate-and-wire step against the concrete surface is the stack-specific part this provider owns. Worked examples: a host that hardcodes `showLabel=true` → `--control showLabel`; "no control to set `selectedIds`" → `--control selectedIds`; "`valueChanged` never observed" → `--observe valueChanged`. The block reasons are capability-neutral (a pinned control, a missing control, an unwired observation); resolving each identifier to the target's concrete `@Input`/`@Output` and wiring it is this provider's job.

```
/wf-angular:qa-host augment <component> [--control <input>]... [--observe <output>]... [--show <input>]...
```

Steps:

1. **Resolve target** as in `new` step 1 (signature-only — re-read `@Input`/`@Output` declarations to get types). Compute kebab/host names.
2. **Require an existing host.** The `<kebab>-test/` folder must exist with both files. If not, stop: "No host to augment — run `/wf-angular:qa-host new <path>` first." Never scaffold from `augment`.
3. **Validate the named targets.** Each `--control`/`--show` name must be a real `@Input`, each `--observe` a real `@Output`, on the resolved target. If any isn't, stop and list the available `@Input`/`@Output` names — don't guess a near-match.
4. **Read the current host** `.ts` and `.html`. Every edit below is **additive and idempotent**: grep for the target's handle first (the `data-qa` attribute, the handler name, or the binding) and skip it if already present, so re-running is a no-op and hand edits survive.
5. **`--control <input>`** — make the input driveable from the UI. Use **plain property/event binding, never `[(ngModel)]`** (so the augment never depends on `FormsModule` being imported). Pick the widget from the input's type:
   - `boolean` → `<input type="checkbox" [checked]="<input>" (change)="<input> = $any($event.target).checked">`
   - `string` → `<input type="text" [value]="<input>" (input)="<input> = $any($event.target).value">`
   - `number` → `<input type="number" [value]="<input>" (input)="<input> = +$any($event.target).value">`
   - union of string literals → `<select (change)="<input> = $any($event.target).value">` with one `<option>` per literal
   - array / object → a `<textarea>` holding JSON plus an **Apply** button calling an `apply<Input>(raw: string)` handler that `JSON.parse`s into the field (on parse error: `addLog('<input>: invalid JSON')`, leave the field unchanged)

   Add the host field (typed, seeded from the input's existing default), wrap the control in a labelled block inside the **Test Controls** card with `data-qa="<input>-control"`, and ensure `<app-<kebab>>` binds `[<input>]="<input>"`.
6. **`--observe <output>`** — if `(<output>)` isn't already wired on `<app-<kebab>>`, add the binding `(<output>)="on<Output>($event)"`, the `on<Output>` handler (increments `<output>Count`, `addLog`s), the `<output>Count = 0` field, and a `data-qa="<output>-count"` readout in the status panel.
7. **`--show <input>`** — ensure a `data-qa="<input>-value"` readout exists in the status panel (`{{ <input> | json }}`).
8. **Typecheck** with `{verify-command}`. Same handling as `new` step 7: on errors touching the host files, show the TSC output and offer to revert just the augment edits — don't report success.
9. **Report** what was added per target (`control` / `observe` / `show` / `already present`), the unchanged route URL, `Typecheck: PASS`.

After typecheck passes, invoke `/wf:index <task-id> qa-host "<kebab>-test · augmented: <one-line summary of what was added>"`.

### `route <component>` → look up the URL only

Used by `/wf:qa-auto` when a `Host required:` precondition fires and the host might already exist. Don't scaffold — just compute and return.

1. Resolve target as in `new` step 1.
2. Compute kebab-name.
3. If `{test-host-root}/<kebab>-test/` exists with both `.ts` and `.html` files, output route: `/{route-prefix}/<kebab>-test` (the profile's route prefix + `<kebab>-test`). Otherwise output: `not scaffolded — run /wf-angular:qa-host new <path> first`.

### `clean <component>` → remove the host

1. Resolve target. Compute kebab-name.
2. Delete the `{test-host-root}/<kebab>-test/` folder.
3. Reverse the three routing-module edits.
4. Run `{verify-command}` to confirm the tree still typechecks.
5. Report.

Refuse to clean a host referenced by an active QA artifact: scan `_local/` for any `06_qa.md` / `07_qa-report.md` mentioning `/<kebab>-test`. If found, ask before proceeding.

### `api-probe <target>` → resolve or temp-wire a backend endpoint

The backend analog of `route` + `new`. `<target>` is `<Service>.<method>`, a `<Service>`/`<Repository>` class name, or an existing route. Resolves the real route if an endpoint already exposes the method (no writes); otherwise temporarily wires the method to the most appropriate controller as an ephemeral `__qa` action and returns that route.

**Follow [`references/backend-host.md` § api-probe](references/backend-host.md#api-probe--locate-or-wire-an-endpoint) exactly** — it covers controller selection, the sentinel-wrapped action shape, idempotence, and the rebuild-before-live constraint. Emit the `QA-HOST — EXPOSED | EPHEMERAL` block from that file.

### `api-revert <target>` / `api-revert --all` → remove the ephemeral wiring

Removes the sentinel-delimited `__qa` action(s) and restores the controller. `<target>` reverts one; `--all` sweeps every `WF-QA-EPHEMERAL` block in the repo (the pre-commit safety sweep). Follow [`references/backend-host.md` § api-revert](references/backend-host.md#api-revert--remove-the-wiring). Emit the `QA-HOST — REVERTED` block.

### Anything else → freeform

If the user typed something like "make a host for the date-range picker", interpret: locate the target, follow `new`. "Expose/exercise the widget service" → follow `api-probe`.

---

## Conventions

- Folder: `{test-host-root}/<kebab>-test/`
- Files: `<kebab>-test.component.ts` + `.html`
- Class: `<Pascal>TestComponent`, selector `app-<kebab>-test`, `standalone: false`
- Route: `path: '<kebab>-test'` with `canActivate: [{route-guards}]` (omit `canActivate` when `{route-guards}` is empty)
- Routing edits live in `{routing-module}` (NOT the feature module or the root app module)
- DI services are real — no mocks. The host's whole point is exercising the target against the real runtime.

---

## Black-box discipline carve-out

This is the first wf:qa-* skill that writes source. Allowed reads of the target (both `new` and `augment`):

- `@Input` declarations — name + type only.
- `@Output` declarations — name + event type only.
- Constructor params — service types + import paths.
- Selector and class name.

Stop reading at the first `{` of any method body. Don't read the target's `ngOnInit`, event-handler implementations, or private state. The host exercises the target via its public surface — reading bodies couples scaffolding to internals that may shift. `augment` picks a control widget purely from the input's declared *type*, never from how the component uses the input internally.

---

## Edge Cases

- **Target file doesn't exist.** Stop with the file-not-found message; don't guess.
- **Target has no `@Output`s.** Skip the counter section. Status panel still shows Input values.
- **Target has no `@Input`s.** Skip bindings; mount as `<app-<kebab>></app-<kebab>>`. Panel shows whatever ngOnInit-derived state is meaningful.
- **Constructor service can't be imported** (path resolution fails). Stop with: "Can't resolve service `<X>` from `<path>`. Check imports in the target."
- **Routing module structure has drifted** (no `static components = [...]`, or no empty-path root with `children:`). Stop with diagnostic.
- **Host folder exists but files don't match canonical shape** (partial hand-edit). Stop with: "Folder `<path>` exists but doesn't match. Run `clean` first or fix manually."
- **Two components with the same kebab in different folders.** Skill picks the first Grep match. Pass an explicit path to disambiguate.
- **Host exists but a scenario can't drive/observe what it needs** (pinned input, missing control, unwired output). Use `augment <component>` to add the control/observation — don't `clean` + `new` (that discards hand edits and any other scenarios' controls).
- **`augment` names an input/output the target doesn't declare.** Stop and list the available `@Input`/`@Output` names; don't guess a near-match or invent a binding.
- **`augment` on a host that doesn't exist yet.** Stop with the "run `new` first" message — `augment` never scaffolds.
- **`api-probe` target already has an endpoint.** Return `EXPOSED — existing` with the resolved route; no writes. The scenario exercises the real endpoint.
- **`api-probe` can't wire the method cleanly** (forwarding needs more than parameter binding — e.g. a complex DTO the spec doesn't define). Stop and report; that scenario escalates rather than getting a hand-built fixture that tests the fixture instead of the method.
- **`api-probe` finds no suitable controller.** Pick the controller closest in namespace to the service and note the choice; never create a new controller file for the ephemeral wiring.
- **Fresh-wired `__qa` route returns 404.** Expected until the API rebuilds/hot-reloads — not a defect. See [`references/backend-host.md` § rebuild](references/backend-host.md#the-api-must-rebuild-before-the-endpoint-is-live).
- **`api-revert` finds a leftover sentinel after removal.** Surface it loudly — an un-reverted `WF-QA-EPHEMERAL` block is a release hazard. Run `api-revert --all` to sweep.

---

## Safety Rules

**Allowed:**

- Read the target component file (signature-only — see Black-box discipline above).
- Read-only resolution via `current-branch-query` (the `wf-resolver` `resolve_provider("delivery")` query — see "Branch-based id inference") for branch-based id inference, and via `resolve_profile("angular")` for stack-profile values (see "Stack profile"). Never call `git` directly for branch inference; never hand-parse the registry, a manifest, or the profile files — every fact the resolver supplies comes from a typed tool call.
- Write new files under `{test-host-root}/<kebab>-test/`.
- Edit `{routing-module}` (three exact edits documented in `new`).
- **Backend mode only:** insert/remove exactly one sentinel-delimited (`WF-QA-EPHEMERAL`) ephemeral action per target inside an *existing* controller — the single carve-out for editing a pre-existing source file. Read controller/constructor/DTO signatures and combine route templates to do so. Full constraints in [`references/backend-host.md` § Safety rules](references/backend-host.md#safety-rules).
- Run `{verify-command}` to typecheck.
- Invoke the **Task** tool with `subagent_type: wf:index` after typecheck passes (Angular host only — `api-probe`/`api-revert` write no index row).

**Forbidden:**

- Modify the target component, the spec, or any other source file outside the new test-host folder + the routing module — **except** a `WF-QA-EPHEMERAL` block in backend mode.
- In backend mode: edit any controller line outside a sentinel block, touch the constructor/fields/usings/product actions, add business logic beyond resolve-and-forward, create a new controller, leave a sentinel behind after `api-revert`, or commit the wiring.
- Read method bodies of the target. Signature-only.
- Run builds, installs, or destructive git.
- Mock services. The host wires real DI.
- Skip the typecheck step before reporting success.
- Hand-parse `_local/profiles/angular.profile.json`, a capability manifest, or the `## Capabilities`/`## Plugin Roots` tables, or probe `${CLAUDE_PLUGIN_ROOT}` — every such fact comes from a `wf-resolver` typed query (`resolve_profile`, `resolve_provider`).

---

## Final Output

```
QA-HOST — Complete

Task:        {task-id}
Target:      <component-path>
Host:        {test-host-root}/<kebab>-test/
Route:       /{route-prefix}/<kebab>-test (the profile's route prefix + <kebab>-test)
Edits:       <kebab>-test/<kebab>-test.component.ts (new)
             <kebab>-test/<kebab>-test.component.html (new)
             {routing-module} (3 edits: import, route, static-components)

Typecheck:   PASS

Next:        Login to the app + select entity/context if guarded, then navigate to <app-base>/{route-prefix}/<kebab>-test.
             /wf:qa-auto picks up this host automatically when a scenario's preconditions say `Host required: <component>`.
```

For `augment`, emit the same block with the verb adjusted: `Edits:` lists the host `.ts`/`.html` as modified plus a one-line summary of the controls/observers/readouts added (or `already present`), and `Route:` is unchanged (no routing-module edits).

For `api-probe` / `api-revert` (backend mode), emit the `QA-HOST — EXPOSED | EPHEMERAL | REVERTED` block defined in [`references/backend-host.md` § Final output](references/backend-host.md#final-output) instead of the Angular block above.

**The final-output block must always be the very last thing output to chat.**
