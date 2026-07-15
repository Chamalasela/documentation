---
title: Rules Configuration
description: How rules.json controls what the agent does — the shared structure behind webhook, schedule, and chat rule sets.
---

`rules.json` is the single configuration surface that controls **what the agent does**. Each entry in the JSON array is a self-contained **rule set** triggered by one of three things:

- an inbound **webhook** (`webhook`) — see [Webhook Rule Sets](/agent-configuration/rules/webhooks/),
- a recurring **cron schedule** (`schedule` + `cron`) — see [Schedule Rule Sets](/agent-configuration/rules/schedules/),
- an interactive **chat** dispatch (`chat`) — see [Chat Rule Sets](/agent-configuration/rules/chat/).

Every rule set maps to one or more **execution blocks** (chat rule sets are the exception — they have no `executions`). Each block independently declares payload filters, input extraction, plugin installation, and a Claude Code prompt template — so a single inbound event (or a recurring tick) can fan out into multiple specialised workflows without any custom code.

```
rules.json  →  WebhookRulesEvaluator  →  EventOrchestrator  →  ProcessingWorkflow  →  Executor Container
```

In the **the-agent** reference implementation, the default file is `Knowledge/rules.json`, embedded at agent registration as Xians knowledge document **`Rules`**. The same document holds webhook, schedule, and chat rule sets side by side — each reader keeps only the entries whose discriminator key it recognises.

---

## Three kinds of rule set

The top-level `rules.json` array can mix all three rule-set kinds. Each object is discriminated by which of these keys is present:

| Key | Trigger | Has `executions`? | Page |
|-----|---------|-------------------|------|
| `webhook` | An inbound event whose name matches (case-insensitively). Filters and extracts from the payload. | Yes | [Webhook Rule Sets](/agent-configuration/rules/webhooks/) |
| `schedule` + `cron` | A recurring timer. No payload — every execution runs on each tick. | Yes | [Schedule Rule Sets](/agent-configuration/rules/schedules/) |
| `chat` | An interactive chat dispatch. Lists the plugins the chat tool may offer, plus tuning. | No | [Chat Rule Sets](/agent-configuration/rules/chat/) |

`webhook`, `schedule`, and `chat` are mutually exclusive on a single rule set. This page documents the **building blocks shared across trigger types** — the trigger-specific fields (`match-any`, `use-inputs`, `cron`, `slash-command`, …) live on the pages linked above.

---

## File Structure

`rules.json` is a JSON array of rule-set objects. A **webhook** or **schedule** rule set contains an `executions` array; each execution is an independent pipeline: optional filters, inputs, plugins, envs, tuning, and prompt. A **chat** rule set is shaped differently — it has no `executions` and carries its tuning at the rule-set root. All three kinds can sit side by side in the same array:

```jsonc
[
  {
    // Webhook rule set — triggered by an inbound event.
    "webhook": "Default",
    "with-envs": [                 // rule-set-level — merged into every execution below
      { "name": "AZURE-DEVOPS-TOKEN", "value": "secrets.AZURE-DEVOPS-TOKEN", "mandatory": false },
      { "name": "GITHUB-TOKEN",       "value": "secrets.GITHUB-TOKEN",       "mandatory": false },
      { "name": "ANTHROPIC-API-KEY",  "value": "secrets.ANTHROPIC-API-KEY",  "constant": true }
    ],
    "executions": [
      {
        "name": "...",
        "platform": "...",         // shared — see below
        "repository": "...",       // shared — see below
        "match-any":        [ ... ],   // webhook only
        "use-inputs":       [ ... ],   // webhook only
        "use-plugins":      [ ... ],   // shared
        "with-envs":        [ ... ],   // shared
        "model":            "...",     // shared (cost & execution controls)
        "max-turns":        40,        // shared
        "allowed-tools":    [ ... ],   // shared
        "disallowed-tools": [ ... ],   // shared
        "max-budget-usd":   1.00,      // shared
        "resume-sessions":  false,     // shared
        "conversation-key": "...",     // shared
        "execute-prompt":   "..."      // shared (webhook + schedule)
      }
    ]
  },
  {
    // Schedule rule set — triggered by a recurring cron tick, no payload.
    "schedule": "...",
    "cron":     "*/5 * * * *",
    "timezone": "UTC",
    "with-envs": [ ... ],           // commonly rule-set-level for schedules
    "executions": [
      {
        "name":       "...",
        "platform":   "...",
        "repository": { "url": "...", "name": "...", "ref": "..." },  // literals, no payload to resolve
        "use-plugins":    [ ... ],
        "execute-prompt": "..."      // no match-any / use-inputs — nothing to filter or extract
      }
    ]
  },
  {
    // Chat rule set — no executions; plugins + tuning live at the root.
    "chat":  "...",
    "model": "...",                 // shared (cost & execution controls), applied to every dispatch
    "max-turns":        40,
    "allowed-tools":    [ ... ],
    "disallowed-tools": [ ... ],
    "max-budget-usd":   1.00,
    "resume-sessions":  false,
    "with-envs":   [ ... ],
    "use-plugins": [
      { "plugin-name": "...", "marketplace": "...", "slash-command": "/..." }
    ]
  }
]
```

