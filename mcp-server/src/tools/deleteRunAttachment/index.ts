import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { handleApiResponse } from '../utils.js';

export default function registerDeleteRunAttachment(
  server: McpServer,
  makeRequest: <T>(path: string, init?: RequestInit) => Promise<T | null>,
) {
  server.tool(
    'delete-run-attachment',
    'Delete an attachment from a test within a run (actual behavior attachment).',
    {
      projectId: z.number().int().positive().describe('Project ID'),
      attachmentId: z.number().int().positive().describe('Attachment ID to delete'),
    },
    async ({ projectId, attachmentId }) => {
      try {
        const data = await makeRequest('api/v1/run/attachments/delete', {
          method: 'DELETE',
          body: JSON.stringify({
            projectId,
            attachmentId,
          }),
        });

        return handleApiResponse(data, `delete run attachment ${attachmentId}`, [
          'projectId (number, required): Project ID',
          'attachmentId (number, required): Attachment ID to delete',
        ]);
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Error deleting run attachment: ${error instanceof Error ? error.message : 'Unknown error'}\n\n💡 Tip: Use get-run-attachments to find valid attachment IDs.`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
