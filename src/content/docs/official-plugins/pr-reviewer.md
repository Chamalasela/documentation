---
title: PR Reviewer
description: Automated, cost-tiered pull request reviews covering code quality, security, test coverage, and performance.
---

The **PR Reviewer** plugin runs a **cost-tiered** automated review and posts a unified, structured report directly on your pull request. Most PRs get a cheap two-pass scan; PRs that touch a high-risk surface (auth, payments, crypto, DB migrations, public APIs) automatically escalate to four specialized reviewers.

| Reviewer | What it looks for | Runs on |
|---|---|---|
| **Code Quality** | Architecture, patterns, readability, maintainability | Escalated path (always) |
| **Security** | Vulnerabilities, exposed secrets, insecure patterns (OWASP) | Escalated path (when in scope) |
| **Test Coverage** | Missing tests, quality gaps, untested code paths | Escalated path (when in scope) |
| **Performance** | Bottlenecks, algorithmic issues, resource waste | Escalated path (when in scope) |

On the default (non-escalated) path, two generic finder passes cover correctness/regressions and security/edge-cases instead — see [Review Tiers](#review-tiers) below.

Works with **GitHub**, **Azure DevOps**, and any generic git repository.
---

## How It Works

```mermaid
flowchart TD
    A[Detect platform] --> B[Fetch PR diff & context]
    B --> C[Detect prior review: initial or re-review]
    C --> D{High-risk surface?}
    D -->|No| E1[2 parallel Haiku finders]
    D -->|Yes| E2[Gated specialist reviewers]
    E1 --> F[Compile & reconcile findings]
    E2 --> F
    F --> G{Platform?}
    G -->|GitHub / Azure DevOps| H[Post PR comment + inline findings]
    G -->|Other| I[Write pr-review-report.md]
```

1. **Detect platform** — reads `git remote` to identify GitHub, Azure DevOps, or generic.
2. **Fetch PR context & detect prior review** — gathers the diff, commit log, and changed file list against the base branch, and checks (via its own comment markers) whether this plugin already reviewed the PR.
3. **Choose a tier** — the diff is checked against a high-risk-surface heuristic to decide between the cheap default path and the escalated specialist path (see [Review Tiers](#review-tiers)).
4. **Run the review** — the selected reviewers run in parallel, then findings are verified, deduplicated, and reconciled against any prior review.
5. **Compile & post** — findings are merged into a single report with a computed verdict and posted as a PR comment with inline per-finding comments (or saved to `pr-review-report.md` for unsupported platforms).

With the `--fix` flag the plugin will also apply fixes (CRITICAL/WARNING only), commit, and push.

---

## Review Tiers

| Tier | When | What runs | Cost |
|---|---|---|---|
| **Default** | Ordinary PRs (the common case) | Two parallel Haiku finder passes — correctness/regressions and security/edge-cases — self-verified and capped at 8 findings | Low |
| **Escalated** | Diff touches a high-risk surface: auth/authz, payments/billing, crypto, DB migrations/schema, or public APIs | `code-reviewer` and `test-reviewer` (cheap quality tier) plus `security-reviewer` and `performance-reviewer` (frontier risk tier), gated individually by whether the diff is relevant to each | Higher, but only where it pays off |

The tier is chosen by **risk surface**, not diff size. Model selection on the escalated path can be tuned or pinned — see [Environment Variables](#environment-variables).

---

## Re-review Support

If the plugin has already reviewed a PR, a follow-up run (e.g. after new commits are pushed) automatically switches to **re-review mode**:

- Prior findings are reconciled — ones the author fixed are marked resolved, unresolved ones stay open without duplicate comments.
- The review focuses on the commits pushed since the last review.
- A re-review delta (fixed / carried-over / new counts) is posted instead of a full new wall of comments.

Set `PR_REVIEWER_RECONCILE=false` to force a stateless full review that ignores prior findings. This is GitHub/Azure DevOps only — the generic provider just regenerates the report file each run.

---

## Inputs

| Input | Source | Required | Description |
|---|---|---|---|
| Repository URL | Agent rule | Yes | The repository to review — provided by the Xianix Agent rule, not typed in the prompt |
| PR number | Prompt | No | Target a specific pull request (e.g. `123`) |
| Branch name | Prompt | No | Compare a branch against the default base |
| `--fix` flag | Prompt | No | Auto-fix CRITICAL/WARNING issues, commit, and push |
| `--push-update` flag | Prompt | No | Force re-review mode scoped to only the commits pushed since the last review (used by the agent's push-update rule blocks) |

The platform (GitHub, Azure DevOps, etc.) is **auto-detected** from `git remote` — you don't need to specify it.

---

## Sample Prompts

**Review the current branch:**

```text
/pr-review
```

**Review a specific PR:**

```text
/pr-review 42
```

**Review and auto-fix:**

```text
/pr-review 42 --fix
```

---

## Focused Single-Dimension Reviews

Besides the comprehensive `/pr-review`, the plugin ships standalone commands for a single dimension against the current branch (not posted to the PR — printed inline). These do **not** auto-trigger from the model's own judgment (`disable-model-invocation: true`) — they must be invoked explicitly.

| Command | Reviewer used |
|---|---|
| `/review-code [branch-name]` | `code-reviewer` — quality, readability, naming, duplication |
| `/review-security [branch-name]` | `security-reviewer` — OWASP, secrets, injection, auth |
| `/review-tests [branch-name]` | `test-reviewer` — coverage gaps, test quality |
| `/review-performance [branch-name]` | `performance-reviewer` — bottlenecks, N+1s, resource waste |
| `/review-pr [pr-number \| branch-name]` | Alias for the full `/pr-review` procedure |
| `/post-review [pr-number]` | Posts findings already compiled earlier in the conversation, using the same posting scripts as step 7 of `/pr-review` — for resuming a run whose posting step didn't complete |

---

## Environment Variables

The Xianix Agent reads these from its secrets store and injects them at runtime via the rule's `with-envs` block (see the rule examples below). For local CLI use, export them in your shell.

| Variable | Platform | Required | Purpose |
|---|---|---|---|
| `GITHUB-TOKEN` | GitHub | Yes | Authenticate `gh` CLI for fetching PR data and posting comments |
| `AZURE-DEVOPS-TOKEN` | Azure DevOps | Yes | PAT for REST API calls and git push |

### Optional Tuning Variables

Not required to run the plugin — export these to change its default behavior. All are read from the shell environment, not the agent rule's `with-envs` block.

| Variable | Default | Purpose |
|---|---|---|
| `PR_REVIEWER_BLOCK_ON_CRITICAL` | `false` (advisory) | When `true`, a `REQUEST CHANGES` verdict posts as a **blocking** review (GitHub `--request-changes`, Azure DevOps vote `-10`) instead of the default non-blocking one (GitHub `--comment`, Azure DevOps vote `-5`) |
| `PR_REVIEWER_RECONCILE` | `true` | Set to `false` to force a stateless full review that ignores prior findings, disabling [re-review mode](#re-review-support) |
| `PR_REVIEWER_MODEL` | unset | Pins **every** reviewer sub-agent to one model (short slug: `sonnet`/`opus`/`haiku`/`fable`), ignoring the tiers below |
| `PR_REVIEWER_QUALITY_MODEL` | `haiku` | Model for the escalated path's quality-tier reviewers (`code-reviewer`, `test-reviewer`) |
| `PR_REVIEWER_RISK_MODEL` | lead's inherited model | Model for the escalated path's risk-tier reviewers (`security-reviewer`, `performance-reviewer`) |

The default (non-escalated) review path always uses `haiku` for its two finder passes, regardless of these variables.

### GitHub Token Permissions

The `GITHUB-TOKEN` requires the following repository permissions:

| Permission | Access | Why it's needed |
|---|---|---|
| **Contents** | Read | Access repository contents, commits, branches, downloads, releases, and merges |
| **Metadata** | Read | Search repositories, list collaborators, and access repository metadata |
| **Pull requests** | Read & Write | Fetch pull request diffs and context, post review comments, and access related assignees, labels, milestones, and merges |

### Azure DevOps Token Permissions

The `AZURE-DEVOPS-TOKEN` (Personal Access Token) requires:

| Permission | Access | Why it's needed |
|---|---|---|
| **Code** | Read & Write | Fetch PR diffs and metadata, push fix commits when `--fix` is used |
| **Pull Request Threads** | Read & Write | Post and edit the review comment / threads on the PR |

---

## Quick Start

```bash
# Point Claude Code at the plugin
claude --plugin-dir /path/to/xianix-plugins-official/plugins/pr-reviewer

# Then in the chat
/pr-review
```

Or trigger it automatically via the Xianix Agent by adding a rule — see the examples below and the [Rules Configuration](/agent-configuration/rules/) guide.

---

## Rule Examples

Add one (or both) of the execution blocks below to your `rules.json` so the Xianix Agent automatically reviews pull requests when a webhook fires.

### When does the agent trigger?

The PR Reviewer uses **label-based** triggering on GitHub and **comment-based + reviewer-assignment** triggering on Azure DevOps.

:::note[Why comment-based on Azure DevOps?]
Azure DevOps webhook payloads do **not** include label data (`resource.labels` is absent), so label-driven rules cannot filter on PR tags. Instead, the agent triggers when a new top-level PR comment contains the trigger phrase `ai-dlc/pr/pr-review`, or when the agent is added as a reviewer.
:::

| Scenario | What it covers |
|---|---|
| PR opened / created with the tag already present (GitHub) | A PR is opened with `ai-dlc/pr/pr-review` already on it |
| Tag newly applied to a PR (GitHub) | A human (or another rule) adds the label to an open PR |
| New commits pushed to a tagged PR (GitHub) | Focused incremental review of only the new commits |
| Comment with trigger phrase (Azure DevOps) | A new top-level comment containing `ai-dlc/pr/pr-review` triggers a full review |
| New commits pushed — focused review (Azure DevOps) | After the initial review, a push triggers a scoped re-review of just the new commits |
| Agent added as a reviewer (Azure DevOps) | `xianix-agent@99x.io` is added to the PR's reviewer list |

| Platform | Scenario | Webhook event | Filter rule |
|---|---|---|---|
| GitHub | Tag newly applied | `pull_request` | `action==labeled` and `label.name=='ai-dlc/pr/pr-review'` |
| GitHub | PR opened with tag | `pull_request` | `action==opened` and `ai-dlc/pr/pr-review` is in `pull_request.labels` |
| GitHub | New commits to tagged PR | `pull_request` | `action==synchronize` and `ai-dlc/pr/pr-review` is in `pull_request.labels` |
| Azure DevOps | Comment with trigger phrase | `ms.vss-code.git-pullrequest-comment-event` | New top-level comment (`parentCommentId==0`) whose body contains `ai-dlc/pr/pr-review` |
| Azure DevOps | New commits (push update) | `git.pullrequest.updated` | `message.text` contains `updated the source branch` and `xianix-agent@99x.io` is in `resource.reviewers` |
| Azure DevOps | Agent added as reviewer | `git.pullrequest.updated` | `message.text` contains `changed the reviewer list` and `xianix-agent@99x.io` is in `resource.reviewers` |

### Execution-block shape

Each execution block in `rules.json` follows this top-level shape:

| Field | Purpose |
|---|---|
| `name` | Human-readable id for the execution |
| `platform` | `"github"` or `"azuredevops"` — drives which provider the plugin uses |
| `repository.url` | Webhook path to the repository URL (e.g. `repository.clone_url`, `resource.repository.remoteUrl`) |
| `repository.ref` | Webhook path to the branch ref (e.g. `pull_request.head.ref`, `resource.sourceRefName`) |
| `match-any` | Array of trigger filters — first one to match wins |
| `use-inputs` | **Minimal** — usually just the entry-point id (e.g. `pr-link`, `pr-number`). The repository URL and ref are injected automatically from the `repository` block. |
| `use-plugins` | The plugin to invoke |
| `with-envs` | Required environment variables, sourced from the agent's `secrets.*` store and marked `mandatory: true` |
| `execute-prompt` | The prompt sent to the agent. Implicit interpolations: `{{repository-name}}` and `{{git-ref}}` from the `repository` block, plus any `name` from `use-inputs` |

### GitHub

Two execution blocks: one for the initial review (label events), one for push updates (focused incremental review on new commits only).

```json
{
  "name": "github-pr-review-initial",
  "platform": "github",
  "repository": {
    "url": "repository.clone_url",
    "ref": "pull_request.head.ref"
  },
  "match-any": [
    {
      "name": "github-pr-tag-applied",
      "rule": "action==labeled&&label.name=='ai-dlc/pr/pr-review'"
    },
    {
      "name": "github-pr-opened-with-tag",
      "rule": "action==opened&&pull_request.labels.*.name=='ai-dlc/pr/pr-review'"
    }
  ],
  "use-inputs": [
    { "name": "pr-link", "value": "pull_request.url" }
  ],
  "use-plugins": [
    {
      "plugin-name": "pr-reviewer@xianix-plugins-official",
      "marketplace": "xianix-team/plugins-official"
    }
  ],
  "max-budget-usd": 3.0,
  "execute-prompt": "You are reviewing pull request {{pr-link}}. Run /pr-review to perform the automated review."
},
{
  "name": "github-pr-review-update",
  "platform": "github",
  "repository": {
    "url": "repository.clone_url",
    "ref": "pull_request.head.ref"
  },
  "match-any": [
    {
      "name": "github-pr-synchronize-with-tag",
      "rule": "action==synchronize&&pull_request.labels.*.name=='ai-dlc/pr/pr-review'"
    }
  ],
  "use-inputs": [
    { "name": "pr-link", "value": "pull_request.url" }
  ],
  "use-plugins": [
    {
      "plugin-name": "pr-reviewer@xianix-plugins-official",
      "marketplace": "xianix-team/plugins-official"
    }
  ],
  "max-budget-usd": 1.5,
  "execute-prompt": "New commits were pushed to pull request {{pr-link}}. Run /pr-review --push-update to perform a focused review of the new commits since the last review."
}
```

### Azure DevOps

Three execution blocks: initial review (agent added as reviewer), comment-triggered review, and focused push update. Azure DevOps webhook payloads do not include label data, so tag-based filtering is replaced by comment-based triggering.

```json
{
  "name": "azuredevops-pr-review-initial",
  "platform": "azuredevops",
  "repository": {
    "url": "resource.repository.remoteUrl",
    "ref": "resource.sourceRefName"
  },
  "match-any": [
    {
      "name": "azuredevops-pr-agent-added-as-reviewer",
      "rule": "eventType==git.pullrequest.updated&&message.text*='changed the reviewer list'&&resource.reviewers.*.uniqueName=='xianix-agent@99x.io'"
    }
  ],
  "use-inputs": [
    { "name": "pr-number", "value": "resource.pullRequestId" }
  ],
  "use-plugins": [
    {
      "plugin-name": "pr-reviewer@xianix-plugins-official",
      "marketplace": "xianix-team/plugins-official"
    }
  ],
  "with-envs": [
    { "name": "AZURE-DEVOPS-TOKEN", "value": "secrets.AZURE-DEVOPS-TOKEN", "mandatory": true }
  ],
  "max-budget-usd": 5.0,
  "execute-prompt": "You are reviewing pull request #{{pr-number}} in the repository {{repository-name}} (branch: {{git-ref}}).\n\nRun /pr-review to perform the automated review."
},
{
  "name": "azuredevops-pr-review-comment-trigger",
  "platform": "azuredevops",
  "repository": {
    "url": "resource.repository.remoteUrl"
  },
  "match-any": [
    {
      "name": "azuredevops-pr-comment-with-trigger-phrase",
      "rule": "eventType==ms.vss-code.git-pullrequest-comment-event&&resource.comment.parentCommentId==0&&resource.comment.content*='ai-dlc/pr/pr-review'&&message.text*='commented on a pull request'"
    }
  ],
  "use-inputs": [
    { "name": "pr-number", "value": "resource.pullRequestId" }
  ],
  "use-plugins": [
    {
      "plugin-name": "pr-reviewer@xianix-plugins-official",
      "marketplace": "xianix-team/plugins-official"
    }
  ],
  "with-envs": [
    { "name": "AZURE-DEVOPS-TOKEN", "value": "secrets.AZURE-DEVOPS-TOKEN", "mandatory": true }
  ],
  "max-budget-usd": 5.0,
  "execute-prompt": "You are reviewing pull request #{{pr-number}} in the repository {{repository-name}}.\n\nRun /pr-review to perform the automated review."
},
{
  "name": "azuredevops-pr-review-update",
  "platform": "azuredevops",
  "repository": {
    "url": "resource.repository.remoteUrl",
    "ref": "resource.sourceRefName"
  },
  "match-any": [
    {
      "name": "azuredevops-pr-source-branch-updated-agent-reviewer",
      "rule": "eventType==git.pullrequest.updated&&message.text*='updated the source branch'&&resource.reviewers.*.uniqueName=='xianix-agent@99x.io'"
    }
  ],
  "use-inputs": [
    { "name": "pr-number", "value": "resource.pullRequestId" }
  ],
  "use-plugins": [
    {
      "plugin-name": "pr-reviewer@xianix-plugins-official",
      "marketplace": "xianix-team/plugins-official"
    }
  ],
  "with-envs": [
    { "name": "AZURE-DEVOPS-TOKEN", "value": "secrets.AZURE-DEVOPS-TOKEN", "mandatory": true }
  ],
  "max-budget-usd": 2.0,
  "execute-prompt": "New commits were pushed to pull request #{{pr-number}} in the repository {{repository-name}} (branch: {{git-ref}}).\n\nRun /pr-review --push-update to perform a focused review of the new commits since the last review."
}
```

:::note[Push update budget]
The `azuredevops-pr-review-update` and `github-pr-review-update` blocks use a lower `max-budget-usd` because `--push-update` mode scopes the review to only the incremental diff since the last review — it does not re-scan the full PR.
:::

:::note
These blocks go inside the `executions` array of a rule set. See [Rules Configuration](/agent-configuration/rules/) for the full file structure and filter syntax.
:::
