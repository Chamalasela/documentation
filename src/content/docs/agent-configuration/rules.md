---
title: Rules Configuration
description: How rules.json controls what the agent does when a webhook arrives.
---

`rules.json` is the single configuration surface that controls **what the agent does** when a webhook arrives — or when a schedule fires. Each entry in the JSON array is a self-contained rule set, keyed by either a webhook name (`webhook`) or a cron schedule (`schedule` + `cron`), that maps to one or more **execution blocks**. Each block independently declares payload filters, input extraction, plugin installation, and a Claude Code prompt template — so a single inbound event (or a recurring tick) can fan out into multiple specialised workflows without any custom code.

If **multiple** execution blocks in the same rule set match one webhook payload, **each** match is scheduled as its own run (separate activation / executor session) with that block's inputs, plugins, and prompt. `schedule` rule sets have no payload to match against — **every** execution block in the rule set runs on each cron tick. See [§ 8](#8-schedule--cron--time-triggered-rule-sets).

```
rules.json  →  WebhookRulesEvaluator  →  EventOrchestrator  →  ProcessingWorkflow  →  Executor Container
```

In the **the-agent** reference implementation, the default file is `Knowledge/rules.json`, embedded at agent registration as Xians knowledge document **`Rules`**.

---

## File Structure

`rules.json` is a JSON array of **rule set** objects. Each rule set is triggered either by a **webhook** (`webhook`, a case-insensitive name matched against incoming events) or by a **cron schedule** (`schedule` name + `cron` expression — see [§ 8](#8-schedule--cron--time-triggered-rule-sets)), and contains an **executions** array. Each execution is an independent pipeline: optional filters, inputs, plugins, and prompt.

```jsonc
[
  {
    "webhook": "...",
    "executions": [
      {
        "name": "...",
        "platform": "...",
        "repository": "...",
        "match-any":        [ ... ],
        "use-inputs":       [ ... ],
        "use-plugins":      [ ... ],
        "with-envs":        [ ... ],
        "model":            "...",
        "max-turns":        40,
        "allowed-tools":    [ ... ],
        "disallowed-tools": [ ... ],
        "max-budget-usd":   1.00,
        "resume-sessions":  false,
        "conversation-key": "...",
        "execute-prompt":   "..."
      }
    ]
  }
]
```

A `schedule` rule set replaces `webhook` / `match-any` / `use-inputs` with `cron` — there's no incoming payload to filter or extract from (see [§ 8](#8-schedule--cron--time-triggered-rule-sets)):

```jsonc
[
  {
    "schedule": "...",
    "cron": "*/5 * * * *",
    "with-envs": [ ... ],
    "executions": [
      {
        "name": "...",
        "platform": "...",
        "repository": {
          "url": "...",
          "name": "...",
          "ref": "..."
        },
        "use-plugins":    [ ... ],
        "execute-prompt": "..."
      }
    ]
  }
]
```

| Field | Description |
|-------|-------------|
| `webhook` | Webhook name from Xians Agent Studio (must match incoming events). Mutually exclusive with `schedule`. |
| `schedule` | Cron rule set name — the time-triggered analogue of `webhook`, used for logs and skip messages. Mutually exclusive with `webhook`. See [§ 8](#8-schedule--cron--time-triggered-rule-sets). |
| `cron` | Standard 5-field cron expression (`minute hour day-of-month month day-of-week`) controlling how often a `schedule` rule set's executions run. Only valid alongside `schedule`. |
| `executions` | One or more execution blocks; optional per-block `name` for logs and skip messages |
| `platform` *(per execution, optional)* | Hosting service the run targets (`github`, `azuredevops`, …). Structural — describes *where* the run happens, independent of the plugin. See [§ 1b](#1b-platform--repository--structural-execution-context). |
| `repository` *(per execution, optional)* | Structural binding for the repository being operated on. Each declared sub-field (`url`, `ref`) accepts either a JSON path (resolved against the payload) or a constant via `{ "value": "...", "constant": true }`. Auto-resolved values are exposed to plugins as `{{repository-url}}` / `{{repository-name}}` / `{{git-ref}}`; **`{{repository-name}}` is derived from `url`, never authored**. Omit the whole block for executions that don't operate on a repo. See [§ 1b](#1b-platform--repository--structural-execution-context). `schedule` rule sets declare `url` / `ref` (and optionally `name`) as plain literals — see [§ 8](#8-schedule--cron--time-triggered-rule-sets). |
| `with-envs` *(optional, per execution or per rule set)* | Container env vars injected before the prompt runs. Declare it inside an execution block (sibling to `use-plugins`) to scope it to that execution, or at the rule-set level (sibling to `executions`) to apply to **every** execution in the rule set. Each entry **must** declare its source explicitly: `secrets.KEY` (tenant Secret Vault), `host.NAME` (agent process env), or a literal with `"constant": true`. Bare names and unknown prefixes fail the activation. See [§ 5](#5-with-envs--container-environment-variables). |
| `model` *(per execution, optional)* | Claude model this block runs on (e.g. `claude-haiku-4-5`, `claude-sonnet-4-5`). Omit to use the executor default. See [§ 7](#7-cost--execution-controls). |
| `max-turns` *(per execution, optional)* | Hard cap on agent turns — the run aborts once this many tool-use round-trips complete. See [§ 7](#7-cost--execution-controls). |
| `allowed-tools` *(per execution, optional)* | List of tool names auto-approved without a permission prompt. Does not restrict which tools are available; use `disallowed-tools` to block tools entirely. See [§ 7](#7-cost--execution-controls). |
| `disallowed-tools` *(per execution, optional)* | List of tool names (or scoped patterns like `"Bash(rm *)"`) to remove from the agent's context. See [§ 7](#7-cost--execution-controls). |
| `max-budget-usd` *(per execution, optional)* | Hard USD spend cap per run. The SDK aborts the run once this threshold is crossed. See [§ 7](#7-cost--execution-controls). |
| `resume-sessions` *(per execution, optional)* | When `true`, back-to-back runs on the same conversation resume the prior Claude Code session. Best-effort — a missing session falls back to a fresh run. Pair with `conversation-key` to define what "the same conversation" means. See [§ 7](#7-cost--execution-controls). |
| `conversation-key` *(per execution, optional)* | Binding that identifies the conversation for session-resume keying (e.g. `"pull_request.number"` so every run on the same PR shares one session). Same JSON-path / constant forms as the `repository` sub-fields. Only consulted when `resume-sessions` is `true`. See [§ 7](#7-cost--execution-controls). |

Each execution block that passes its `match-any` filters is scheduled independently when multiple blocks match the same payload.

### Evaluation Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│  Incoming Webhook                                                    │
│  name: "Default"   payload: { "action": "opened", ... }              │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │  Find rule set where  │
                    │  webhook matches      │
                    └───────────┬───────────┘
                                │
                    ┌───────────▼───────────┐
                    │  For each execution:  │
                    │  Evaluate match-any   │──── No match? → skip block
                    │  (OR across entries)  │
                    └───────────┬───────────┘
                                │ At least one match-any passes
                    ┌───────────▼───────────┐
                    │  Extract use-inputs   │
                    │  from payload         │
                    └───────────┬───────────┘
                                │
                    ┌───────────▼───────────┐
                    │  Interpolate          │
                    │  execute-prompt       │
                    │  with {{input-name}}  │
                    └───────────┬───────────┘
                                │
                    ┌───────────▼───────────┐
                    │  Start executor with  │
                    │  plugins + prompt     │
                    └───────────────────────┘
```

---

## 1. `webhook`

Case-insensitive match against the webhook name configured in Xians Agent Studio.

```json
"webhook": "Default"
```

Only one rule set per webhook name is used — the **first** matching entry in the `rules.json` array wins.

For a rule set triggered on a recurring timer instead of a webhook, replace `webhook` with `schedule` + `cron` — see [§ 8](#8-schedule--cron--time-triggered-rule-sets).

---

## 1b. `platform` & `repository` — Structural Execution Context

These two execution-level fields describe **what the run operates on** — independent of which plugin is used. They sit alongside `match-any` / `use-inputs` / `use-plugins` and are resolved before any plugin runs. The framework uses them directly (credential setup, workspace volume, chat-side input resolution) **and** auto-injects the resolved values into `XIANIX_INPUTS` under canonical kebab-case keys, so plugin prompts and the executor entrypoint can read them off the same keys they always have.

```json
"platform": "github",
"repository": "repository.clone_url"
```

The bare-string form is shorthand for `{ "url": "repository.clone_url" }`. The object form is still accepted when you need a constant URL:

```json
"platform": "github",
"repository": {
  "url": "repository.clone_url"
}
```

| Field             | Type                                                               | Description |
|-------------------|--------------------------------------------------------------------|-------------|
| `platform`        | string literal                                                     | Hosting service (`github`, `azuredevops`, …). Used by the executor to pick the right `git` credential helper and is exposed to plugin prompts as `{{platform}}`. Empty / omitted means the executor will infer from the repo URL (defaults to `github`). |
| `repository`      | string (JSON path) **or** object                                   | Either a bare JSON path for the clone URL (shorthand for `repository.url`) or an object with `url`. |
| `repository.url`  | string (JSON path) **or** `{ value, constant }` object             | Either a JSON path that resolves to the clone URL (the common webhook-driven case) or a hard-coded literal via the constant form (see [Hard-coding the repository](#hard-coding-the-repository-constant-form)). **Mandatory when declared** — if a declared JSON path doesn't resolve, the execution block is skipped before any container starts. Exposed as `{{repository-url}}`. |

> **`{{repository-name}}` is derived, not declared.** A short `owner/repo`-style identifier is computed from the resolved `repository.url` (platform-aware: GitHub, Azure DevOps `_git` URLs, etc.) and auto-injected as `{{repository-name}}`. There is no `repository.name` knob in the schema — clone URL and display name are kept in lockstep so they can never drift. If you need a different display name, pick a different clone URL. The one exception is `schedule` rule sets, which may declare `repository.name` explicitly — see [§ 8](#8-schedule--cron--time-triggered-rule-sets).

#### Hard-coding the repository (constant form)

For runs whose repository is fixed regardless of the webhook payload — cron pings, Slack triggers, single-tenant agents pinned to one repo, manual triggers — wrap the value in `{ "value": "...", "constant": true }`:

```json
"repository": {
  "url": { "value": "https://github.com/my-org/agent-target.git", "constant": true }
}
```

The nested bare-string shorthand (`"url": "repository.clone_url"`) is just sugar for `{ "value": "repository.clone_url", "constant": false }`, so existing object-form rules need no changes.

Constant URLs of course also drive `{{repository-name}}` — the derivation runs on the resolved URL regardless of how it was supplied.

### Why are these separate from `use-inputs`?

- They are **structural** — every webhook-triggered run on a repo needs them, regardless of plugin. Promoting them to execution-level removes per-plugin duplication and makes the contract explicit.
- The framework needs them **before** the plugin loop runs (clone target, credential helper, volume name) — they were already special-cased; now the schema reflects that.
- The chat-driven path (`SupervisorSubagentTools.RunClaudeCodeOnRepository`) treats `RepositoryUrl` / `RepositoryName` as first-class typed fields and derives the display name from the URL the same way the webhook path does. Aligning the webhook schema removes a subtle divergence.
- Executions that don't operate on a repo (e.g. Azure DevOps work-item analysis) just **omit** the `repository` block — no need for `mandatory: false` ceremony on per-plugin inputs.
- The worktree always starts on the **default-branch HEAD**. Task-specific refs are the plugin's job.

### Wire-format

Plugin prompts and `Executor/entrypoint.sh` always read structural values from these canonical `XIANIX_INPUTS` keys (`platform`, `repository-url`, `repository-name`). The agent serialises the resolved structural values into the inputs dict under exactly these keys — they are **not** authored under `use-inputs` and the same key names are not used for anything else. `repository-name` is the derived value (from `repository.url`), not a separate path.

### Mandatory semantics

The structural fields use the **same skip-on-missing behaviour** as a `use-inputs` entry with `"mandatory": true`:

- If a declared sub-field uses the **JSON-path** form (`"url": "repository.clone_url"`) and the path doesn't resolve, the block is skipped with a clear error and no executor container starts.
- The **constant** form (`{ "value": "...", "constant": true }`) skips the resolution check entirely — the literal is taken verbatim, so a constant binding can't fail mid-flight. An empty constant value (`{ "value": "", "constant": true }`) is treated as "field undeclared" rather than "field set to empty" — that's an authoring mistake the framework refuses to silently propagate.
- Other execution blocks in the same rule set are still evaluated — the failure is per-block.
- `platform` is a literal so it always "resolves" — there's nothing to fail.
- `repository-name` is derived from `repository.url` and never fails on its own — if the URL is unparseable the raw URL flows through as the display name so logs stay useful.

---

## 2. `match-any` — Payload Filtering

Inside each execution block, `match-any` is an array of filter rules evaluated with **OR logic**: the block passes if **any** entry matches. If `match-any` is omitted or empty, the block passes unconditionally.

```json
"match-any": [
  { "name": "pr-opened-event",       "rule": "action==opened" },
  { "name": "pr-synchronize-event",  "rule": "action==synchronize" }
]
```

| Field  | Description |
|--------|-------------|
| `name` | Human-readable label (for logging and skip reasons) |
| `rule` | A filter expression — see syntax below |

### Filter Expression Syntax

Each rule is a comparison of a **JSON path** against a **literal value**, optionally combined with `&&` (AND) and `||` (OR) operators:

```
<json-path> <operator> <expected-value>
```

Six operators are supported.

| Operator | Meaning                                         | Case-sensitive | Missing path returns |
|----------|-------------------------------------------------|----------------|----------------------|
| `==`     | Equals                                          | yes | `false` |
| `!=`     | Not equals                                      | yes | `true`  |
| `^=`     | Starts with (string prefix match)               | no  | `false` |
| `!^=`    | Does not start with                             | no  | `true`  |
| `*=`     | Contains (substring match)                      | no  | `false` |
| `!*=`    | Does not contain                                | no  | `true`  |

`^=`, `!^=`, `*=`, and `!*=` only match **string** values — they never match numbers, booleans, or `null`.

The text-search operators (`^=`, `!^=`, `*=`, `!*=`) match **case-insensitively** — they are meant for fuzzy human text such as `@`-mentions and message bodies (e.g. `comment.body*='@xianix'` matches `@Xianix`). Equality (`==`, `!=`) stays **case-sensitive and ordinal** because it targets structured identifiers where case is meaningful (GitHub label and branch names, enum-like statuses).

Two additional **unary** operators check whether a path exists (resolves to a non-null value) without comparing against a right-hand side:

| Operator | Meaning                                              | Missing path returns |
|----------|------------------------------------------------------|----------------------|
| `?`      | Exists — path resolves and value is not `null`       | `false`              |
| `!?`     | Not exists — path is missing or value is `null`      | `true`               |

Unary operators are appended directly to the path with no value on the right:

```jsonc
// Passes when the payload has a non-null "pull_request.title"
"rule": "pull_request.title?"

// Passes when the payload does NOT have a "pull_request.draft" field (or it is null)
"rule": "pull_request.draft!?"
```

### Compound Expressions

Multiple conditions can be combined in a single rule using `&&` (AND) and `||` (OR):

| Operator | Meaning | Precedence |
|----------|---------|------------|
| `&&`     | AND — all conditions in the group must be true | Higher |
| `||`     | OR — at least one group must be true           | Lower  |

`||` has lower precedence than `&&`. The rule is split into OR-groups first, then each group is split into AND-conditions.

```jsonc
// Both conditions must be true
"rule": "eventType==workitem.updated&&status==Active"

// Either condition can be true
"rule": "action==opened||action==reopened"

// Mixed: (A AND B) OR (C AND D)
"rule": "eventType==created&&status==New||eventType==updated&&status==Active"
```

### Quoted Values

If the expected value contains `&&` or `||` (or you want a single-quoted literal), wrap it in **single quotes**:

```jsonc
"rule": "assignee=='some-user <user@example.com>'"
```

Quotes are optional for simple values. Both of these are equivalent:

```jsonc
"rule": "action==opened"
"rule": "action=='opened'"
```

### JSON Paths

JSON paths use dot notation to traverse the payload. Given:

```json
{ "action": "opened", "pull_request": { "draft": false } }
```

| Expression                  | Result  |
|-----------------------------|---------|
| `action==opened`            | `true`  |
| `action!=closed`            | `true`  |
| `pull_request.draft==false` | `true`  |
| `action==closed`            | `false` |

Type coercion is handled automatically — strings, numbers, booleans, and `null` are compared against the literal on the right-hand side.

#### Property names that contain `.`

If an object **key** contains a dot (common on Azure DevOps, e.g. `System.AssignedTo`), a plain dot-separated path would be ambiguous. Wrap **that segment** in **double quotes** so it is treated as a single property name:

```
resource.fields."System.AssignedTo".newValue
resource.revision.fields."System.Title"
```

Inside a double-quoted segment, a **backslash** escapes the next character (for example if the key itself needed a quote).

This applies to **match** rules and to **`use-inputs`** paths (see below).

#### Arrays: numeric indices

When the value at a path segment is a JSON **array**, a **numeric** segment selects the element at that index (zero-based):

```
items.0.id
resource.reviewers.1.displayName
```

If the index is out of range, the path does not resolve (`==` fails; `!=` treats a missing path as not equal).

#### Arrays: wildcard `*` (match rules only)

For **filter rules** (`match-any`), a path segment `*` means "any element of the array at this point." The prefix before `*` must resolve to an array. The suffix is evaluated against each element until one matches (for positive operators) or none match (for negative operators).

```
resource.reviewers.*.displayName=='xianix-agent'
```

This passes if **any** reviewer object has `displayName` equal to `xianix-agent`. The wildcard works with all operators:

```
// passes if any label name starts with "hotfix/"
labels.*.name^='hotfix/'

// passes if any message in the thread contains a keyword
comments.*.body*='needs review'

// passes if any reviewer has a non-null "email" field
resource.reviewers.*.email?
```

Only **one** `*` segment per path is supported.

Wildcard `*` is **not** supported in **`use-inputs`** paths — use a fixed numeric index there if you need a specific array element.

### Operator Examples

**Starts with (`^=` / `!^=`)**

Match a branch that follows a naming convention, or filter events from a specific bot:

```jsonc
// Trigger only for feature branches
"rule": "pull_request.head.ref^=feature/"

// Skip anything pushed by a bot account
"rule": "sender.login!^=bot-"

// Azure DevOps: source branch is a release branch
"rule": "resource.sourceRefName^=refs/heads/release/"
```

**Contains (`*=` / `!*=`)**

Match free-form text fields like commit messages, PR titles, or notification messages:

```jsonc
// Trigger when a PR title signals a breaking change
"rule": "pull_request.title*=BREAKING"

// Azure DevOps: react to specific activity messages
"rule": "message.text*='updated the source branch'"
"rule": "message.text*='as a reviewer'"

// Skip draft descriptions that mention WIP
"rule": "pull_request.body!*=[WIP]"
```

**Exists (`?` / `!?`)**

Check whether a field is present (and non-null) in the payload — useful for optional fields that aren't always sent:

```jsonc
// Only trigger when the payload carries a pull_request object
"rule": "action==opened&&pull_request?"

// Trigger when a reviewer has been assigned (field present)
"rule": "requested_reviewer.login?"

// Skip payloads that have no body text
"rule": "pull_request.body?"

// Only match when the milestone is NOT set
"rule": "pull_request.milestone!?"
```

---

## 3. `use-inputs` — Payload Extraction

Extracts values from the webhook payload into named variables. They are used for `execute-prompt` interpolation and are forwarded to the executor (for example as `XIANIX_INPUTS`).

> **Don't put structural context here.** `platform`, `repository-url`, and `repository-name` are declared at the [execution level](#1b-platform--repository--structural-execution-context) and auto-injected into `XIANIX_INPUTS` for you. Authoring them under `use-inputs` is unsupported — the framework uses the structural fields for credential setup, volume management, and chat-side input validation.

```json
"use-inputs": [
  { "name": "pr-number", "value": "number",             "mandatory": true },
  { "name": "pr-title",  "value": "pull_request.title" }
]
```

| Field       | Description |
|-------------|-------------|
| `name`      | Key in the extracted dictionary |
| `value`     | Dot-separated JSON path into the payload, **or** a literal when `constant` is `true` |
| `constant`  | *(optional, default `false`)* When `true`, `value` is used as-is instead of resolving a path |
| `mandatory` | *(optional, default `false`)* When `true`, the execution block is **skipped** if this input resolves to `null`, an empty string, or a whitespace-only string |

When a mandatory input fails, the execution block is skipped with a clear error message listing which inputs were missing. Other execution blocks in the same rule set are still evaluated — a single missing mandatory input does not abort the entire webhook.

### Path Resolution Examples

Given:

```json
{
  "number": 42,
  "repository": { "clone_url": "https://github.com/acme/app.git", "full_name": "acme/app" },
  "pull_request": { "title": "Fix auth bug", "head": { "ref": "fix/auth" } }
}
```

| Input definition | Resolved value |
|------------------|----------------|
| `"value": "number"` | `42` |
| `"value": "pull_request.head.ref"` | `"fix/auth"` |
| `"value": "pull_request.title"` | `"Fix auth bug"` |
| `"value": "high", "constant": true` | `"high"` (literal) |
| `"value": "resource.revision.fields.\"System.Title\""` (path uses a quoted segment for a dotted key) | Azure DevOps work item `System.Title` |

> Need the clone URL, repo name, or platform in your prompt? Reference `{{repository-url}}`, `{{repository-name}}`, or `{{platform}}` directly — they're auto-injected from the [structural fields](#1b-platform--repository--structural-execution-context).

If a path does not resolve (missing property), the input is set to `null`. If the input is marked `"mandatory": true`, the entire execution block is skipped instead.

---

## 4. `use-plugins` — Plugin Installation

Declares Claude Code marketplace plugins to install in the executor container before the prompt runs.

```json
"use-plugins": [
  {
    "plugin-name": "pr-reviewer@xianix-plugins-official",
    "marketplace": "xianix-team/plugins-official"
  }
]
```

| Field           | Required | Description |
|-----------------|----------|-------------|
| `plugin-name`   | Yes | Plugin reference in `plugin-name@marketplace-name` form, passed to `claude plugin install` |
| `marketplace`   | No  | Marketplace source (`owner/repo`, git URL, path, or `marketplace.json` URL). Omit for the built-in Anthropic marketplace. |

> **Heads-up** — credentials a plugin needs (GitHub PAT, Azure DevOps PAT, third-party API keys) are **not** declared per-plugin. They live at the execution-block level in [`with-envs`](#5-with-envs--container-environment-variables) so a single value like `GITHUB-TOKEN` only has to be written once even when multiple plugins consume it.

---

## 5. `with-envs` — Container Environment Variables

Declares environment variables to inject into the executor container before the prompt runs. It can sit at the **execution-block** level (sibling to `use-plugins`) — where every variable is available to every plugin and to the prompt itself, regardless of how many plugins consume it — or at the **rule-set** level (sibling to `executions`), where it's merged into **every** execution block in that rule set. The latter is common for `schedule` rule sets (see [§ 8](#8-schedule--cron--time-triggered-rule-sets)), where credentials are typically the same across the rule set's executions.

```json
"with-envs": [
  { "name": "GITHUB-TOKEN",       "value": "secrets.GITHUB-TOKEN", "mandatory": true },
  { "name": "REVIEW_MODE",        "value": "strict",               "constant": true }
]
```

The executor container already has a small set of agent-managed variables present before any plugin runs. `with-envs` lets you **add** to that set — for tenant credentials, plugin configuration flags, or any value the prompt or its plugins need.

#### Variables automatically present in the container

The only variable seeded into every container from the agent host is:

| Variable              | Description |
|-----------------------|-------------|
| `ANTHROPIC_API_KEY`   | Anthropic API key (read directly by the Claude Code SDK). Set via `ANTHROPIC-API-KEY` in the agent's `.env` — same value for every tenant. |

CM platform tokens (`GITHUB-TOKEN`, `AZURE-DEVOPS-TOKEN`, …) are **not** read from the agent host. Each tenant must store their own in the **Xians Secret Vault** and declare them in `rules.json` via `with-envs`:

```json
"with-envs": [
  { "name": "GITHUB-TOKEN",       "value": "secrets.GITHUB-TOKEN",       "mandatory": true },
  { "name": "AZURE-DEVOPS-TOKEN", "value": "secrets.AZURE-DEVOPS-TOKEN", "mandatory": true }
]
```

This guarantees that two tenants never share the same platform credential — a tenant whose vault is missing the secret fails fast (when paired with `mandatory: true`) instead of silently borrowing a host-wide token.

#### Renaming a value for a plugin

Some Claude Code plugins expect a specific variable name that differs from the credential's canonical name. Use `with-envs` to expose the value under the name the plugin requires — the lookup form (`secrets.*`, `host.*`, or constant) determines where the value comes from, while `name` controls how the container sees it:

```json
{ "name": "GITHUB_PERSONAL_ACCESS_TOKEN", "value": "secrets.GITHUB-TOKEN" }
```

This fetches `GITHUB-TOKEN` from the tenant Secret Vault and makes it available as `GITHUB_PERSONAL_ACCESS_TOKEN` inside the container — so the plugin can find it without any changes to how the credential is stored.

#### Three value forms at a glance

The `value` field supports three resolution forms — every entry **must** pick one explicitly. Bare names and unrecognised prefixes (including the legacy `env.X`) fail the activation with a non-retryable error so a typo can never silently leak a host env var into the container:

| Form                  | Resolved from                                              | When to use |
|-----------------------|------------------------------------------------------------|-------------|
| `host.VAR_NAME`       | Agent process environment (`.env` file / host env vars)    | Genuinely host-wide settings that are the same for every tenant (e.g. `ANTHROPIC-API-KEY`, deployment knobs) |
| `secrets.SECRET-KEY`  | **Tenant-scoped Xians Secret Vault** (encrypted at rest)   | Per-tenant credentials — GitHub PAT, Azure DevOps PAT, third-party API keys. The recommended (and only) place for credentials that differ per tenant. |
| Literal + `"constant": true` | The string is used verbatim                         | Plugin flags, region identifiers, public URLs, anything that isn't a credential |

#### `host.` reference syntax

Prefix the value with `host.` to read a variable from the **agent host** (the agent process environment, populated from the agent's `.env` file or whatever the deployment exports). The `host.` prefix is stripped and the remainder is the variable name to look up:

```json
{ "name": "MY_PLUGIN_TOKEN",    "value": "host.GITHUB_TOKEN" }
{ "name": "AZURE_PAT",          "value": "host.AZURE_DEVOPS_TOKEN" }
{ "name": "CUSTOM_SERVICE_KEY", "value": "host.MY_CUSTOM_API_KEY" }
```

If the referenced variable is not set on the host, the injected value will be an empty string. Combine with `"mandatory": true` to fail-fast instead.

> **Use `host.*` sparingly.** Anything tenant-specific belongs in the Secret Vault (`secrets.*`) — `host.*` is for values that are genuinely the same for every tenant on the agent.

#### `secrets.` reference syntax

Prefix the value with `secrets.` to fetch the credential from the **tenant-scoped Xians Secret Vault** at container-start time. The `secrets.` prefix is stripped and the remainder is treated as the secret **key** to look up in the active tenant's vault:

```json
{ "name": "GITHUB-TOKEN",          "value": "secrets.GITHUB-TOKEN",          "mandatory": true }
{ "name": "OPENAI_API_KEY",        "value": "secrets.openai-api-key",        "mandatory": true }
{ "name": "STRIPE_WEBHOOK_SECRET", "value": "secrets.stripe-webhook-secret" }
```

Under the hood, the agent runs the equivalent of:

```csharp
var vault   = XiansContext.CurrentAgent.Secrets.TenantScope();
var fetched = await vault.FetchByKeyAsync("GITHUB-TOKEN");
// fetched.Value is injected as the named env var inside the container.
```

Resolution rules:

- **Tenant scope is automatic.** The lookup is bound to the tenant that owns the inbound webhook — different tenants can store different values under the same key without colliding.
- **Encrypted at rest.** Values are stored AES-256-GCM-encrypted server-side; the agent only ever sees the decrypted plaintext in memory while building the container env.
- **No host-level fallback for platform credentials.** The agent host's `.env` no longer provides `GITHUB-TOKEN` / `AZURE-DEVOPS-TOKEN` — these *must* live in each tenant's vault, so a misconfigured tenant can never silently borrow another tenant's PAT.
- **Missing or empty secret** → the value resolves to an empty string. Combine with `"mandatory": true` (see below) to fail-fast instead of starting the container with a blank credential.
- **Vault errors are non-fatal** unless the entry is also `mandatory` — they are logged and the resolved value is empty.
- **Rotation is hot.** Updating a secret in the vault takes effect on the **next** container start; no agent restart or redeploy is required.

Manage the underlying secrets through the Xians Secret Vault (Agent API at `api/agent/secrets`, or any UI/CLI built on top of it) — supports create, list, update, and delete with strict per-tenant scope enforcement.

#### Constant values

Set `"constant": true` to inject a fixed literal string rather than resolving a host variable or a vault secret. This is useful for plugin configuration flags, region identifiers, or any value that does not come from the environment:

```json
{ "name": "REVIEW_MODE",    "value": "strict",    "constant": true }
{ "name": "TARGET_BRANCH",  "value": "main",      "constant": true }
{ "name": "AZURE_ORG_URL",  "value": "https://dev.azure.com/my-org", "constant": true }
```

#### Mandatory entries

Set `"mandatory": true` to make the executor container **fail to start** (non-retryably) when the resolved value is `null` or empty. This is the recommended pattern for any secret the prompt cannot run without:

```json
{ "name": "GITHUB-TOKEN", "value": "secrets.GITHUB-TOKEN", "mandatory": true }
```

The error message lists which env vars were missing and where to set them — the tenant Secret Vault for `secrets.*` entries, or the agent host `.env` for `host.*` entries.

#### Field reference

| Field       | Description |
|-------------|-------------|
| `name`      | Name of the environment variable as it will appear inside the container |
| `value`     | Must use one of three explicit forms: `host.VAR_NAME` (read from the agent host environment), `secrets.SECRET-KEY` (read from the tenant Secret Vault), or a literal string when `constant` is `true`. Bare names and unrecognised prefixes (including the legacy `env.X`) fail the activation with a non-retryable error. |
| `constant`  | *(optional, default `false`)* When `true`, `value` is used as-is without any host or vault lookup |
| `mandatory` | *(optional, default `false`)* When `true`, the executor container fails to start (non-retryable) if the resolved value is `null` or empty |

---

## 6. `execute-prompt` — Claude Code Prompt Template

A string template run as the Claude Code prompt after plugins are installed. Use `{{input-name}}` placeholders for resolved `use-inputs` values.

```json
"execute-prompt": "You are reviewing PR #{{pr-number}} titled \"{{pr-title}}\" in {{repository-name}}.\n\nRun /pr-review {{pr-number}} to perform the automated review."
```

Placeholders are replaced case-insensitively. Any `{{name}}` with no matching input is left unchanged.

---

## 7. Cost & Execution Controls

Seven optional fields on every execution block let you tune cost, speed, and safety — from picking a cheaper model to hard-capping spend. All are omitted by default so existing rules work unchanged.

```json
{
  "model":            "claude-haiku-4-5",
  "max-turns":        40,
  "allowed-tools":    ["Read", "Grep", "Bash"],
  "disallowed-tools": ["WebSearch", "WebFetch"],
  "max-budget-usd":   1.00,
  "resume-sessions":  true,
  "conversation-key": "pull_request.number"
}
```

### `model` — Model selection

Route a block to a specific Claude model. Omit to use the executor's configured default (Sonnet-class).

```json
"model": "claude-haiku-4-5"
```

Use a cheaper model for mechanical tasks (requirement analysis, simple summaries) and the full Sonnet for deep reasoning (PR reviews, architecture decisions):

```json
{ "name": "github-issue-triage",        "model": "claude-haiku-4-5",   ... }
{ "name": "github-pull-request-review", "model": "claude-sonnet-4-5",  ... }
```

> Regardless of the main model, Claude Code's internal background work (session titles, mini-summaries) is always routed to a Haiku-class model by the executor — you don't need to configure that separately.

### `max-turns` — Turn cap

Limits the number of tool-use round-trips the agent is allowed. Once the cap is reached the run completes with whatever the agent produced up to that point.

```json
"max-turns": 40
```

The container wall-clock timeout (`CONTAINER-EXECUTION-TIMEOUT-SECONDS`) is always the final backstop. `max-turns` is a token backstop that fires *before* the clock runs out, preventing runaway loops on complex repos.

A host-wide opt-in default can be set via `EXECUTOR-DEFAULT-MAX-TURNS` in the agent `.env` — this applies to every run that doesn't set its own `max-turns`.

### `allowed-tools` and `disallowed-tools` — Tool control

These two fields work differently and serve different purposes:

| Field | Effect |
|-------|--------|
| `allowed-tools` | Auto-approves the listed tools (no permission prompt). Unlisted tools are still available and fall through to the executor's `bypassPermissions` mode. |
| `disallowed-tools` | Removes the listed tools from the agent's context entirely. The agent cannot see or use them. |

> **Restriction requires `disallowed-tools`.** Because the executor runs in `bypassPermissions` mode, `allowed-tools` alone does not restrict anything — every tool is already approved. To actually block a tool, add it to `disallowed-tools`.

```json
"disallowed-tools": ["WebSearch", "WebFetch"]
```

You can also scope a denial to a pattern within a tool rather than blocking it entirely. A bare name blocks the whole tool; a scoped form like `"Bash(rm *)"` only blocks calls that match the pattern:

```json
"disallowed-tools": ["WebSearch", "Bash(rm *)"]
```

### `max-budget-usd` — Spend cap

Hard USD cap per run, passed to the Claude Code SDK. The run is aborted by the SDK once cumulative token spend crosses this threshold.

```json
"max-budget-usd": 1.50
```

The configured budget and an over-budget flag are recorded in metrics, so you can chart how often a block is hitting its cap and tune accordingly.

### `resume-sessions` + `conversation-key` — Session reuse

When `resume-sessions` is `true`, the executor persists the Claude Code session ID on the tenant volume after each run and resumes it on the next run against the same conversation. This means the agent remembers what it read and did on the previous review instead of rediscovering the codebase from scratch.

Getting session resume takes **two fields** on the execution block:

```json
"resume-sessions":  true,
"conversation-key": "pull_request.number"
```

1. **`resume-sessions: true`** turns the feature on (forwarded to the executor as `XIANIX-RESUME-SESSIONS`).
2. **`conversation-key`** tells the framework which payload field identifies the conversation — i.e. which runs should share a session. For a GitHub PR review that's `"pull_request.number"`; for an Azure DevOps PR it's `"resource.pullRequestId"`; for an issue-analysis flow it might be `"issue.number"`.

The resolved value is auto-injected into `XIANIX_INPUTS` as the canonical `conversation-id` key. The executor treats it as an **opaque** session key (filename-sanitised, no meaning attached) — same run against the same repo with the same `conversation-id` resumes; anything else starts fresh. Sessions are stored per tenant + repository volume, so the same PR number in two different repositories never collides.

`conversation-key` accepts the same two forms as the `repository` sub-fields: a bare string is a JSON path into the webhook payload, and `{ "value": "...", "constant": true }` pins a literal (useful for e.g. a cron flow where every run is one ongoing conversation).

This is most valuable for bursty flows — a PR that receives multiple pushes in quick succession, or an issue that gets re-analysed after a comment. On the first run (or when no prior session is found) a fresh session starts automatically, so the flags are always safe to set.

> **Best-effort, never blocking.** A missing or expired session silently falls back to a fresh run, and — unlike the `repository` bindings — a `conversation-key` path that doesn't resolve does **not** skip the execution block; the run simply proceeds without session keying. Setting `resume-sessions: true` without a `conversation-key` is valid but inert: with no key there is nothing to resume against, so every run starts fresh.

### Cached repository context (`CLAUDE.md` + symbol map)

Independent of the per-block fields above, the executor prepares a cached orientation for every repo so the agent doesn't re-explore the codebase cold on every run — the single biggest avoidable token sink. Two artifacts are built **deterministically** (no LLM cost) from the checked-out code and cached on the tenant volume, keyed by the branch HEAD (so they're rebuilt only when HEAD moves):

- **`CLAUDE.md`** — project overview, detected stack/commands, top-level layout, and a pointer to the symbol map. Claude Code auto-loads `CLAUDE.md` from the working directory.
- **`.xianix/repomap.txt`** — a compact file→symbol map (functions/classes per file) so the agent can locate code by symbol instead of grepping.

> **Your `CLAUDE.md` always wins.** If your repository already ships a `CLAUDE.md`, the executor leaves it completely untouched — nothing is overwritten or appended — and the optional LLM pass below is skipped.

**Optional hybrid narrative (host opt-in).** When the operator enables it (host `EXECUTOR-CONTEXT-LLM=1`, or per rule-set via an `XIANIX-CONTEXT-LLM` entry in `with-envs`), a cheap, turn- and time-capped Haiku pass appends an **Architecture & conventions** narrative to the generated `CLAUDE.md` — the *why* the deterministic facts can't capture. It runs at most once per HEAD change (on a cache miss), so its cost is amortised across every later run that reuses the cache, and any failure silently falls back to the deterministic-only `CLAUDE.md`.

### Field reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `model` | string | *(executor default)* | Claude model name (e.g. `claude-haiku-4-5`, `claude-sonnet-4-5`). |
| `max-turns` | integer | *(none)* | Maximum agent turns before the run completes. |
| `allowed-tools` | string array | `[]` | Tools to auto-approve (does not restrict). |
| `disallowed-tools` | string array | `[]` | Tools to remove from the agent's context. Accepts bare names (`"WebSearch"`) or scoped patterns (`"Bash(rm *)"`). |
| `max-budget-usd` | number | *(none)* | USD spend cap; run aborted by the SDK once crossed. |
| `resume-sessions` | boolean | `false` | Resume the prior session for this conversation. Requires `conversation-key` to define the conversation identity. |
| `conversation-key` | string (JSON path) or `{ value, constant }` object | *(none)* | Payload field (or constant) identifying the conversation; injected as `conversation-id`. Best-effort — an unresolvable path never skips the block. |

---

## 8. `schedule` & `cron` — Time-Triggered Rule Sets

A rule set doesn't have to wait for a webhook. Replace `webhook` with `schedule` (a name for logs and skip messages) and add `cron` to run the rule set's executions on a recurring timer instead:

```json
{
  "schedule": "...",
  "cron": "*/5 * * * *",
  "with-envs": [ ... ],
  "executions": [ ... ]
}
```

| Field | Description |
|-------|-------------|
| `schedule` | Identifies the rule set in logs and skip messages — the cron analogue of `webhook`. |
| `cron` | Standard 5-field cron expression (`minute hour day-of-month month day-of-week`). Controls how often **every** execution in this rule set runs. |

### No payload → no `match-any` / `use-inputs`

A cron tick carries no webhook payload, so executions in a `schedule` rule set:

- **Omit `match-any`** — there's nothing to filter on, so every execution block in the rule set runs on every tick.
- **Omit `use-inputs`** — there's no payload to extract values from. The structural placeholders `{{platform}}`, `{{repository-name}}`, and `{{git-ref}}` are still auto-injected and available to `execute-prompt` (see [§ 1b](#1b-platform--repository--structural-execution-context)).

Everything else — `use-plugins`, `with-envs`, the [cost & execution controls](#7-cost--execution-controls) (`model`, `max-turns`, `allowed-tools`, `disallowed-tools`, `max-budget-usd`, `resume-sessions`), and `execute-prompt` — works exactly as it does in `webhook` executions.

### `repository` as plain literals

Without a payload, there's nothing for `repository.url` / `repository.ref` to resolve a JSON path against, so they're written as **plain literal strings** — the same effect as the [constant form](#hard-coding-the-repository-constant-form) (`{ "value": "...", "constant": true }`), just without the wrapper:

```json
"repository": {
  "url": "https://github.com/my-org/agent-target.git",
  "name": "my-org/agent-target",
  "ref": "main"
}
```

`repository.name` *(optional)* explicitly sets `{{repository-name}}`, overriding the value that would otherwise be [derived](#1b-platform--repository--structural-execution-context) from `url`.

### Rule-set-level `with-envs`

`with-envs` declared as a sibling of `executions` (rather than inside an execution block) is merged into every execution in the rule set — see [§ 5](#5-with-envs--container-environment-variables):

```json
"with-envs": [
  { "name": "GITHUB-TOKEN",      "value": "secrets.GITHUB-TOKEN",      "mandatory": true },
  { "name": "ANTHROPIC-API-KEY", "value": "secrets.ANTHROPIC-API-KEY", "mandatory": true }
]
```

### Complete Example

```json
[
  {
    "schedule": "github-dependency-optimizer-schedule",
    "cron": "*/5 * * * *",
    "with-envs": [
      { "name": "GITHUB-TOKEN",      "value": "secrets.GITHUB-TOKEN",      "mandatory": true },
      { "name": "ANTHROPIC-API-KEY", "value": "secrets.ANTHROPIC-API-KEY", "mandatory": true }
    ],
    "executions": [
      {
        "name": "github-dependency-optimizer",
        "platform": "github",
        "repository": {
          "url": "https://github.com/my-org/agent-target.git",
          "name": "my-org/agent-target",
          "ref": "main"
        },
        "use-plugins": [
          {
            "plugin-name": "dependency-optimizer@xianix-plugins-official",
            "marketplace": "xianix-team/plugins-official"
          }
        ],
        "execute-prompt": "xianix-agent is assigned for dependency health optimization. Run /dependency-optimizer to auto-scan manifests, verify licenses, and automatically open a remediation Pull Request."
      }
    ]
  }
]
```

Every 5 minutes, the agent installs `dependency-optimizer@xianix-plugins-official` into a fresh executor checked out at `my-org/agent-target` (branch `main`), injects `GITHUB-TOKEN` / `ANTHROPIC-API-KEY` from the tenant Secret Vault via the rule-set-level `with-envs`, and runs the prompt — no webhook involved.

---

## Complete Example

A webhook rule set with two executions — a Sonnet-powered PR review with a spend cap and session reuse, plus a Haiku-powered issue analysis with a turn cap — followed by a chat rule set exposing the PR reviewer to chat with its own tuning:

```json
[
  {
    "webhook": "Default",
    "with-envs": [
      { "name": "GITHUB-TOKEN", "value": "secrets.GITHUB-TOKEN", "mandatory": true }
    ],
    "executions": [
      {
        "name": "github-pull-request-review",
        "platform": "github",
        "repository": "repository.clone_url",
        "match-any": [
          { "name": "pr-opened",       "rule": "action==opened" },
          { "name": "pr-synchronize",  "rule": "action==synchronize&&pull_request.labels.*.name=='ai-dlc/pr/pr-review'" }
        ],
        "use-inputs": [
          { "name": "pr-number", "value": "number",             "mandatory": true },
          { "name": "pr-title",  "value": "pull_request.title" }
        ],
        "use-plugins": [
          {
            "plugin-name": "pr-reviewer@xianix-plugins-official",
            "marketplace": "xianix-team/plugins-official"
          }
        ],
        "model":            "claude-sonnet-4-5",
        "max-turns":        60,
        "disallowed-tools": ["WebSearch", "WebFetch"],
        "max-budget-usd":   2.50,
        "resume-sessions":  true,
        "conversation-key": "number",
        "execute-prompt": "You are reviewing pull request #{{pr-number}} titled \"{{pr-title}}\" in the repository {{repository-name}}.\n\nRun /pr-review {{pr-number}} to perform the automated review. The `gh` CLI is authenticated and available if you need it directly."
      },
      {
        "name": "github-issue-requirement-analysis",
        "platform": "github",
        "repository": "repository.clone_url",
        "match-any": [
          { "name": "issue-labeled", "rule": "action==labeled&&label.name=='ai-dlc/issue/analyze'" }
        ],
        "use-inputs": [
          { "name": "issue-number", "value": "issue.number", "mandatory": true }
        ],
        "use-plugins": [
          {
            "plugin-name": "req-analyst@xianix-plugins-official",
            "marketplace": "xianix-team/plugins-official"
          }
        ],
        "model":     "claude-haiku-4-5",
        "max-turns": 30,
        "execute-prompt": "Issue #{{issue-number}} in {{repository-name}} has been assigned for requirement analysis.\n\nRun /requirement-analysis {{issue-number}} to perform the automated analysis."
      }
    ]
  },
  {
    "chat": "chat",
    "model": "claude-sonnet-4-5",
    "max-budget-usd": 5.0,
    "use-plugins": [
      {
        "plugin-name": "pr-reviewer@xianix-plugins-official",
        "marketplace": "xianix-team/plugins-official"
      }
    ]
  }
]
```

### Work-item example (no repository)

Executions that don't operate on a repo simply omit the `repository` block. `platform` can still be set to drive credential resolution:

```json
[
  {
    "webhook": "Default",
    "executions": [
      {
        "name": "azuredevops-workitem-triage",
        "platform": "azuredevops",
        "match-any": [
          { "name": "workitem-created", "rule": "eventType==workitem.created" }
        ],
        "use-inputs": [
          { "name": "workitem-id",    "value": "resource.id",                                  "mandatory": true },
          { "name": "workitem-title", "value": "resource.fields.\"System.Title\"" }
        ],
        "use-plugins": [
          {
            "plugin-name": "workitem-triage@xianix-plugins-official",
            "marketplace": "xianix-team/plugins-official"
          }
        ],
        "with-envs": [
          { "name": "AZURE-DEVOPS-TOKEN", "value": "secrets.AZURE-DEVOPS-TOKEN", "mandatory": true }
        ],
        "execute-prompt": "Triage Azure DevOps work item #{{workitem-id}}: \"{{workitem-title}}\". Run /workitem-triage to suggest area path, iteration, and labels."
      }
    ]
  }
]
```

### Azure DevOps example: work item field with a dotted name

Filter when a field whose key contains dots changes (quoted segment):

```jsonc
"rule": "eventType==workitem.updated&&resource.fields.\"System.AssignedTo\".newValue=='xianix-agent <xianix-agent@99x.io>'"
```

### Azure DevOps example: PR updated with a specific reviewer

Require both the event type and the agent in the reviewers list:

```jsonc
"rule": "eventType==git.pullrequest.updated&&resource.reviewers.*.displayName=='xianix-agent'"
```

### Azure DevOps example: PR activity via `contains`

Trigger on specific activity messages such as a source branch push or a reviewer being assigned:

```jsonc
// Source branch was updated
"rule": "eventType==git.pullrequest.updated&&resource.reviewers.*.displayName=='xianix-agent'&&message.text*='updated the source branch'"

// Agent was added as a reviewer
"rule": "eventType==git.pullrequest.updated&&resource.reviewers.*.displayName=='xianix-agent'&&message.text*='as a reviewer'"
```

### Example: branch-convention filter with `starts-with`

Only run the workflow for pull requests targeting a `release/` branch:

```jsonc
"rule": "action==opened&&pull_request.base.ref^=release/"
```

### What Happens at Runtime

1. A webhook fires with a name that matches `webhook` (e.g. `"Default"`).
2. For each execution block, if `match-any` is non-empty, at least one `rule` must pass.
3. **Structural fields are resolved first** — `platform` and `repository` / `repository.url`. A bare-string `repository` is treated as a JSON path for the clone URL. JSON-path bindings are looked up against the payload; constant bindings (`{ "value": "...", "constant": true }`) are taken verbatim. If a declared *path* doesn't resolve, the block is skipped — constants never fail to resolve.
4. `use-inputs` are resolved from the payload, and the resolved structural values are auto-injected back into the inputs dict under the canonical keys `platform` / `repository-url`. The short `repository-name` (e.g. `owner/repo`) is **derived** from `repository-url` (platform-aware: handles GitHub, Azure DevOps `_git` URLs, etc.) and injected alongside them so prompts and plugins see a single combined view.
5. `execute-prompt` is interpolated with those inputs (including the auto-injected structural values).
6. The agent resolves `with-envs` (literals, `host.*`, `secrets.*`) and injects them into the executor container alongside the runtime values it manages itself (`ANTHROPIC_API_KEY`, etc.).
7. **Cost & execution controls are applied** — `model`, `max-turns`, `allowed-tools`, `disallowed-tools`, `max-budget-usd`, and `resume-sessions` are forwarded to the executor as typed env vars (`XIANIX-MODEL`, `XIANIX-MAX-TURNS`, etc.). Any field that is not set is simply not seeded, so the executor falls back to its own defaults — there is no behavioral change for existing rules that don't declare these fields.
8. The executor installs `use-plugins`, injects a cached `CLAUDE.md` and symbol map into the worktree so the agent doesn't re-explore the codebase from scratch (skipped when the repo ships its own `CLAUDE.md`; optionally enriched with an LLM-authored architecture narrative when `EXECUTOR-CONTEXT-LLM` / `XIANIX-CONTEXT-LLM` is enabled), optionally resumes a prior session (when `resume-sessions: true`), and runs the final prompt with the configured model, turn cap, tool restrictions, and spend cap applied.

For `schedule` rule sets, step 1 becomes "the `cron` expression ticks," and steps 2 and the payload half of step 4 don't apply — there's no `match-any` or `use-inputs` to evaluate. Every execution in the rule set proceeds straight to step 3 on each tick. See [§ 8](#8-schedule--cron--time-triggered-rule-sets).
