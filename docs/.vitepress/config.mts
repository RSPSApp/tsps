import { defineConfig } from 'vitepress';

export default defineConfig({
    title: 'XRSPS',
    description: 'Build plugins and custom content for OSRS in the browser',
    base: '/',
    // Quoted OSRS markup and placeholders are text, not Vue/HTML elements.
    markdown: {
        html: false,
        config(md) {
            md.renderer.rules.code_inline = (tokens, idx) =>
                `<code v-pre>${md.utils.escapeHtml(tokens[idx].content)}</code>`;
        },
    },
    head: [
        ['meta', { property: 'og:title', content: 'XRSPS' }],
        ['meta', { property: 'og:description', content: 'Build plugins and custom content for OSRS in the browser' }],
        ['meta', { name: 'theme-color', content: '#4a9eff' }],
    ],
    themeConfig: {
        logo: '/xrsps.png',
        siteTitle: false,
        nav: [
            { text: 'Home', link: '/' },
            { text: 'Docs', link: '/setup' }
        ],
        sidebar: [
            {
                text: 'Getting Started',
                items: [
                    { text: 'Setup', link: '/setup' },
                    { text: 'FAQ', link: '/faq' },
                    { text: 'Worktrees', link: '/worktrees' },
                ],
            },
            {
                text: 'Documentation',
                items: [
                    { text: 'Architecture', link: '/ARCHITECTURE' },
                    { text: 'Plugins', link: 'https://github.com/RSPSApp/tsps/blob/main/server/docs/agents/plugins.md' },
                    { text: 'Custom content', link: '/custom-content' },
                    { text: 'World configuration', link: '/world-configuration' },
                ],
            },
        ],
        socialLinks: [
            { icon: 'discord', link: 'https://discord.gg/3dzttF2q73' },
            { icon: 'github', link: 'https://github.com/xrsps/xrsps-typescript' },
        ],
        footer: {
            message: 'Fan project. Not affiliated with Jagex Ltd.',
        },
        editLink: {
            pattern: 'https://github.com/xrsps/xrsps-typescript/edit/main/docs/:path',
            text: 'Edit this page on GitHub',
        },
    },
});
