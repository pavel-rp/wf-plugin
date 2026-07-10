# wf-caps:qa-host — Backend test-host (ephemeral controller wiring)

The backend analog of the Angular test-host. Where `new`/`augment` scaffold a **permanent, git-tracked** Angular page for an un-routed component, the backend host **temporarily** exposes a service/repository method over HTTP so a QA scenario can exercise it with a real token — then reverts the wiring so nothing un-shippable reaches a commit.

**Lifecycle is the opposite of the Angular host.** The Angular host is a deliberate, lasting test surface. The backend host is a **run fixture**: ephemeral, sentinel-marked, and reverted in teardown (or before commit). Never leave a `__qa` endpoint in a commit — it is unreviewed surface area. `/wf:qa-auto` reverts it automatically; a human who runs `api-probe` by hand must run `api-revert` (or `api-revert --all`) before staging.

Loaded from `SKILL.md` when the first token is `api-probe` / `api-revert`, and by `/wf:qa-auto` when it hits a `Backend host required:` precondition.

## Contents

- [api-probe — locate or wire an endpoint](#api-probe--locate-or-wire-an-endpoint)
- [Picking the host controller](#picking-the-host-controller)
- [The ephemeral action shape](#the-ephemeral-action-shape)
- [api-revert — remove the wiring](#api-revert--remove-the-wiring)
- [The API must rebuild before the endpoint is live](#the-api-must-rebuild-before-the-endpoint-is-live)
- [Safety rules](#safety-rules)
- [Final output](#final-output)

---

## api-probe — locate or wire an endpoint

```
/wf-caps:qa-host api-probe <target>
```

`<target>` — `<Service>.<method>` (preferred), or a `<Service>` / `<Repository>` class name (then pick the new/changed public method from the branch diff), or an existing route. Skill greps for the `.cs` file when given a class/method form.

Steps:

1. **Resolve the target.** Find the service/repository `.cs` file (grep `{api-controllers-root}` and the wider solution). Signature-only read of the method: name, parameter list (name + type), return type. Stop at the first `{` of the body — same black-box discipline as the Angular host.

2. **Already-exposed check (do this first — it's the "exercise the real endpoint" path).** Grep the controllers root (`{api-controllers-root}`, or auto-detect by globbing `**/*Controller.cs`) for an action that calls `<method>`, or whose route/return type matches the target. If one exists:
   - Resolve its full route by combining the class-level `[Route("…")]`/`[ApiController]` template with the action's `[HttpGet/Post/…("…")]` template (substitute `[controller]` with the controller name minus the `Controller` suffix).
   - Return `EXPOSED — existing` with that route. **No writes.** The scenario exercises the real endpoint.

3. **Temp-wire (only when not exposed).** The deliverable is a service method with no endpoint. Pick the host controller (next section), inject the ephemeral action (the section after), and return `EPHEMERAL — wired` with the resolved `__qa` route and the controller file touched.

4. **Idempotence.** If an ephemeral block for this target already exists (grep the sentinel with the target name), don't add a second — return the existing `__qa` route.

`api-probe` writes no `index.md` row — the temporary endpoint is a within-run fixture, like a per-scenario DB fixture, not a lasting artifact.

---

## Picking the host controller

Choose, in priority order:

1. **Same domain area.** A controller whose name or feature folder matches the service: `ProviderGroupService` → `ProviderGroupsController`, or the controller sitting in the same feature folder as the service. This keeps the temp route discoverable and its auth/entity context correct.
2. **Already injects the service (or a sibling).** A controller whose constructor already takes the target service, or a service from the same namespace — its auth and entity-resolution filters already fit the data the method touches.
3. **A general/dev/diagnostics controller** if the project has one.

If none is a clean fit, prefer the controller closest in namespace to the service and note the choice in the output. Never create a brand-new controller file for this — reuse an existing one, so the only change is a delimited block inside a file that already exists (smaller, more obviously revertible diff).

Read only signatures of the chosen controller: its class-level `[Route]`, `[Authorize]`/`[ApiController]` attributes, and constructor service types. Don't read action bodies.

---

## The ephemeral action shape

Inject a single action, wrapped in sentinels, using **parameter injection (`[FromServices]`)** so the constructor is never touched (smaller, self-contained, trivially revertible). Keep the controller's existing class-level auth — the token the runner carries then authorizes the call exactly as a real endpoint would.

```csharp
// >>> WF-QA-EPHEMERAL ADO-<id> — DO NOT COMMIT — revert: /wf-caps:qa-host api-revert <Service>.<method>
[HttpGet("__qa/<method-kebab>")]
public async Task<IActionResult> __Qa_<Method>(
    [FromServices] <ServiceType> svc,
    <bound parameters from the method signature, via [FromQuery]/[FromRoute]/[FromBody]>)
{
    var result = await svc.<Method>(<args>);
    return Ok(result);
}
// <<< WF-QA-EPHEMERAL ADO-<id>
```

Rules for the action:

- **Route segment is `__qa/…`** — visually unmistakable as non-product, and namespaced so it can't collide with a real route.
- **Verb matches the method's nature** — a read method is `[HttpGet]`; a method that persists is `[HttpPost]` with the payload `[FromBody]`. When in doubt for a read, use GET.
- **Bind parameters from the request.** Scalars from `[FromQuery]`; a complex argument from `[FromBody]`. Mirror the method's parameter types exactly (signature read).
- **Return `Ok(result)`** — let the result serialize as-is so the scenario can assert the real response shape. If the method returns `void`/`Task`, return `Ok(new { ok = true })`.
- **No business logic.** The action only resolves the service and forwards the call. If forwarding needs more than parameter binding (e.g., constructing a complex DTO the spec doesn't define), stop and report `api-probe` can't wire it cleanly — that scenario escalates rather than getting a hand-built fixture that tests the fixture instead of the method.
- **One action per target**, each in its own sentinel block, so `api-revert` can remove exactly one.

---

## api-revert — remove the wiring

```
/wf-caps:qa-host api-revert <target>      # remove the one target's ephemeral block
/wf-caps:qa-host api-revert --all         # sweep every WF-QA-EPHEMERAL block in the repo
```

Steps:

1. **Find the block(s).** Grep for `WF-QA-EPHEMERAL` (optionally filtered to `<target>`). For `--all`, collect every match across the controllers root.
2. **Remove each block** from its opening `// >>> WF-QA-EPHEMERAL` through its closing `// <<< WF-QA-EPHEMERAL` inclusive, restoring the file to exactly its prior content. Because the block was self-contained (parameter injection, no constructor or using-statement edits), removing the block is a complete revert.
3. **Verify no sentinels remain** (for the targets reverted): grep again, expect zero. A leftover sentinel is a release hazard — surface it loudly.
4. **Typecheck if `{verify-command}` covers `.cs`.** If the project's verify command builds the API, run it and confirm exit 0. If it only typechecks the Angular front-end, note that the .NET build wasn't re-verified here and the API will rebuild on next run.
5. **Report** which blocks were removed and from which files.

The runner calls `api-revert <target>` in fixture teardown for every host it scaffolded during a run. `api-revert --all` is the safety sweep — run it (or have the runner run it) before any commit, and as the first thing `wf:commit` could check.

---

## The API must rebuild before the endpoint is live

A `.cs` controller edit is not live until the API recompiles. Two cases:

- **Hot reload on** (`dotnet watch run`, or VS "Hot Reload"): the endpoint appears within a few seconds. The runner polls the `__qa` route until it stops returning 404 (bounded — ~6 tries, a couple seconds apart).
- **No hot reload:** the endpoint won't exist until the API is restarted. The runner can't restart the API itself. It marks the scenario `BLOCKED · setup: backend host wired but API not rebuilt — restart the API (or run dotnet watch) and re-run` and leaves the wiring in place so the restart picks it up. The wiring is still reverted at end of run.

`api-probe`'s output always states "the API must rebuild/hot-reload for this route to respond" so neither a human nor the runner mistakes a fresh-wired 404 for a defect.

---

## Safety rules

This is the one place `wf-caps:qa-host` edits a **pre-existing** source file (a controller) rather than only new files under a test-host folder. The carve-out is tight:

- **Allowed:** insert/remove exactly one sentinel-delimited ephemeral action per target inside an existing controller; combine route templates and read class/constructor/DTO signatures to do so; run `{verify-command}`.
- **Forbidden:** edit any controller line outside a `WF-QA-EPHEMERAL` block; touch the constructor, fields, usings, or any product action; add business logic to the ephemeral action beyond resolve-and-forward; create a new controller; leave a sentinel block behind after `api-revert`; commit (the runner/user commits, and only after `api-revert`).

---

## Final output

```
QA-HOST — <EXPOSED | EPHEMERAL | REVERTED>

Task:        {wi-prefix}-{id}
Target:      <Service>.<method>
Mode:        api-probe | api-revert

<EXPOSED:>
Route:       <full resolved route of the existing endpoint>
Wiring:      none — real endpoint exercised as-is

<EPHEMERAL:>
Route:       <full resolved __qa route>
Controller:  <path/to/SomethingController.cs> (1 ephemeral action added)
Reminder:    API must rebuild/hot-reload before this route responds.
             Ephemeral — reverted automatically at end of run, or run
             /wf-caps:qa-host api-revert <Service>.<method> (or --all) before committing.

<REVERTED:>
Removed:     <N> ephemeral block(s) from <files>
Sentinels:   none remaining

Next:        <for EXPOSED/EPHEMERAL:> /wf:qa-auto exercises this route automatically when a scenario's preconditions say `Backend host required: <Service>.<method>`.
             <for REVERTED:> none — wiring cleaned.
```

**The final-output block must always be the very last thing output to chat.**
