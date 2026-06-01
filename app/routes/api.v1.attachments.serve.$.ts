/**
 * Serve Attachment Route (Splat Route)
 *
 * Serves uploaded attachment files from local storage.
 * The $ makes this a splat route that captures the rest of the path.
 *
 * GET /api/v1/attachments/serve/*
 */

import {LoaderFunctionArgs} from '@remix-run/node'
import * as fs from 'fs'
import * as path from 'path'

// Mime type mapping
const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
}

function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase()
  return MIME_TYPES[ext] || 'application/octet-stream'
}

export const loader = async ({request, params}: LoaderFunctionArgs) => {
  try {
    // Get the splat parameter (everything after /api/v1/attachments/serve/)
    const filePath = params['*']
    
    if (!filePath) {
      return new Response('Not found', {status: 404})
    }
    
    // Remove any query parameters from the path
    const cleanPath = decodeURIComponent(filePath.split('?')[0])
    
    // Build the full path to the file
    const basePath = process.env.STORAGE_LOCAL_PATH || path.join(process.cwd(), 'uploads', 'attachments')
    const fullPath = path.join(basePath, cleanPath)
    
    // Security: Ensure the resolved path is within the uploads directory
    const resolvedPath = path.resolve(fullPath)
    const resolvedBasePath = path.resolve(basePath)
    if (!resolvedPath.startsWith(resolvedBasePath)) {
      console.error('Path traversal attempt detected:', cleanPath)
      return new Response('Forbidden', {status: 403})
    }
    
    // Check if file exists
    if (!fs.existsSync(resolvedPath)) {
      console.error('File not found:', resolvedPath)
      return new Response('File not found', {status: 404})
    }
    
    // Read the file
    const fileBuffer = fs.readFileSync(resolvedPath)
    const mimeType = getMimeType(resolvedPath)
    
    // Return the file with appropriate headers
    return new Response(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(fileBuffer.length),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Disposition': 'inline',
      },
    })
  } catch (error: any) {
    console.error('Error serving attachment:', error)
    return new Response('Internal server error', {status: 500})
  }
}

