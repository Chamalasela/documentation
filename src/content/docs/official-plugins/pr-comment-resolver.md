---
title: PR Comment Resolver
description: Automated resolution of pull request review threads — applies actionable comments as commits, replies to discussion threads, and declines out-of-scope feedback.
---

The **PR Comment Resolver** plugin reads every unresolved review thread on a pull request, classifies each comment, applies the actionable ones as commits, and posts a structured disposition report.

| Action | What it means |
|---|---|
| **Apply** | Clear, actionable change request — edits the relevant files and resolves the thread |
| **Discuss** | Needs human judgement — leaves the thread open with a short explanation |
| **Decline** | Out of scope, conflicts with another decision, or factually wrong — leaves the thread open with a short justification |

Works with **GitHub**, **Azure DevOps**, **Bitbucket**, and any generic git repository.

---

## How It Works

```mermaid
flowchart TD
    A[Detect platform] --> B[List unresolved review threads]
    B --> C{Code-related?}
    C -->|No| N[Auto-decline — outside the scope of automated code resolution]
    C -->|Yes| D[Classify each comment]
    D --> E{Classification}
    E -->|Apply| F[Edit relevant files]
    E -->|Discuss| G[Reply with explanation]
    E -->|Decline| H[Reply with justification]
    F --> I[Push commits & resolve threads]
    G --> J[Leave thread open]
    H --> J
    N --> J
    I --> K[Post summary comment]
    J --> K
    K --> L{PR state?}
    L -->|Open pre-merge| M[Commits land on PR branch]
    L -->|Already merged| O[New branch + follow-up PR]
```

1. **Detect platform** — reads `git remote` to identify GitHub, Azure DevOps, Bitbucket, or generic.
2. **List threads** — fetches every unresolved review thread (top-level and inline) via the platform API.
3. **Filter** — each thread is checked for relevance; comments that do not request a code change (general discussion, process questions, praise) are auto-declined with the reply: *"This comment does not request a code change and is outside the scope of automated resolution."*
4. **Classify** — each remaining comment is assigned one of three dispositions: **apply**, **discuss**, or **decline**.
5. **Apply changes** — for every *apply* comment, the relevant files are edited in place.
6. **Push & resolve** — commits are pushed and the addressed threads are marked resolved on the platform.
7. **Reply to the rest** — *discuss* and *decline* threads each receive a short reply explaining why they were left open.
8. **Post summary** — a structured comment lists every thread and its final disposition.

When triggered **after a PR is already merged**, the plugin cuts a new branch from the merge commit, pushes the changes there, and opens a follow-up PR linked back to the original.

---

## Inputs

| Input | Source | Required | Description |
|---|---|---|---|
| Repository URL | Agent rule | Yes | The repository to resolve comments in — provided by the Xianix Agent rule, not typed in the prompt |
| PR number | Prompt | No | Target a specific pull request (e.g. `123`) |
| Branch name | Prompt | No | Override the branch to commit resolved changes to |

The platform (GitHub, Azure DevOps, etc.) is **auto-detected** from `git remote` — you don't need to specify it.

---

## Sample Prompts

**Resolve comments on the current PR:**

```text
/resolve-comments
```

**Resolve comments on a specific PR:**

```text
/resolve-comments 42
```

---

## Environment Variables

The Xianix Agent reads these from its secrets store and injects them at runtime via the rule's `with-envs` block (see the rule examples below). For local CLI use, export them in your shell.

| Variable | Platform | Required | Purpose |
|---|---|---|---|
| `GITHUB-TOKEN` | GitHub | Yes | Authenticate `gh` CLI for fetching threads, posting replies, and pushing commits |
| `AZURE-DEVOPS-TOKEN` | Azure DevOps | Yes | PAT for REST API calls, thread management, and git push |

### GitHub Token Permissions

The `GITHUB-TOKEN` requires the following repository permissions:

| Permission | Access | Why it's needed |
|---|---|---|
| **Contents** | Read & Write | Read repository files, commit changes, and push to branches |
| **Metadata** | Read | Search repositories, list collaborators, and access repository metadata |
| **Pull requests** | Read & Write | Fetch review threads and comments, post replies, resolve threads, and open follow-up PRs |

### Azure DevOps Token Permissions

The `AZURE-DEVOPS-TOKEN` (Personal Access Token) requires:

| Permission | Access | Why it's needed |
|---|---|---|
| **Code** | Read & Write | Read repository files, push the resolution commits |
| **Pull Request Threads** | Read & Write | Fetch review threads, post replies, and resolve threads |

---

## Quick Start

```bash
# Point Claude Code at the plugin
claude --plugin-dir /path/to/xianix-plugins-official/plugins/comment-resolver

# Then in the chat
/resolve-comments
```

Or trigger it automatically via the Xianix Agent by adding a rule — see the examples below and the [Rules Configuration](/agent-configuration/rules/) guide.

---

## Rule Examples

Add one (or both) of the execution blocks below to your `rules.json` so the Xianix Agent automatically resolves review comments when a webhook fires.

### When does the agent trigger?

