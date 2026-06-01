/**
 * Attachment Component Types
 *
 * Type definitions for attachment-related components.
 */

export interface Attachment {
  attachmentId: number
  testId: number
  projectId: number
  runId?: number
  storageKey: string
  originalFilename: string
  mimeType: string
  fileSize: number
  mediaType: 'image' | 'video'
  description: string | null
  displayOrder: number | null
  url: string
  createdOn: Date | string
}

export interface AttachmentUploadProgress {
  filename: string
  progress: number // 0-100
  status: 'pending' | 'uploading' | 'completed' | 'error'
  error?: string
}

export interface MediaUploaderProps {
  projectId: number
  testId: number
  runId?: number
  attachmentType: 'expected' | 'actual'
  onUploadComplete?: (attachment: Attachment) => void
  onUploadError?: (error: string) => void
  disabled?: boolean
  maxFiles?: number
  currentCount?: number
}

export interface MediaGalleryProps {
  attachments: Attachment[]
  onDelete?: (attachmentId: number) => void
  canDelete?: boolean
  emptyMessage?: string
  title?: string
  // Soft delete support
  pendingDeletions?: Set<number> // IDs of attachments marked for deletion
  onUndoDelete?: (attachmentId: number) => void // Restore a soft-deleted attachment
}

export interface MediaViewerProps {
  attachment: Attachment
  attachments?: Attachment[] // All attachments for navigation
  currentIndex?: number // Current attachment index
  isOpen: boolean
  onClose: () => void
  onDelete?: () => void
  canDelete?: boolean
  onNavigate?: (index: number) => void // Navigate to specific index
}

export interface MediaThumbnailProps {
  attachment: Attachment
  onClick?: () => void
  onDelete?: () => void
  canDelete?: boolean
  size?: 'sm' | 'md' | 'lg'
}

export interface AttachmentSectionProps {
  title: string
  attachments: Attachment[]
  onDelete?: (attachmentId: number) => void
  canDelete?: boolean
  children?: React.ReactNode
  emptyMessage?: string
}

// Helper functions
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

export function getFileExtension(filename: string): string {
  return filename.slice(((filename.lastIndexOf('.') - 1) >>> 0) + 2)
}

export function isImageType(mimeType: string): boolean {
  return mimeType.startsWith('image/')
}

export function isVideoType(mimeType: string): boolean {
  return mimeType.startsWith('video/')
}

