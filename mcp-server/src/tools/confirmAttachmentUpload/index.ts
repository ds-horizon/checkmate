import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { handleApiResponse } from '../utils.js';

export default function registerConfirmAttachmentUpload(
  server: McpServer,
  makeRequest: <T>(path: string, init?: RequestInit) => Promise<T | null>,
) {
  server.tool(
    'confirm-attachment-upload',
    'Confirm an attachment upload after successfully uploading to the presigned URL. This creates the database record for the attachment.',
    {
      projectId: z.number().int().positive().describe('Project ID'),
      testId: z.number().int().positive().describe('Test ID'),
      runId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Run ID (required for actual behavior attachments)'),
      storageKey: z.string().min(1).describe('Storage key returned from get-presigned-upload-url'),
      filename: z.string().min(1).describe('Original filename'),
      mimeType: z.string().min(1).describe('MIME type'),
      fileSize: z.number().int().positive().describe('File size in bytes'),
      description: z.string().optional().describe('Optional description for the attachment'),
      attachmentType: z
        .enum(['expected', 'actual'])
        .describe('Type: expected (test-level) or actual (run-level)'),
    },
    async ({
      projectId,
      testId,
      runId,
      storageKey,
      filename,
      mimeType,
      fileSize,
      description,
      attachmentType,
    }) => {
      try {
        // Validate runId for actual attachments
        if (attachmentType === 'actual' && !runId) {
          return {
            content: [
              {
                type: 'text',
                text: '❌ Error: runId is required for actual behavior attachments.\n\n💡 Tip: Provide a runId when confirming attachments during test execution.',
              },
            ],
            isError: true,
          };
        }

        const data = await makeRequest('api/v1/attachments/confirm-upload', {
          method: 'POST',
          body: JSON.stringify({
            projectId,
            testId,
            runId,
            storageKey,
            filename,
            mimeType,
            fileSize,
            description,
            attachmentType,
          }),
        });

        return handleApiResponse(data, `confirm attachment upload`, [
          'projectId (number, required): Project ID',
          'testId (number, required): Test ID',
          'runId (number, optional): Run ID (required for actual attachments)',
          'storageKey (string, required): Storage key from presigned URL',
          'filename (string, required): Original filename',
          'mimeType (string, required): MIME type',
          'fileSize (number, required): File size in bytes',
          'description (string, optional): Attachment description',
          'attachmentType (string, required): "expected" or "actual"',
        ]);
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Error confirming attachment upload: ${error instanceof Error ? error.message : 'Unknown error'}\n\n💡 Tip: Make sure the file was successfully uploaded to the presigned URL before confirming.`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
