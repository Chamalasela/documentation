---
title: Schedule Rule Sets
description: Run executions on a recurring cron timer with no inbound payload.
---

A rule set doesn't have to wait for a webhook. Replace `webhook` with `schedule` (a name for logs and skip messages) and add `cron` to run the rule set's executions on a recurring timer instead. A cron tick carries **no payload**, so there's nothing to filter or extract — **every** execution block in the rule set runs on **each** tick.

This page covers the fields specific to the schedule trigger. The building blocks shared with webhook and chat rule sets — [`platform` & `repository`](/agent-configuration/rules/#platform--repository--structural-execution-context), [`use-plugins`](/agent-configuration/rules/#use-plugins--plugin-installation), [`with-envs`](/agent-configuration/rules/#with-envs--container-environment-variables), [`execute-prompt`](/agent-configuration/rules/#execute-prompt--claude-code-prompt-template), and [Cost & Execution Controls](/agent-configuration/rules/#cost--execution-controls) — behave exactly as they do for webhook executions. See the [parent Rules Configuration page](/agent-configuration/rules/).

:::caution[Deactivate and reactivate the agent after schedule changes]
Adding a new `schedule` rule set, or changing an existing one's `cron`, `timezone`, or any other field, does **not** take effect on its own. The scheduler only picks up schedule definitions when the agent starts, so after saving the change you must **deactivate the agent and then reactivate it** in the Xians Agent Studio for the new or updated cron trigger to start firing.
:::

```jsonc
[
  {
    "schedule": "...",
    "cron": "*/5 * * * *",
    "timezone": "UTC",
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

---

## `schedule`, `cron` & `timezone`

| Field | Description |
|-------|-------------|
| `schedule` | Identifies the rule set in logs and skip messages — the cron analogue of `webhook`. Mutually exclusive with `webhook`. |
| `cron` | Standard 5-field cron expression (`minute hour day-of-month month day-of-week`). Controls how often **every** execution in this rule set runs. |
| `timezone` *(optional)* | IANA timezone the `cron` expression is evaluated against. Defaults to `UTC` when omitted. |

```json
{
  "schedule": "nightly-dependency-scan",
  "cron": "0 2 * * *",
  "timezone": "Asia/Colombo",
  "executions": [ ... ]
}
```

---

## No payload → no `match-any` / `use-inputs`

A cron tick carries no webhook payload, so executions in a `schedule` rule set:

- **Omit `match-any`** — there's nothing to filter on, so every execution block in the rule set runs on every tick.
- **Omit `use-inputs`** — there's no payload to extract values from. The structural placeholders `{{platform}}`, `{{repository-name}}`, and `{{git-ref}}` are still auto-injected and available to `execute-prompt` (see [`platform` & `repository`](/agent-configuration/rules/#platform--repository--structural-execution-context)).

Everything else — `use-plugins`, `with-envs`, the [Cost & Execution Controls](/agent-configuration/rules/#cost--execution-controls) (`model`, `max-turns`, `allowed-tools`, `disallowed-tools`, `max-budget-usd`, `resume-sessions`), and `execute-prompt` — works exactly as it does in `webhook` executions.

---

## `repository` as plain literals

Without a payload, there's nothing for `repository.url` / `repository.ref` to resolve a JSON path against, so they're written as **plain literal strings** — the same effect as the [constant form](/agent-configuration/rules/#hard-coding-the-repository-constant-form) (`{ "value": "...", "constant": true }`), just without the wrapper:

```json
"repository": {
  "url": "https://github.com/my-org/agent-target.git",
  "name": "my-org/agent-target",
  "ref": "main"
}
```

`repository.name` *(optional)* explicitly sets `{{repository-name}}`, overriding the value that would otherwise be [derived](/agent-configuration/rules/#platform--repository--structural-execution-context) from `url`.

---

## Rule-set-level `with-envs`

`with-envs` declared as a sibling of `executions` (rather than inside an execution block) is merged into every execution in the rule set — the common pattern for `schedule` rule sets, where credentials are typically the same across the set (see [`with-envs`](/agent-configuration/rules/#with-envs--container-environment-variables)):

```json
"with-envs": [
  { "name": "GITHUB-TOKEN",      "value": "secrets.GITHUB-TOKEN",      "mandatory": true },
  { "name": "ANTHROPIC-API-KEY", "value": "secrets.ANTHROPIC-API-KEY", "mandatory": true }
]
```

---

## Complete Example

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

### What happens on each tick

1. The `cron` expression ticks (evaluated against `timezone`, default `UTC`).
2. There's no `match-any` or `use-inputs` to evaluate — every execution in the rule set proceeds.
3. **Structural fields are resolved** — `platform` and `repository` literals are taken verbatim; `{{repository-name}}` is derived from `url` unless `repository.name` overrides it.
4. `execute-prompt` is interpolated with the auto-injected structural placeholders.
5. `with-envs` (rule-set-level merged with any execution-level entries) are resolved and injected.
6. Cost & execution controls are applied, plugins install, and the prompt runs — exactly as for a webhook execution.