The PR Comment Resolver is **tag-driven**. It runs when the `ai-dlc/pr/address-comments` label (GitHub) or tag (Azure DevOps) is present on a pull request and one of the following happens (OR logic across `match-any` entries):

| Scenario | What it covers |
|---|---|
| Tag newly applied to a PR | A human (or another rule) adds `ai-dlc/pr/address-comments` to an open PR |
| PR opened with the tag already present | A PR is created with the tag included from the start |

There is no push-based re-trigger by default. The label or tag is the single source of truth for "resolve comments on this PR."

| Platform | Scenario | Webhook event | Filter rule |
|---|---|---|---|
| GitHub | Tag newly applied | `pull_request` | `action==labeled` and the just-added `label.name=='ai-dlc/pr/address-comments'` |
| GitHub | PR opened with tag | `pull_request` | `action==opened` and `ai-dlc/pr/address-comments` is in `pull_request.labels` |
| Azure DevOps | Tag newly applied | `git.pullrequest.updated` | `message.text` contains `tagged the pull request` and `ai-dlc/pr/address-comments` is in `resource.labels` |
| Azure DevOps | PR created with tag | `git.pullrequest.created` | `ai-dlc/pr/address-comments` is in `resource.labels` |

### Execution-block shape

Each execution block in `rules.json` follows this top-level shape:

| Field | Purpose |
|---|---|
| `name` | Human-readable id for the execution |
| `platform` | `"github"` or `"azuredevops"` — drives which provider the plugin uses |
| `repository.url` | Webhook path to the repository URL (e.g. `repository.clone_url`, `resource.repository.remoteUrl`) |
| `repository.ref` | Webhook path to the branch ref (e.g. `pull_request.head.ref`, `resource.sourceRefName`) |
| `match-any` | Array of trigger filters — first one to match wins |
| `use-inputs` | **Minimal** — usually just the entry-point id (e.g. `pr-number`). The repository URL and ref are injected automatically from the `repository` block. |
| `use-plugins` | The plugin to invoke |
| `with-envs` | Required environment variables, sourced from the agent's `secrets.*` store and marked `mandatory: true` |
| `execute-prompt` | The prompt sent to the agent. Implicit interpolations: `{{repository-name}}` and `{{git-ref}}` from the `repository` block, plus any `name` from `use-inputs` |

### GitHub

```json
{
  "name": "github-pull-request-comment-resolver",
  "platform": "github",
  "repository": {
    "url": "repository.clone_url",
    "ref": "pull_request.head.ref"
  },
  "match-any": [
    {
      "name": "github-pr-tag-applied",
      "rule": "action==labeled&&label.name=='ai-dlc/pr/address-comments'"
    },
    {
      "name": "github-pr-opened-with-tag",
      "rule": "action==opened&&pull_request.labels.*.name=='ai-dlc/pr/address-comments'"
    }
  ],
  "use-inputs": [
    { "name": "pr-number", "value": "number" }
  ],
  "use-plugins": [
    {
      "plugin-name": "comment-resolver@xianix-plugins-official",
      "marketplace": "xianix-team/plugins-official"
    }
  ],
  "with-envs": [
    { "name": "GITHUB-TOKEN", "value": "secrets.GITHUB-TOKEN", "mandatory": true }
  ],
  "execute-prompt": "Pull request #{{pr-number}} in {{repository-name}} (branch: {{git-ref}}) has been tagged for review-comment resolution.\n\nRun /resolve-comments {{pr-number}} to classify and address the unresolved review threads."
}
```

### Azure DevOps

```json
{
  "name": "azuredevops-pull-request-comment-resolver",
  "platform": "azuredevops",
  "repository": {
    "url": "resource.repository.remoteUrl",
    "ref": "resource.sourceRefName"
  },
  "match-any": [
    {
      "name": "azuredevops-pr-tag-applied",
      "rule": "eventType==git.pullrequest.updated&&message.text*='tagged the pull request'&&resource.labels.*.name=='ai-dlc/pr/address-comments'"
    },
    {
      "name": "azuredevops-pr-created-with-tag",
      "rule": "eventType==git.pullrequest.created&&resource.labels.*.name=='ai-dlc/pr/address-comments'"
    }
  ],
  "use-inputs": [
    { "name": "pr-number", "value": "resource.pullRequestId" }
  ],
  "use-plugins": [
    {
      "plugin-name": "comment-resolver@xianix-plugins-official",
      "marketplace": "xianix-team/plugins-official"
    }
  ],
  "with-envs": [
    { "name": "AZURE-DEVOPS-TOKEN", "value": "secrets.AZURE-DEVOPS-TOKEN", "mandatory": true }
  ],
  "execute-prompt": "Pull request #{{pr-number}} in {{repository-name}} (branch: {{git-ref}}) has been tagged for review-comment resolution.\n\nRun /resolve-comments {{pr-number}} to classify and address the unresolved review threads."
}
```

:::note
These blocks go inside the `executions` array of a rule set. See [Rules Configuration](/agent-configuration/rules/) for the full file structure and filter syntax.
:::