The following fields are common to every execution block regardless of trigger type. Trigger-specific fields are documented on their own pages.

| Field | Description |
|-------|-------------|
| `executions` | One or more execution blocks; optional per-block `name` for logs and skip messages. |
| `platform` *(per execution, optional)* | Hosting service the run targets (`github`, `azuredevops`, …). Structural — describes *where* the run happens, independent of the plugin. See [`platform` & `repository`](#platform--repository--structural-execution-context). |
| `repository` *(per execution, optional)* | Structural binding for the repository being operated on. Auto-resolved values are exposed to plugins as `{{repository-url}}` / `{{repository-name}}` / `{{git-ref}}`; **`{{repository-name}}` is derived from `url`, never authored**. Omit the whole block for executions that don't operate on a repo. See [`platform` & `repository`](#platform--repository--structural-execution-context). |
| `use-plugins` *(per execution)* | Claude Code marketplace plugins to install before the prompt runs. See [`use-plugins`](#use-plugins--plugin-installation). |
| `with-envs` *(optional, per execution or per rule set)* | Container env vars injected before the prompt runs. Each entry **must** declare its source explicitly: `secrets.KEY`, `host.NAME`, or a literal with `"constant": true`. See [`with-envs`](#with-envs--container-environment-variables). |
| `model` *(per execution, optional)* | Claude model this block runs on. Omit to use the executor default. See [Cost & Execution Controls](#cost--execution-controls). |
| `max-turns` *(per execution, optional)* | Hard cap on agent turns. See [Cost & Execution Controls](#cost--execution-controls). |
| `allowed-tools` *(per execution, optional)* | Tool names auto-approved without a permission prompt. See [Cost & Execution Controls](#cost--execution-controls). |
| `disallowed-tools` *(per execution, optional)* | Tool names (or scoped patterns like `"Bash(rm *)"`) removed from the agent's context. See [Cost & Execution Controls](#cost--execution-controls). |
| `max-budget-usd` *(per execution, optional)* | Hard USD spend cap per run. See [Cost & Execution Controls](#cost--execution-controls). |
| `resume-sessions` *(per execution, optional)* | Resume the prior Claude Code session for the same conversation. Pair with `conversation-key`. See [Cost & Execution Controls](#cost--execution-controls). |
| `conversation-key` *(per execution, optional)* | Binding that identifies the conversation for session-resume keying. Only consulted when `resume-sessions` is `true`. See [Cost & Execution Controls](#cost--execution-controls). |
| `execute-prompt` *(per execution)* | Claude Code prompt template run after plugins install. See [`execute-prompt`](#execute-prompt--claude-code-prompt-template). |

---

## `platform` & `repository` — Structural Execution Context

These two execution-level fields describe **what the run operates on** — independent of which plugin is used. They sit alongside the trigger-specific filters/inputs and are resolved before any plugin runs. The framework uses them directly (credential setup, workspace volume, chat-side input resolution) **and** auto-injects the resolved values into `XIANIX_INPUTS` under canonical kebab-case keys, so plugin prompts and the executor entrypoint can read them off the same keys they always have.

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

> **`{{repository-name}}` is derived, not declared.** A short `owner/repo`-style identifier is computed from the resolved `repository.url` (platform-aware: GitHub, Azure DevOps `_git` URLs, etc.) and auto-injected as `{{repository-name}}`. There is no `repository.name` knob in the schema — clone URL and display name are kept in lockstep so they can never drift. If you need a different display name, pick a different clone URL. The one exception is `schedule` rule sets, which may declare `repository.name` explicitly — see [Schedule Rule Sets](/agent-configuration/rules/schedules/).

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

## `use-plugins` — Plugin Installation

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
| `slash-command` | No  | The Claude Code slash command that invokes the plugin (e.g. `/pr-review`). Optional on webhook/schedule entries (those carry an `execute-prompt`); **required** on [chat](/agent-configuration/rules/chat/) entries so the supervisor knows the exact command. |

> **Heads-up** — credentials a plugin needs (GitHub PAT, Azure DevOps PAT, third-party API keys) are **not** declared per-plugin. They live at the execution-block level in [`with-envs`](#with-envs--container-environment-variables) so a single value like `GITHUB-TOKEN` only has to be written once even when multiple plugins consume it.

---

## `with-envs` — Container Environment Variables

Declares environment variables to inject into the executor container before the prompt runs. It can sit at the **execution-block** level (sibling to `use-plugins`) — where every variable is available to every plugin and to the prompt itself, regardless of how many plugins consume it — or at the **rule-set** level (sibling to `executions`, or sibling to `use-plugins` on a [chat](/agent-configuration/rules/chat/) rule set), where it's merged into **every** execution block in that rule set. This is a common pattern on **webhook** rule sets too — declare a tenant credential like `GITHUB-TOKEN` once at the rule-set root instead of repeating it on every execution block that needs it — and is the norm for [`schedule`](/agent-configuration/rules/schedules/) and [`chat`](/agent-configuration/rules/chat/) rule sets, where credentials are typically the same across every execution in the set.

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

#### Rule-set-level `with-envs`

`with-envs` declared as a sibling of `executions` (rather than inside an execution block) is merged into **every** execution in the rule set. Works the same way on a **webhook** rule set — e.g. declaring `GITHUB-TOKEN` / `AZURE-DEVOPS-TOKEN` / `ANTHROPIC-API-KEY` once at the rule-set root so every execution block gets them without repeating the declaration — and is the common pattern for [`schedule`](/agent-configuration/rules/schedules/) and [`chat`](/agent-configuration/rules/chat/) rule sets, where credentials are typically the same across the set. When an execution declares its own env with the same `name`, the execution-level entry wins (first-wins dedup by name).

```json
"webhook": "Default",
"with-envs": [
  { "name": "AZURE-DEVOPS-TOKEN", "value": "secrets.AZURE-DEVOPS-TOKEN", "mandatory": false },
  { "name": "GITHUB-TOKEN",       "value": "secrets.GITHUB-TOKEN",       "mandatory": false },
  { "name": "ANTHROPIC-API-KEY",  "value": "secrets.ANTHROPIC-API-KEY",  "constant": true }
],
"executions": [ ... ]
```

#### Field reference

| Field       | Description |
|-------------|-------------|
| `name`      | Name of the environment variable as it will appear inside the container |
| `value`     | Must use one of three explicit forms: `host.VAR_NAME` (read from the agent host environment), `secrets.SECRET-KEY` (read from the tenant Secret Vault), or a literal string when `constant` is `true`. Bare names and unrecognised prefixes (including the legacy `env.X`) fail the activation with a non-retryable error. |
| `constant`  | *(optional, default `false`)* When `true`, `value` is used as-is without any host or vault lookup |
| `mandatory` | *(optional, default `false`)* When `true`, the executor container fails to start (non-retryable) if the resolved value is `null` or empty |

---

## `execute-prompt` — Claude Code Prompt Template

A string template run as the Claude Code prompt after plugins are installed. Use `{{input-name}}` placeholders for resolved [`use-inputs`](/agent-configuration/rules/webhooks/#3-use-inputs--payload-extraction) values and the structural placeholders (`{{repository-name}}`, `{{platform}}`, …).

```json
"execute-prompt": "You are reviewing PR #{{pr-number}} titled \"{{pr-title}}\" in {{repository-name}}.\n\nRun /pr-review {{pr-number}} to perform the automated review."
```

Placeholders are replaced case-insensitively. Any `{{name}}` with no matching input is left unchanged.

> `execute-prompt` applies to **webhook** and **schedule** executions. [Chat](/agent-configuration/rules/chat/) rule sets have no `execute-prompt` — the supervisor authors the prompt from the user's message as `{slash-command} {user-target}`.

---

## Cost & Execution Controls

Seven optional fields on every execution block let you tune cost, speed, and safety — from picking a cheaper model to hard-capping spend. All are omitted by default so existing rules work unchanged. Chat rule sets carry the same knobs at their rule-set root (see [Chat Rule Sets](/agent-configuration/rules/chat/)).

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

## Next: pick a trigger

- **[Webhook Rule Sets](/agent-configuration/rules/webhooks/)** — react to inbound GitHub / Azure DevOps events: `webhook`, verification, `match-any` filtering, `use-inputs` extraction, evaluation flow, and full examples.
- **[Schedule Rule Sets](/agent-configuration/rules/schedules/)** — run executions on a recurring `cron` timer with no payload.
- **[Chat Rule Sets](/agent-configuration/rules/chat/)** — expose plugins to the interactive chat tool with their own tuning.
