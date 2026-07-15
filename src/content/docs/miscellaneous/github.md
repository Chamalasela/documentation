---
title: GitHub Webhook Setup
description: Connect your GitHub repository to the Xianix Agent via a webhook.
---

This guide walks you through connecting your GitHub repository to the Xianix Agent — from inviting the agent as a collaborator to wiring up the Xians webhook URL so it starts receiving events automatically.

:::note[Default rules]
The agent ships with a default set of rules pre-loaded under its **Knowledge Base** in the Agent Studio. The event configuration below matches those default rules. If you want to change which events trigger the agent, you'll need to update both the webhook events here **and** the rules file — see the [Rules Configuration](./rules) guide.
:::

:::tip[Before you begin]
You need **Admin** access to the repository, as well as the Xians webhook URL from [step 2 of the Quick Start](./quickstart#2-create-a-webhook-connection).
:::

## 1. Invite the agent as a collaborator

The agent needs write access to your repository so it can post review comments on pull requests.

In your GitHub repository, go to **Settings → Collaborators and teams** and click **Add people**. If you're using [Agentri](https://agentri.ai/) hosted services, invite the `xianix-agent` GitHub account and grant it the **Write** role.

:::caution[Authentication token required]
Once the invitation is accepted, the agent runtime needs a personal access token (PAT) scoped to this repository before it can interact with your code. Contact your Agentri admin to grant the necessary permissions. If you're the admin — or running on self-hosted Xians — follow the [Agent Permissions](../agent-development/tenant-isolation.md) guide to set this up yourself.
:::

## 2. Open Webhook Settings

In your GitHub repository, navigate to **Settings → Webhooks** and click **Add webhook**.

## 3. Configure the webhook

Enter your Xians webhook URL in the **Payload URL** field, then set **Content type** to `application/json`. Leave all other settings at their defaults.

| Field | Value |
|---|---|
| **Payload URL** | Paste the Xians webhook URL from the Agent Studio |
| **Content type** | `application/json` |
| **SSL verification** | Enable (recommended) |

## 4. Choose the trigger event

The default rules listen for pull request activity, so select **Let me select individual events** and enable **Pull requests**. This fires when a PR is opened, synchronized, or has its reviewers changed — exactly the signals the default rules act on.

| Event | When it fires |
|---|---|
| **Pull requests** | PR opened, closed, reopened, synchronized, or reviewer assignments changed |

The agent's rules engine handles finer-grained filtering itself, so you don't need to restrict events beyond this.

## 5. Activate

Make sure **Active** is checked, then click **Add webhook**. GitHub will immediately send a `ping` event — a green checkmark confirms the agent is reachable.

## 6. Test the integration

The default rules trigger the agent in three situations:

1. A pull request is **opened** with the agent listed as a reviewer.
2. **New commits are pushed** to a PR that already has the agent as a reviewer.
3. The agent is **requested as a reviewer** on an existing PR.

See the [PR Reviewer — GitHub rule example](/official-plugins/pr-reviewer/#github) for the exact `match-any` filters and input mappings behind these triggers.

To run your first end-to-end test, open a pull request and request a review from the agent's GitHub account (`xianix-agent` on Agentri). Then open the **Activity Logs** in the Agent Studio — you should see incoming task logs appear within 60 seconds. Within around 5 minutes, the agent will post a review comment directly on the PR.

## Next steps

- Review the ready-to-use [PR Reviewer GitHub rule](/official-plugins/pr-reviewer/#github) that ships with the default agent.
- [Configure agent rules](./rules) to customise which events the agent acts on — see the [complete example](./rules#complete-example) in the rules reference for the full file structure.
- Return to the [Quick Start](./quickstart) if you need a refresher on any earlier steps.
