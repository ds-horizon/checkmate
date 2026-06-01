import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { handleApiResponse } from '../utils.js';

export default function registerGetRunAttachments(
  server: McpServer,
  makeRequest: <T>(path: string, init?: RequestInit) => Promise<T | null>,
) {
  server.tool(
    'get-run-attachments',
    'Get all attachments for a test within a run. Returns both expected (from test definition) and actual (from run execution) attachments.',
    {
      projectId: z.number().int().positive().describe('Project ID'),
      runId: z.number().int().positive().describe('Run ID'),
      testId: z.number().int().positive().describe('Test ID'),
    },
    async ({ projectId, runId, testId }) => {
      try {
        const qs = new URLSearchParams({
          projectId: String(projectId),
          runId: String(runId),
          testId: String(testId),
        });

        const data = await makeRequest(`api/v1/run/attachments?${qs.toString()}`);
        return handleApiResponse(data, `retrieve attachments for test ${testId} in run ${runId}`, [
          'projectId (number, required): Project ID',
          'runId (number, required): Run ID',
          'testId (number, required): Test ID',
        ]);
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Error retrieving run attachments: ${error instanceof Error ? error.message : 'Unknown error'}\n\n💡 Tip: Use get-run-tests-list to find valid test IDs in a run.`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
