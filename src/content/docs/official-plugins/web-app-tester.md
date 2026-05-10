---
title: Web App Tester
description: Automated web app behavior verification for GitHub pull requests and issues using Playwright (headless Chromium), with a structured execution report posted as a comment.
---

The **Web App Tester** plugin validates web app behavior for a GitHub pull request or issue by running browser-based checks with **Playwright** in headless Chromium.

| Phase | What it does |
| --- | --- |
| **Gather context** | Fetches PR/issue content, finds the test URL, and retrieves or generates a test plan |
| **Run Playwright** | Opens a headless session, executes steps adaptively with retries, and captures screenshots |
| **Post report** | Computes the verdict and posts a structured execution report as a GitHub comment |

Works with **GitHub**.

---

## How It Works

```mermaid
flowchart TD
    A["/test-web-app pr N or issue N"] --> B[Fetch PR or issue body comments and links]
    B --> C{Preview URL found?}
    C -- No --> D[Post no URL found comment and stop]
    C -- Yes --> E{Test plan found?}
    E -- Yes --> F[Use existing plan]
    E -- No --> G[Generate and post test plan]
    F --> H{Chromium cached?}
    G --> H
    H -- Yes --> I[Skip browser install]
    H -- No --> J[Install Chromium]
    I --> K[Resolve playwright-cli and write _wat_pcli wrapper]
    J --> K
    K --> L[Open browser session and execute steps adaptively]
    L --> M[Track step results inline]
    M --> N[Close browser and clean temporary files]
    N --> O[Post structured execution report]
```

1. **Gather context** — reads PR or issue title/body, comments, and linked references through `gh` CLI.
2. **Find test URL** — searches for a testable URL (for example `Preview URL:` or `Staging URL:`). If none is found, it posts a comment and stops.
3. **Find or generate test plan** — uses an existing structured plan from comments, or generates one from context and posts it first.
4. **Prepare Playwright** — reuses cached Chromium if available; installs once when needed.
5. **Execute steps** — executes steps one at a time using playwright-cli in a persistent headless browser session — reads a live DOM snapshot after each command to verify the outcome and adapt the next step, with retry logic for transient failures.
6. **Publish report** — posts one structured test execution report back to the PR or issue.

---

## Inputs

| Input | Source | Required | Description |
| --- | --- | --- | --- |
| Target ID | Command argument | Yes | PR number (`pr 42`) or issue number (`issue 88`) |
| Test URL | PR/issue content | Yes | URL marked as preview/staging/test environment |
| Test plan | PR/issue content | No | Numbered or bulleted verification steps; generated if missing |

The platform is currently **GitHub**.

---

## Sample Prompts

**Test a specific PR:**

```text
/test-web-app pr 42
```

**Test a specific issue:**

```text
/test-web-app issue 88
```

**Infer PR from current branch context:**

```text
/test-web-app
```

---

## Environment Variables

The Xianix Agent reads these from its secrets store and injects them at runtime via the rule's `with-envs` block (see the rule examples below). For local CLI use, export them in your shell.

| Variable | Platform | Required | Purpose |
| --- | --- | --- | --- |
| `GITHUB-TOKEN` | GitHub | Yes | Authenticate `gh` CLI for fetching PR/issue data and posting comments |

### GitHub Token Permissions

The `GITHUB-TOKEN` requires the following repository permissions:

| Permission | Access | Why it's needed |
| --- | --- | --- |
| **Contents** | Read | Access repository contents |
| **Metadata** | Read | Search repositories and access repository metadata |
| **Pull requests** | Read & Write | Fetch pull request context and post test execution reports |
| **Issues** | Read & Write | Fetch issue context and post test execution reports |

---

## Execution Statuses

| Status | Meaning |
| --- | --- |
| PASSED | Step executed and expected outcome observed |
| FAILED | Step executed but expected outcome not observed |
| BLOCKED | Step could not execute after retries, was skipped due to read-only safety mode, or was halted by an auth gate with no credentials available |

Overall result is:

- **PASSED** when all steps pass
- **FAILED** when one or more steps fail
- **BLOCKED** when any step cannot be safely or reliably executed

---

## Safety Rules

- If no test URL is found, the plugin posts a comment and exits.
- If the URL appears to be production, the run switches to **read-only mode** and skips state-changing actions.
- Credentials and tokens are never posted in comments.
- Temporary files are deleted after the run.

---

## Report Output

The plugin posts one comment with:

- URL tested
- total step count
- per-step status table
- overall result
- failure or blocked step details (with captured screenshot reference when available)

This keeps the output concise and immediately reviewable inside the PR or issue timeline.

---

## Quick Start

```bash
# Point Claude Code at the plugin
claude --plugin-dir /path/to/xianix-plugins-official/plugins/web-app-tester

# Then in chat
/test-web-app pr 42
```

Or trigger it automatically via the Xianix Agent by adding a rule — see the examples below and the [Rules Configuration](/agent-configuration/rules/) guide.

For setup details (Node.js, playwright-cli, and `gh` CLI), see the plugin setup guide in the repository:

<https://github.com/xianix-team/plugins-official/tree/main/plugins/web-app-tester/docs/setup.md>

---

## Rule Examples

Add the execution block below to your `rules.json` so the Xianix Agent automatically tests web apps when a webhook fires.

### When does the agent trigger?

The Web App Tester is mainly **tag-driven**. It runs when the `ai-dlc/pr/test-web-app` label is present on a pull request and one of the scenarios below fires (OR logic across `match-any` entries).

| Scenario | What it covers |
| --- | --- |
| PR opened / created with the tag already present | A PR is opened with the tag included from the start |
| New commits pushed to a tagged PR | The PR source branch is updated while the tag is still on the PR |
| Tag newly applied to a PR | A human (or another rule) adds `ai-dlc/pr/test-web-app` to an open PR |

| Platform | Scenario | Webhook event | Filter rule |
| --- | --- | --- | --- |
| GitHub | Tag newly applied | `pull_request` | `action==labeled` and `label.name=='ai-dlc/pr/test-web-app'` |
| GitHub | PR opened with tag | `pull_request` | `action==opened` and `ai-dlc/pr/test-web-app` is in `pull_request.labels` |
| GitHub | New commits to tagged PR | `pull_request` | `action==synchronize` and `ai-dlc/pr/test-web-app` is in `pull_request.labels` |

### Execution-block shape

Each execution block in `rules.json` follows this top-level shape:

| Field | Purpose |
| --- | --- |
| `name` | Human-readable id for the execution |
| `platform` | `"github"` — drives which provider the plugin uses |
| `repository.url` | Webhook path to the repository URL (e.g. `repository.clone_url`) |
| `repository.ref` | Webhook path to the branch ref (e.g. `pull_request.head.ref`) |
| `match-any` | Array of trigger filters — first one to match wins |
| `use-inputs` | **Minimal** — usually just the entry-point id (e.g. `pr-number`). The repository URL and ref are injected automatically from the `repository` block. |
| `use-plugins` | The plugin to invoke |
| `with-envs` | Required environment variables, sourced from the agent's `secrets.*` store and marked `mandatory: true` |
| `execute-prompt` | The prompt sent to the agent. Implicit interpolations: `{{repository-name}}` and `{{git-ref}}` from the `repository` block, plus any `name` from `use-inputs` |

### GitHub

```json
{
  "name": "github-web-app-test",
  "platform": "github",
  "repository": {
    "url": "repository.clone_url",
    "ref": "pull_request.head.ref"
  },
  "match-any": [
    {
      "name": "github-pr-tag-applied",
      "rule": "action==labeled&&label.name=='ai-dlc/pr/test-web-app'"
    }
  ],
  "use-inputs": [
    { "name": "pr-number", "value": "pull_request.number" }
  ],
  "use-plugins": [
    {
      "plugin-name": "web-app-tester@xianix-plugins-official",
      "marketplace": "xianix-team/plugins-official"
    }
  ],
  "with-envs": [
    { "name": "GITHUB-TOKEN", "value": "secrets.GITHUB-TOKEN", "mandatory": true }
  ],
  "execute-prompt": "You are testing pull request {{pr-number}}. Run /test-web-app pr {{pr-number}} to perform the automated web app test."
}
```

:::note
These blocks go inside the `executions` array of a rule set. See [Rules Configuration](/agent-configuration/rules/) for the full file structure and filter syntax.
:::

---

## What Is Included

| Path | Purpose |
| --- | --- |
| `commands/test-web-app.md` | Entry command and argument pattern |
| `agents/orchestrator.md` | End-to-end orchestration flow |
| `providers/github.md` | GitHub fetch/post operations |
| `styles/report-template.md` | Strict output report format |
| `hooks/validate-prerequisites.sh` | Node.js, playwright-cli, and `gh` availability checks |
| `docs/setup.md` | Installation and auth setup |
