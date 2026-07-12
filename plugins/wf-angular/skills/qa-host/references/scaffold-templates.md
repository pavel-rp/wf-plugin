# Test-host scaffold archetypes

The three code archetypes `/wf-angular:qa-host new` emits when scaffolding a host (steps 4–6). Read only on the `new` write path. Substitute the resolved names (`<kebab>`, `<Pascal>`, `<Service>`, per-`@Input`/`@Output` slots) and the profile tokens. Every concrete identifier is rendered from a slot or a signature-only read of the target — see the SKILL body for the resolution rules.

## Contents

- [Host TS](#host-ts) — the component archetype (step 4)
- [Host HTML](#host-html) — the status-panel template (step 5)
- [Host SASS](#host-sass) — the baseline styling (step 6)

## Host TS

```ts
import { Component, OnInit } from '@angular/core';
// Import services the target's constructor names — used to seed Inputs.
import { <Service> } from '<path>';

@Component({
  selector: 'app-<kebab>-test',
  templateUrl: './<kebab>-test.component.html',
  styleUrls: ['./<kebab>-test.component.sass'],
  standalone: false
})
export class <Pascal>TestComponent implements OnInit {
  // Inputs to bind to <app-<kebab>>
  <inputName>: <inputType> | null = <sensible-default>;

  // Output counters — observable from the DOM via the status panel
  <outputName>Count = 0;
  testLogs: string[] = [];

  constructor(private <service>: <Service>) {}

  ngOnInit(): void {
    // Seed Input values from services where applicable
    this.<inputName> = this.<service>.get<X>() ?? null;
  }

  on<OutputName>(<event>: <eventType>): void {
    this.<outputName>Count += 1;
    this.addLog('<outputName> emitted');
    // Re-read state if relevant so the panel reflects updates
  }

  clearLogs(): void {
    this.testLogs = [];
  }

  resetData(): void {
    // Re-seed inputs and counters for deterministic re-runs
    this.clearLogs();
  }

  private addLog(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    this.testLogs.unshift(`[${timestamp}] ${message}`);
    if (this.testLogs.length > 20) {
      this.testLogs.pop();
    }
  }
}
```

Sensible defaults: `null` for nullable, `false`/`0`/`''`/`[]` for primitives. Don't invent objects — leave as `null` and let the test override.

## Host HTML

```html
<div class="container-fluid test-host">
  <h2><Pascal> Test Host</h2>

  <div class="row">
    <div class="col-md-8">
      <div class="card">
        <div class="card-header bg-info text-white">
          <h5 class="mb-0">Component Under Test</h5>
        </div>
        <div class="card-body">
          <app-<kebab>
            [inputName]="inputName"
            (outputName)="onOutputName($event)">
          </app-<kebab>>
        </div>
      </div>

      <div class="card mt-3">
        <div class="card-header bg-secondary text-white">
          <h5 class="mb-0">Test Controls</h5>
        </div>
        <div class="card-body">
          <button class="btn btn-primary" (click)="resetData()">Reset Data</button>
          <button class="btn btn-warning ms-2" (click)="clearLogs()">Clear Logs</button>
        </div>
      </div>
    </div>

    <div class="col-md-4">
      <div class="card">
        <div class="card-header bg-success text-white">
          <h5 class="mb-0">Event Log</h5>
        </div>
        <div class="card-body log-container">
          <div *ngIf="testLogs.length === 0" class="text-muted">
            <em>No events logged yet. Interact with the component under test.</em>
          </div>
          <div *ngFor="let log of testLogs" class="log-entry">{{ log }}</div>
        </div>
      </div>

      <div class="card mt-3 qa-host-status" data-qa="status-panel">
        <div class="card-header bg-light">
          <h5 class="mb-0">Observed State</h5>
        </div>
        <div class="card-body small">
          <dl class="mb-0">
            <dt>Input <inputName></dt>
            <dd data-qa="<inputName>-value">{{ <inputName> | json }}</dd>
            <dt><outputName> fire count</dt>
            <dd data-qa="<outputName>-count">{{ <outputName>Count }}</dd>
          </dl>
        </div>
      </div>

      <div class="card mt-3 qa-host-scenarios" data-qa="scenario-panel">
        <div class="card-header bg-light">
          <h5 class="mb-0">Test Scenarios</h5>
        </div>
        <div class="card-body small">
          <p><strong>Scenario 1:</strong> <happy-path interaction for primary action> -> expected UI/event outcome.</p>
          <p><strong>Scenario 2:</strong> <secondary interaction or reverse action> -> expected UI/event outcome.</p>
          <p><strong>Scenario 3:</strong> <guard/edge behavior> -> expected blocked/empty/error-safe outcome.</p>
        </div>
      </div>
    </div>
  </div>
</div>
```

`data-qa="..."` attributes give scenarios stable handles for `read_page` / `run_playwright_code` assertions.
The scenario panel is mandatory. Always include at least 3 concise, component-specific scenario lines.

## Host SASS

Create `./<kebab>-test.component.sass` with the standard host styling:

```sass
.test-host
  padding: 20px
  background-color: #f8f9fa

.log-container
  max-height: 400px
  overflow-y: auto
  background-color: #f5f5f5
  font-family: monospace
  font-size: 12px
  border-radius: 4px

.log-entry
  padding: 4px 0
  border-bottom: 1px solid #eee

  &:last-child
    border-bottom: none
```

Use this layout/style as the baseline visual pattern (same family as any existing `<kebab>-test` host in the tree).
