import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { handleApiResponse } from '../utils.js';

export default function registerGetPresignedUploadUrl(
  server: McpServer,
  makeRequest: <T>(path: string, init?: RequestInit) => Promise<T | null>,
) {
  server.tool(
    'get-presigned-upload-url',
    'Get a presigned URL for uploading an attachment directly to storage. Use this for uploading screenshots or videos. After uploading to the presigned URL, call confirm-attachment-upload to save the attachment.',
    {
      projectId: z.number().int().positive().describe('Project ID'),
      testId: z.number().int().positive().describe('Test ID'),
      runId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Run ID (required for actual behavior attachments)'),
      filename: z
        .string()
        .min(1)
        .describe('Original filename with extension (e.g., screenshot.png)'),
      mimeType: z.string().min(1).describe('MIME type (e.g., image/png, video/mp4)'),
      fileSize: z.number().int().positive().describe('File size in bytes'),
      attachmentType: z
        .enum(['expected', 'actual'])
        .describe('Type: expected (test-level) or actual (run-level)'),
    },
    async ({ projectId, testId, runId, filename, mimeType, fileSize, attachmentType }) => {
      try {
        // Validate runId for actual attachments
        if (attachmentType === 'actual' && !runId) {
          return {
            content: [
              {
                type: 'text',
                text: '❌ Error: runId is required for actual behavior attachments.\n\n💡 Tip: Provide a runId when uploading attachments during test execution.',
              },
            ],
            isError: true,
          };
        }

        const data = await makeRequest('api/v1/attachments/presigned-url', {
          method: 'POST',
          body: JSON.stringify({
            projectId,
            testId,
            runId,
            filename,
            mimeType,
            fileSize,
            attachmentType,
          }),
        });

        if (data && typeof data === 'object' && 'data' in data) {
          const responseData = data as {
            data: { uploadUrl: string; storageKey: string; expiresAt: string };
          };
          return {
            content: [
              {
                type: 'text',
                text:
                  `✅ Presigned upload URL generated successfully!\n\n` +
                  `📤 **Upload URL**: ${responseData.data.uploadUrl}\n\n` +
                  `🔑 **Storage Key**: ${responseData.data.storageKey}\n\n` +
                  `⏰ **Expires At**: ${responseData.data.expiresAt}\n\n` +
                  `📝 **Next Steps**:\n` +
                  `1. Upload your file to the URL using PUT request with Content-Type: ${mimeType}\n` +
                  `2. After successful upload, call confirm-attachment-upload with:\n` +
                  `   - storageKey: "${responseData.data.storageKey}"\n` +
                  `   - filename: "${filename}"\n` +
                  `   - mimeType: "${mimeType}"\n` +
                  `   - fileSize: ${fileSize}\n` +
                  `   - attachmentType: "${attachmentType}"\n`,
              },
            ],
          };
        }

        return handleApiResponse(data, `generate presigned upload URL`, [
          'projectId (number, required): Project ID',
          'testId (number, required): Test ID',
          'runId (number, optional): Run ID (required for actual attachments)',
          'filename (string, required): Original filename',
          'mimeType (string, required): MIME type',
          'fileSize (number, required): File size in bytes',
          'attachmentType (string, required): "expected" or "actual"',
        ]);
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Error generating presigned URL: ${error instanceof Error ? error.message : 'Unknown error'}\n\n💡 Supported file types:\n- Images: PNG, JPEG, GIF, WebP (max 10MB)\n- Videos: MP4, WebM, MOV (max 100MB)`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
