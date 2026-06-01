import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'project/introduction',
    'project/setup',
    'project/cloud-deployment',
    {
      type: 'category',
      label: 'User Guide',
      items: [
        'guides/projects',
        {
          type: 'category',
          label: 'Tests',
          items: ['guides/tests/index', 'guides/tests/bulk-addition'],
        },
        {
          type: 'category',
          label: 'Runs',
          items: ['guides/runs/index', 'guides/runs/run-detail'],
        },
        {
          type: 'category',
          label: 'Users',
          items: ['guides/user-settings', 'project/rbac'],
        },
      ],
    },
    {
      type: 'category',
      label: 'Developer Docs',
      items: [
        {
          type: 'category',
          label: 'Application',
          items: ['tech/architecture', 'tech/database', 'project/mcp-docker'],
        },
        {
          type: 'category',
          label: 'API Documentation',
          items: [
            'guides/api/index',
            'guides/api/authentication',
            'guides/api/examples',
            'guides/api/openapi',
          ],
        },
        {
          type: 'category',
          label: 'MCP Server',
          items: [
            'guides/api/mcp-tools',
            'guides/api/mcp-server',
          ],
        },
      ],
    },
  ],
};

export default sidebars;
