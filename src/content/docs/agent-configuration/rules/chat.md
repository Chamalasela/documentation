---
title: Chat Rule Sets
description: Expose marketplace plugins to the interactive chat tool with their own cost and execution tuning.
---

A **chat rule set** is the root-level sibling of [webhook](/agent-configuration/rules/webhooks/) and [schedule](/agent-configuration/rules/schedules/) rule sets. Instead of reacting to an inbound event, it lists the marketplace plugins the **chat tool** (`SupervisorSubagentTools.RunClaudeCodeOnRepository`) may offer the user, together with the cost/control tuning to apply to those chat dispatches.

It is discriminated by a non-empty **`chat`** key, so the same `rules.json` array can hold webhook, schedule, and chat rule sets side by side — the webhook evaluator keeps only `"webhook"` entries, so chat rule sets never leak into it.

```json
{
  "chat": "chat",
  "model": "claude-sonnet-4-5",
  "max-budget-usd": 5.0,
  "with-envs": [
    { "name": "GITHUB-TOKEN", "value": "secrets.GITHUB-TOKEN", "mandatory": true }
  ],
  "use-plugins": [
    {
      "plugin-name": "pr-reviewer@xianix-plugins-official",
      "marketplace": "xianix-team/plugins-official",
      "slash-command": "/pr-review"
    }
  ]
}
```

---

## No `executions` array

Unlike a webhook or schedule rule set, a chat rule set has **no `executions`**. A chat run's prompt is authored by the supervisor as `{slash-command} {user-target}` from the [`slash-command`](#use-plugins-with-slash-command) on each listed plugin — there's nothing to interpolate from a payload, so a per-execution `execute-prompt` / `use-inputs` / `match-any` shape would be redundant.

The tuning knobs and plugin list therefore live at the **rule-set root** and apply uniformly to every chat dispatch that uses one of the listed plugins. Author **separate chat rule sets** when different plugins need different tuning.

---

## `chat` — discriminator & label

```json
"chat": "chat"
```

Any non-empty value marks the object as a chat rule set. The value itself is only used for logs and diagnostics — there is no external event name to match (unlike a webhook rule set's `webhook`).

---

## `use-plugins` with `slash-command`

`use-plugins` uses the [same schema](/agent-configuration/rules/#use-plugins--plugin-installation) as webhook/schedule rule sets, but here the **`slash-command`** field is important: it's how the supervisor knows the exact command to compose for the chat dispatch. Chat plugins should always declare one so the supervisor does not have to invent a command name.

```json
"use-plugins": [
  {
    "plugin-name": "pr-reviewer@xianix-plugins-official",
    "marketplace": "xianix-team/plugins-official",
    "slash-command": "/pr-review"
  }
]
```

| Field           | Required (chat) | Description |
|-----------------|-----------------|-------------|
| `plugin-name`   | Yes | Plugin reference in `plugin-name@marketplace-name` form. |
| `marketplace`   | No  | Marketplace source. Omit for the built-in Anthropic marketplace. |
| `slash-command` | Recommended | The Claude Code slash command the supervisor invokes (e.g. `/pr-review`). A chat listing's `slash-command` overrides one omitted on a webhook listing of the same plugin. |

---

## Rule-set-level tuning

The [Cost & Execution Controls](/agent-configuration/rules/#cost--execution-controls) sit at the chat rule-set root (not inside an execution block) and apply to every chat dispatch that picks one of this set's plugins:

| Field | Description |
|-------|-------------|
| `model` | Model override for chat dispatches. Empty means the executor's default. |
| `max-turns` | Turn cap for chat dispatches. |
| `allowed-tools` | Allow-list of tools for chat dispatches. |
| `disallowed-tools` | Deny-list of tools for chat dispatches. |
| `max-budget-usd` | Per-run USD budget cap for chat dispatches. |
| `resume-sessions` | Whether chat dispatches resume prior sessions. |

## Rule-set-level `with-envs`

`with-envs` at the chat rule-set root is applied to every chat dispatch, mirroring the [webhook / schedule rule-set commons](/agent-configuration/rules/#with-envs--container-environment-variables). It's platform-agnostic — the same three value forms (`secrets.*`, `host.*`, constant) apply.

```json
"with-envs": [
  { "name": "GITHUB-TOKEN", "value": "secrets.GITHUB-TOKEN", "mandatory": true }
]
```

---

## How chat plugins are surfaced

Chat rule sets feed two supervisor tools via a deduplicated plugin catalog:

- **`ListAvailablePlugins`** — lets the chat model discover which plugins exist, the slash command each exposes, and which environment variables the tenant must have configured.
- **`RunClaudeCodeOnRepository`** — resolves a chosen plugin name back to its full spec (and the `with-envs` declared alongside it), validates that mandatory inputs are supplied, then dispatches the run. This is the chat-side equivalent of the input validation the webhook evaluator performs.

A few consequences worth knowing:

- **Chat-exclusive, else webhook fallback.** If a plugin is listed by *any* chat rule set, the catalog serves it **exclusively** through the chat rule set's tuning. A plugin only ever referenced by webhook rule sets falls back to those webhook usage examples (unchanged behaviour).
- **Structural inputs are auto-filled.** `repository-url` and `repository-name` are resolved by the chat tool from the repository the user chose — the model never supplies them. `repository-name` is derived from the clone URL via the same platform-aware logic the webhook path uses.
- **No prompt to interpolate.** The chat usage example carries only the tuning knobs (no `execute-prompt`, no inputs) — the supervisor authors the prompt from the user's message.

---

## Complete Example

A chat rule set exposing the PR reviewer to chat with its own tuning, alongside a webhook rule set in the same `rules.json` array:

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
          { "name": "pr-opened", "rule": "action==opened" }
        ],
        "use-plugins": [
          {
            "plugin-name": "pr-reviewer@xianix-plugins-official",
            "marketplace": "xianix-team/plugins-official"
          }
        ],
        "execute-prompt": "You are reviewing pull request #{{pr-number}} in {{repository-name}}.\n\nRun /pr-review {{pr-number}} to perform the automated review."
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
        "marketplace": "xianix-team/plugins-official",
        "slash-command": "/pr-review"
      }
    ]
  }
]
```

Here the `pr-reviewer` plugin is available both automatically (via the webhook rule set on `action==opened`) and interactively (via the chat rule set). Because it's listed under a chat rule set, chat dispatches use the chat rule set's Sonnet model and \$5.00 budget cap rather than falling back to the webhook execution's tuning.
