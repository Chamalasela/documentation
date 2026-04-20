// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mermaid from 'astro-mermaid';
import { visit } from 'unist-util-visit';

const base = '/documentation';

// Starlight does not auto-prepend the base path to absolute links in markdown
// content. This plugin rewrites them at build time so content files stay
// deployment-agnostic (no hardcoded /documentation/ in every link).
/** @returns {(tree: import('unist').Node) => void} */
function remarkPrependBase() {
	return (tree) => {
		visit(tree, ['link', 'definition'], (node) => {
			const linkNode = /** @type {{ url?: string }} */ (node);
			if (linkNode.url && linkNode.url.startsWith('/') && !linkNode.url.startsWith('//')) {
				linkNode.url = base + linkNode.url;
			}
		});
	};
}

// https://astro.build/config
export default defineConfig({
	site: 'https://xianix-team.github.io',
	base,
	markdown: {
		remarkPlugins: [remarkPrependBase],
	},
	integrations: [
		mermaid({ autoTheme: true }),
		starlight({
			title: 'Xianix Documentation',
			favicon: '/favicon.svg',
			// logo: {
			// 	light: './src/assets/logo-light.svg',
			// 	dark: './src/assets/logo-dark.svg',
			// 	alt: 'Xianix',
			// },
			description: 'AI-powered automation for your development lifecycle.',
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/xianix-team' },
			],
			sidebar: [
				{
					label: 'Introduction',
					items: [
				{ label: 'Overview', slug: 'introduction/overview' },
					{ label: 'Architecture', slug: 'introduction/architecture' },
					],
				},
				{
					label: 'Agent Configuration',
					items: [
					{ label: 'Prerequisites', slug: 'agent-configuration/prerequisites' },
				{ label: 'Quick Start', slug: 'agent-configuration/quickstart' },
				{ label: 'Azure DevOps Setup', slug: 'agent-configuration/azure-devops' },
				{ label: 'GitHub Setup', slug: 'agent-configuration/github' },
				{ label: 'Rules Configuration', slug: 'agent-configuration/rules' },
					],
				},
			{
				label: 'Official Plugins',
				items: [
					{ label: 'Adoption Guide', slug: 'official-plugins/adoption-guide' },
					{ label: 'Marketplace Overview', slug: 'official-plugins/overview' },
					{ label: 'Issue Lifecycle', slug: 'official-plugins/issue-lifecycle' },
					{ label: 'PR Lifecycle', slug: 'official-plugins/pr-lifecycle' },
					{ label: 'PR Reviewer', slug: 'official-plugins/pr-reviewer' },
					{ label: 'Requirement Analyst', slug: 'official-plugins/req-analyst' },
					{ label: 'Incident Response', slug: 'official-plugins/incident-response' },
				],
			},
				{
					label: 'Plugin Development',
					items: [
						{ label: 'Plugin Structure', slug: 'plugin-development/overview' },
						{ label: 'Marketplace', slug: 'plugin-development/marketplace' },
					],
				},
			{
				label: 'Agent Development',
				items: [
				{ label: 'Overview', slug: 'agent-development/overview' },
				{ label: 'Getting Started', slug: 'agent-development/getting-started' },
				{ label: 'How It Works', slug: 'agent-development/how-it-works' },
				{ label: 'The Executor', slug: 'agent-development/executor' },
				{ label: 'Extending the Agent', slug: 'agent-development/extending' },
				{ label: 'Deployment', slug: 'agent-development/deployment' },
				{ label: 'Contributing', slug: 'agent-development/contributing' },
				],
			},
			],
		}),
	],
});
