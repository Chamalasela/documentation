---
title: Schedules Configuration
description: How schedules.json controls what the agent does on schedules.
---

`schedules.json` is the central configuration that defines both when the **agent runs using time-based scheduling** such as cron expressions and what the agent does when it is **triggered through its execution logic**. Each entry in the JSON array represents a self-contained configuration that includes a schedule and can also define constant inputs, allowing the agent to run automatically at specified intervals with predefined data.

```
schedules.json  →  ScheduleEvaluator  →  CognitiveDispatcher  →  JobDispatcherWorkflow  →  ProcessingWorkflow  →  Executor Container
```

In the **the-agent** reference implementation, the default file is `Knowledge/schedules.json`, embedded at agent registration as Xians knowledge document **`Schedules`**.

---

## File Structure

`schedules.json` is a JSON array of schedule configuration objects. Each object defines a cron-based trigger and a single execution pipeline, including constant inputs, plugins, environment variables, and a prompt.

```jsonc
[
  {
    "schedule": "...",
    "cron": "...",
    "use-inputs": { ... },
    "use-plugins": [ ... ],
    "with-envs": [ ... ],
    "execute-prompt": "..."
  }
]
```

| Field            | Description                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| `schedule`       | Unique name for the schedule (used for identification and logging)                                 |
| `cron`           | Cron expression defining when the agent should run                                                 |
| `use-inputs`     | Constant inputs provided to the execution (static key-value pairs available in the prompt)         |
| `use-plugins`    | List of plugins to install and use during execution                                                |
| `with-envs`      | Environment variables injected into the execution container before the prompt runs. Each value must      
                     explicitly define its source (e.g., `host.KEY`, `secrets.KEY`, or a constant)                      |
| `execute-prompt` | The prompt template executed by the agent; can reference inputs using `{{...}}` syntax             |


### Evaluation Flow

```
┌──────────────────────────────────────────────────────────────┐
│  Cron Trigger                                                │
│  schedule: "github-pull-request-review-schedule"             │
│  cron: "0 0 * * *"                                           │
└───────────────────────────────┬──────────────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │  Scheduler checks     │
                    │  due schedules        │
                    └───────────┬───────────┘
                                │
                    ┌───────────▼───────────┐
                    │  Trigger schedule     │
                    │  when cron matches    │
                    └───────────┬───────────┘
                                │
                    ┌───────────▼───────────┐
                    │  Load use-inputs      │
                    │  (constant values)    │
                    └───────────┬───────────┘
                                │
                    ┌───────────▼───────────┐
                    │  Inject with-envs     │
                    │  into container       │
                    └───────────┬───────────┘
                                │
                    ┌───────────▼───────────┐
                    │  Interpolate          │
                    │  execute-prompt       │
                    │  with {{inputs}}      │
                    └───────────┬───────────┘
                                │
                    ┌───────────▼───────────┐
                    │  Start executor with  │
                    │  plugins + prompt     │
                    └───────────────────────┘
```

---

## 1. `schedule`

Unique identifier for the scheduled run. Used for logging, traceability, and debugging.

```json
  "schedule": "github-pull-request-review-schedule"
```

Each entry in `schedules.json` is independent and triggered based on its own cron definition.

---

## 2. `cron` — Time-Based Trigger

Defines **when the agent runs** using a standard cron expression.

```json
  "cron": "0 0 * * *"
```
| Field  | Description                                                                          |
| ------ | ------------------------------------------------------------------------------------ |
| `cron` | Cron expression that determines the execution schedule (e.g., every day at midnight) |


The scheduler continuously evaluates all entries and triggers executions when their cron expression matches the current time.

---

## 3. `use-inputs` — Constant Inputs

Defines static inputs provided to the execution. Unlike webhook-based configurations, these values are not extracted from a payload they are predefined constants.

```json
  "use-inputs": {
    "pr-number": "111",
    "repository-url": "https://github.com/abc/abc.git",
    "pr-title": "Test",
    "pr-head-branch": "3799e5e715d1b1eea645295ed4a238e7bae51314",
    "platform": "github"
  }
```
| Field           | Description                                                      |
| --------------- | ---------------------------------------------------------------- |
| key/value pairs | Static inputs available to the prompt via `{{key}}` placeholders |

These inputs are directly injected into the execution context and do not require resolution or validation against external data.

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

Declares environment variables to inject into the executor container before the prompt runs. Sits at the **execution-block** level (sibling to `use-plugins`) — every variable is available to every plugin and to the prompt itself, regardless of how many plugins consume it.

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

CM platform tokens (`GITHUB-TOKEN`, `AZURE-DEVOPS-TOKEN`, …) are **not** read from the agent host. Each tenant must store their own in the **Xians Secret Vault** and declare them in `schedules.json` via `with-envs`:

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

Resolution schedules:

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
"execute-prompt": "You are reviewing PR #{{pr-number}} titled \"{{pr-title}}\" in {{repository-name}} (branch: {{git-ref}}).\n\nRun /code-review to perform the automated review."
```

Placeholders are replaced case-insensitively. Any `{{name}}` with no matching input is left unchanged.

---

## Complete Example

A schedules set with one execution that reviews newly opened GitHub pull requests:

```json
[
  {
    "schedule": "github-pull-request-review-schedule",
    "cron": "0 0 * * *",
    "use-inputs": {
      "pr-number": "194",
      "repository-url": "https://github.com/abc/abc.git",
      "repository-name": "abc/abc",
      "pr-title": "Test",
      "pr-head-branch": "3799e5e715d1b1eea645295ed4a238e7bae51314",
      "platform": "github"
    },
    "use-plugins": [
      {
        "plugin-name": "pr-reviewer@xianix-plugins-official",
        "marketplace": "xianix-team/plugins-official"
      }
    ],
    "with-envs": [
      {
        "name": "GITHUB-TOKEN",
        "value": "host.GITHUB-TOKEN",
        "mandatory": true
      }
    ],
    "execute-prompt": "You are reviewing pull request #{{pr-number}} titled \"{{pr-title}}\" in the repository {{repository-name}} (branch: {{pr-head-branch}}).\n\nRun /code-review to perform the automated review."
  }
]
```



### What Happens at Runtime

 1. The scheduler evaluates all entries in `schedules.json.`
 2. When the `cron` expression matches the current time, the schedule is triggered.
 3. `use-inputs` are loaded as constant values.
 4. `with-envs` are resolved and injected into the container.
 5. Plugins defined in `use-plugins` are installed.
 6. `execute-prompt` is interpolated using `{{inputs}}`.
 7. The executor runs the prompt inside the container.
