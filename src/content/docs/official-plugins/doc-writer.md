---
title: Document Updater
description: Automated documentation updates that analyze PR source changes and keep your Docs/ folder and READMEs in sync.
---

The **Doc Writer** plugin inspects every source file modified in a pull request, identifies the documentation that covers those files, and writes the updates needed to keep your `Docs/` folder and READMEs accurate. It works **before merge** (commits directly to the PR branch) or **after merge** (opens a follow-up PR with the same changes).

Works with **GitHub** and **Azure DevOps**.

---

## How It Works

```mermaid
flowchart TD
    A[Fetch PR diff & context] --> B[Identify modified source files]
    B --> C[Map source files to documentation]
    C --> D[Analyze changes for doc impact]
    D --> E[Generate documentation updates]
    E --> F{Merge state?}
    F -->|Pre-merge| G[Commit updates to PR branch]
    F -->|Post-merge| H[Open follow-up PR with updates]
```

1. **Fetch PR context** — retrieves the diff, commit log, and changed file list against the base branch using the platform CLI (`gh` or `az`).
2. **Identify modified source files** — builds a list of every source file touched by the PR, grouped by module or package.
3. **Map to documentation** — scans `Docs/`, `docs/`, `README*.md`, and inline doc comments to find every document that references or describes the modified code.
4. **Analyze for doc impact** — for each changed source file, determines what changed (new API, renamed symbol, removed feature, behavior change, new configuration option, etc.) and whether the existing documentation reflects it.
5. **Generate updates** — rewrites or extends the identified documentation sections. New public APIs get documented; removed or renamed items are corrected; behavioral changes are reflected in examples and descriptions.
6. **Commit or follow-up PR** — if the PR is still open, commits the documentation changes directly to the PR branch and posts a summary comment. If the PR has already merged, opens a dedicated follow-up PR targeting the base branch.

---

## Inputs

| Input | Source | Required | Description |
|---|---|---|---|
| Repository URL | Agent rule | Yes | The repository to update documentation for — provided by the Xianix Agent rule, not typed in the prompt |
| PR number | Prompt | No | Target a specific pull request (e.g. `42`) |
| Branch name | Prompt | No | Compare a branch against the default base |

The platform (GitHub, Azure DevOps, etc.) is **auto-detected** from `git remote` — you don't need to specify it.

---

## Sample Prompts

**Update docs for the current branch:**

```text
/update-docs
```

**Update docs for a specific PR:**

```text
/update-docs 42
```

---

## Environment Variables

| Variable | Platform | Required | Purpose |
|---|---|---|---|
| `GITHUB_TOKEN` | GitHub | Yes | Authenticate `gh` CLI for fetching PR data, committing changes, and posting comments |
| `AZURE_DEVOPS_TOKEN` | Azure DevOps | Yes | PAT for REST API calls and git push |

### GitHub Token Permissions

The `GITHUB_TOKEN` requires the following repository permissions:

| Permission | Access | Why it's needed |
|---|---|---|
| **Contents** | Read & Write | Read source and documentation files; commit documentation updates to the PR branch |
| **Metadata** | Read | Search repositories, list collaborators, and access repository metadata |
| **Pull requests** | Read & Write | Fetch PR diffs, post summary comments, and open follow-up PRs after merge |

---

## Quick Start

```bash
# Point Claude Code at the plugin
claude --plugin-dir /path/to/xianix-plugins-official/plugins/doc-writer

# Then in the chat
/update-docs
```

Or trigger it automatically via the Xianix Agent by adding a rule — see the examples below and the [Rules Configuration](/agent-configuration/rules/) guide.

---

## Rule Examples

Add one (or both) of the execution blocks below to your `rules.json` so the Xianix Agent automatically updates documentation when a webhook fires.

### When does the agent trigger?

The Doc Writer is **tag-driven**. It runs when the `ai-dlc/pr/update-docs` label (GitHub) or tag (Azure DevOps) is present on a pull request and one of the following happens (OR logic across `match-any` entries):

| Scenario | What it covers |
|---|---|
| Tag newly applied to a PR | A human (or another rule) adds `ai-dlc/pr/update-docs` to an open or merged PR |
| PR opened with the tag already present | A PR is created with the tag included from the start |
| New commits pushed to a tagged PR | The PR branch is updated while the tag is still on the PR |

The label or tag is the single source of truth for "update docs for this PR." When applied after merge, the plugin opens a follow-up PR instead of committing to the now-closed branch.

