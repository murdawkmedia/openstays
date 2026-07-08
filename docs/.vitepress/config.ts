import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'OpenStays',
  description:
    'Open-source booking engine and property-management system for independent lodging — campgrounds, cabins, glamping, yurts, small resorts.',
  base: '/openstays/',
  cleanUrls: true,

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/quickstart' },
      { text: 'Concepts', link: '/concepts/availability' },
      { text: 'Roadmap', link: '/roadmap' },
      { text: 'GitHub', link: 'https://github.com/murdawkmedia/openstays' },
    ],

    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Quickstart', link: '/quickstart' },
          { text: 'Configuration', link: '/configuration' },
          { text: 'Self-hosting & deployment', link: '/self-hosting' },
          { text: 'Automation (API / CLI / MCP)', link: '/automation' },
        ],
      },
      {
        text: 'Concepts',
        items: [
          { text: 'Availability & holds', link: '/concepts/availability' },
          { text: 'Payments', link: '/concepts/payments' },
        ],
      },
      {
        text: 'Project',
        items: [{ text: 'Roadmap', link: '/roadmap' }],
      },
    ],

    socialLinks: [{ icon: 'github', link: 'https://github.com/murdawkmedia/openstays' }],

    footer: {
      message:
        'Released under the MIT License. Built by <a href="https://www.sebahub.com" target="_blank" rel="noreferrer">SebaHub</a> — Seba Beach, Alberta, Canada.',
      copyright: 'Copyright © Murdawk Media',
    },

    search: {
      provider: 'local',
    },
  },
});
