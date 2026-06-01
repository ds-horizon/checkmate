import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { handleApiResponse } from '../utils.js';

export default function registerGetTestAttachments(
  server: McpServer,
  makeRequest: <T>(path: string, init?: RequestInit) => Promise<T | null>,
) {
  server.tool(
    'get-test-attachments',
    'Get all attachments (screenshots/videos) for a test case. These represent expected behavior.',
    {
      projectId: z.number().int().positive().describe('Project ID'),
      testId: z.number().int().positive().describe('Test ID'),
    },
    async ({ projectId, testId }) => {
      try {
        const qs = new URLSearchParams({
          projectId: String(projectId),
          testId: String(testId),
        });

        const data = await makeRequest(`api/v1/test/attachments?${qs.toString()}`);
        return handleApiResponse(data, `retrieve attachments for test ${testId}`, [
          'projectId (number, required): Project ID',
          'testId (number, required): Test ID',
        ]);
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Error retrieving test attachments: ${error instanceof Error ? error.message : 'Unknown error'}\n\n💡 Tip: Use get-tests to find valid test IDs.`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
