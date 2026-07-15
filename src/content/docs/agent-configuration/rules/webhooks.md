---
title: Webhook Rule Sets
description: React to inbound GitHub / Azure DevOps events — webhook matching, verification, payload filtering, and input extraction.
---

A **webhook rule set** is triggered when an inbound event's name matches its `webhook` field. Each rule set contains an `executions` array; every execution independently filters the payload (`match-any`), extracts values from it (`use-inputs`), installs plugins, and runs a prompt.

If **multiple** execution blocks in the same rule set match one webhook payload, **each** match is scheduled as its own run (separate activation / executor session) with that block's inputs, plugins, and prompt.

This page covers the fields that are specific to the webhook trigger. For the building blocks shared with schedule and chat rule sets — [`platform` & `repository`](/agent-configuration/rules/#platform--repository--structural-execution-context), [`use-plugins`](/agent-configuration/rules/#use-plugins--plugin-installation), [`with-envs`](/agent-configuration/rules/#with-envs--container-environment-variables), [`execute-prompt`](/agent-configuration/rules/#execute-prompt--claude-code-prompt-template), and [Cost & Execution Controls](/agent-configuration/rules/#cost--execution-controls) — see the [parent Rules Configuration page](/agent-configuration/rules/).

```jsonc
[
  {
    "webhook": "Default",
    "github-webhook-verification-secret": "...",
    "with-envs": [ ... ],
    "executions": [
      {
        "name": "...",
        "platform": "...",
        "repository": "...",
        "match-any":  [ ... ],
        "use-inputs": [ ... ],
        "use-plugins": [ ... ],
        "execute-prompt": "..."
      }
    ]
  }
]
```

---

## 1. `webhook`

Case-insensitive match against the webhook name configured in Xians Agent Studio.

```json
"webhook": "Default"
```

Only one rule set per webhook name is used — the **first** matching entry in the `rules.json` array wins.

For a rule set triggered on a recurring timer instead of a webhook, replace `webhook` with `schedule` + `cron` — see [Schedule Rule Sets](/agent-configuration/rules/schedules/).

---

## 1a. Webhook verification (optional)

By default the agent orchestrates any inbound event whose name matches a rule set. To reject spoofed deliveries, opt in to **per-provider verification** by declaring the relevant secret **key names** at the rule-set level. These are vault key names (not `secrets.*` prefixes) — the value is fetched from the tenant Secret Vault at ingress time and the delivery is verified **before** any execution is orchestrated.

```json
{
  "webhook": "Default",
  "github-webhook-verification-secret": "GITHUB-WEBHOOK-SECRET",
  "azuredevops-webhook-verification-secret": "ADO-WEBHOOK-SECRET",
  "azuredevops-webhook-verification-header": "X-Hook-Secret",
  "executions": [ ... ]
}
```

| Field | Description |
|-------|-------------|
| `github-webhook-verification-secret` | Vault **key** whose value is the GitHub webhook secret. When set, the ingress path validates the `X-Hub-Signature-256` HMAC-SHA256 over the raw payload before orchestrating. |
| `azuredevops-webhook-verification-secret` | Vault **key** whose value must match the shared secret Azure DevOps sends in a custom HTTP header on service-hook deliveries. |
| `azuredevops-webhook-verification-header` | HTTP header name Azure DevOps includes via the service hook's `httpHeaders`. Defaults to `X-Hook-Secret` when omitted. |

**How it works:**

- **Provider detection** (first match wins): an `X-Hub-Signature-256` header → GitHub; a JSON payload with a non-empty top-level `eventType` string → Azure DevOps; an `X-GitHub-Event` header → GitHub. If none apply the provider is *unknown* and verification is **skipped**.
- **Opt-in per provider.** If GitHub is detected but only the Azure DevOps secret is configured, GitHub verification is skipped (and vice versa) — orchestration continues.
- **GitHub:** HMAC-SHA256 over the raw request body compared (in constant time) against `X-Hub-Signature-256: sha256=<hex>`.
- **Azure DevOps:** the value in the configured header is compared (in constant time) against the vault secret — ADO does not sign the payload, so the operator picks both the header name and the secret value.
- **Hard failure** (delivery rejected) when a provider is detected and its secret **is** configured but the check fails, or the configured vault key has no value for the tenant. A configured key with no vault value is treated as a failure — the operator explicitly opted in but the secret isn't available.

> Verification is entirely optional. Omit all three fields to keep the default behaviour (orchestrate on name match alone).

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

> **Don't put structural context here.** `platform`, `repository-url`, and `repository-name` are declared at the [execution level](/agent-configuration/rules/#platform--repository--structural-execution-context) and auto-injected into `XIANIX_INPUTS` for you. Authoring them under `use-inputs` is unsupported — the framework uses the structural fields for credential setup, volume management, and chat-side input validation.

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

> Need the clone URL, repo name, or platform in your prompt? Reference `{{repository-url}}`, `{{repository-name}}`, or `{{platform}}` directly — they're auto-injected from the [structural fields](/agent-configuration/rules/#platform--repository--structural-execution-context).

If a path does not resolve (missing property), the input is set to `null`. If the input is marked `"mandatory": true`, the entire execution block is skipped instead.

---

## Evaluation Flow

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

### What Happens at Runtime

1. A webhook fires with a name that matches `webhook` (e.g. `"Default"`). If verification is configured for the detected provider, the delivery is verified before anything else.
2. For each execution block, if `match-any` is non-empty, at least one `rule` must pass.
3. **Structural fields are resolved first** — `platform` and `repository` / `repository.url`. A bare-string `repository` is treated as a JSON path for the clone URL. JSON-path bindings are looked up against the payload; constant bindings (`{ "value": "...", "constant": true }`) are taken verbatim. If a declared *path* doesn't resolve, the block is skipped — constants never fail to resolve.
4. `use-inputs` are resolved from the payload, and the resolved structural values are auto-injected back into the inputs dict under the canonical keys `platform` / `repository-url`. The short `repository-name` (e.g. `owner/repo`) is **derived** from `repository-url` (platform-aware: handles GitHub, Azure DevOps `_git` URLs, etc.) and injected alongside them so prompts and plugins see a single combined view.
5. `execute-prompt` is interpolated with those inputs (including the auto-injected structural values).
6. The agent resolves `with-envs` (literals, `host.*`, `secrets.*`) and injects them into the executor container alongside the runtime values it manages itself (`ANTHROPIC_API_KEY`, etc.).
7. **Cost & execution controls are applied** — `model`, `max-turns`, `allowed-tools`, `disallowed-tools`, `max-budget-usd`, and `resume-sessions` are forwarded to the executor as typed env vars (`XIANIX-MODEL`, `XIANIX-MAX-TURNS`, etc.). Any field that is not set is simply not seeded, so the executor falls back to its own defaults — there is no behavioral change for existing rules that don't declare these fields.
8. The executor installs `use-plugins`, injects a cached `CLAUDE.md` and symbol map into the worktree so the agent doesn't re-explore the codebase from scratch (skipped when the repo ships its own `CLAUDE.md`; optionally enriched with an LLM-authored architecture narrative when `EXECUTOR-CONTEXT-LLM` / `XIANIX-CONTEXT-LLM` is enabled), optionally resumes a prior session (when `resume-sessions: true`), and runs the final prompt with the configured model, turn cap, tool restrictions, and spend cap applied.

---

## Complete Example

A webhook rule set with two executions — a Sonnet-powered PR review with a spend cap and session reuse, plus a Haiku-powered issue analysis with a turn cap:

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