| Platform | Scenario | Webhook event | Filter rule |
|---|---|---|---|
| GitHub | Tag newly applied | `pull_request` | `action==labeled` and the just-added `label.name=='ai-dlc/pr/update-docs'` |
| GitHub | PR opened with tag | `pull_request` | `action==opened` and `ai-dlc/pr/update-docs` is in `pull_request.labels` |
| GitHub | New commits to tagged PR | `pull_request` | `action==synchronize` and `ai-dlc/pr/update-docs` is in `pull_request.labels` |
| Azure DevOps | Tag newly applied | `git.pullrequest.updated` | `message.text` contains `tagged the pull request` and `ai-dlc/pr/update-docs` is in `resource.labels` |
| Azure DevOps | PR created with tag | `git.pullrequest.created` | `ai-dlc/pr/update-docs` is in `resource.labels` |
| Azure DevOps | New commits to tagged PR | `git.pullrequest.updated` | `message.text` contains `updated the source branch` and `ai-dlc/pr/update-docs` is in `resource.labels` |

### GitHub

```json
{
  "name": "github-pull-request-doc-update",
  "match-any": [
    {
      "name": "github-pr-tag-applied",
      "rule": "action==labeled&&label.name=='ai-dlc/pr/update-docs'"
    },
    {
      "name": "github-pr-opened-with-tag",
      "rule": "action==opened&&pull_request.labels.*.name=='ai-dlc/pr/update-docs'"
    },
    {
      "name": "github-pr-synchronize-with-tag",
      "rule": "action==synchronize&&pull_request.labels.*.name=='ai-dlc/pr/update-docs'"
    }
  ],
  "use-inputs": [
    { "name": "pr-number",       "value": "number" },
    { "name": "repository-url",  "value": "repository.clone_url" },
    { "name": "repository-name", "value": "repository.full_name" },
    { "name": "pr-title",        "value": "pull_request.title" },
    { "name": "pr-head-branch",  "value": "pull_request.head.ref" },
    { "name": "platform",        "value": "github", "constant": true }
  ],
  "use-plugins": [
    {
      "plugin-name": "doc-writer@xianix-plugins-official",
      "marketplace": "xianix-team/plugins-official"
    }
  ],
  "execute-prompt": "You are updating documentation for pull request #{{pr-number}} titled \"{{pr-title}}\" in the repository {{repository-name}} (branch: {{pr-head-branch}}).\n\nRun /update-docs to analyze the modified source files and update the relevant documentation. The `gh` CLI is authenticated and available if you need it directly."
}
```

### Azure DevOps

```json
{
  "name": "azuredevops-pull-request-doc-update",
  "match-any": [
    {
      "name": "azuredevops-pr-tag-applied",
      "rule": "eventType==git.pullrequest.updated&&message.text*='tagged the pull request'&&resource.labels.*.name=='ai-dlc/pr/update-docs'"
    },
    {
      "name": "azuredevops-pr-created-with-tag",
      "rule": "eventType==git.pullrequest.created&&resource.labels.*.name=='ai-dlc/pr/update-docs'"
    },
    {
      "name": "azuredevops-pr-source-branch-updated-with-tag",
      "rule": "eventType==git.pullrequest.updated&&message.text*='updated the source branch'&&resource.labels.*.name=='ai-dlc/pr/update-docs'"
    }
  ],
  "use-inputs": [
    { "name": "pr-number",       "value": "resource.pullRequestId" },
    { "name": "repository-url",  "value": "resource.repository.remoteUrl" },
    { "name": "repository-name", "value": "resource.repository.name" },
    { "name": "pr-title",        "value": "resource.title" },
    { "name": "pr-head-branch",  "value": "resource.sourceRefName" },
    { "name": "platform",        "value": "azuredevops", "constant": true }
  ],
  "use-plugins": [
    {
      "plugin-name": "doc-writer@xianix-plugins-official",
      "marketplace": "xianix-team/plugins-official"
    }
  ],
  "execute-prompt": "You are updating documentation for pull request #{{pr-number}} titled \"{{pr-title}}\" in the repository {{repository-name}} (branch: {{pr-head-branch}}).\n\nRun /update-docs to analyze the modified source files and update the relevant documentation. The `az` CLI is authenticated and available if you need it directly."
}
```

:::note
These blocks go inside the `executions` array of a rule set. See [Rules Configuration](/agent-configuration/rules/) for the full file structure and filter syntax.
:::
