/**
 * Media Uploader Component
 *
 * Drag-and-drop file uploader for test and run attachments.
 * Supports images (PNG, JPEG, GIF, WebP) and videos (MP4, WebM, MOV).
 */

import {useCallback, useState, useRef} from 'react'
import {useFetcher} from '@remix-run/react'
import {Upload, X, FileImage, FileVideo, AlertCircle} from 'lucide-react'
import {Button} from '~/ui/button'
import {cn} from '~/ui/utils'
import {API} from '~/routes/utilities/api'
import {
  MediaUploaderProps,
  Attachment,
  AttachmentUploadProgress,
  formatFileSize,
  isImageType,
  isVideoType,
} from './types'

const MAX_FILE_SIZE_IMAGE = 10 * 1024 * 1024 // 10MB
const MAX_FILE_SIZE_VIDEO = 100 * 1024 * 1024 // 100MB
const MAX_ATTACHMENTS = 10

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']
const ACCEPTED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime']
const ACCEPTED_TYPES = [...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_VIDEO_TYPES]

export function MediaUploader({
  projectId,
  testId,
  runId,
  attachmentType,
  onUploadComplete,
  onUploadError,
  disabled = false,
  maxFiles = MAX_ATTACHMENTS,
  currentCount = 0,
}: MediaUploaderProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [uploadQueue, setUploadQueue] = useState<AttachmentUploadProgress[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadFetcher = useFetcher<{data?: Attachment; error?: string}>()

  const remainingSlots = maxFiles - currentCount

  const validateFile = useCallback(
    (file: File): string | null => {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        return `Unsupported file type: ${file.type}`
      }

      const maxSize = isImageType(file.type)
        ? MAX_FILE_SIZE_IMAGE
        : MAX_FILE_SIZE_VIDEO

      if (file.size > maxSize) {
        return `File too large. Maximum size: ${formatFileSize(maxSize)}`
      }

      return null
    },
    [],
  )

  const uploadFile = useCallback(
    async (file: File) => {
      const validationError = validateFile(file)
      if (validationError) {
        onUploadError?.(validationError)
        return
      }

      // Update queue with uploading status
      setUploadQueue((prev) => [
        ...prev,
        {filename: file.name, progress: 0, status: 'uploading'},
      ])

      const formData = new FormData()
      formData.append('file', file)

      // Build URL with query params (multipart form data doesn't preserve text fields reliably)
      const params = new URLSearchParams({
        projectId: String(projectId),
        testId: String(testId),
      })
      if (runId) {
        params.append('runId', String(runId))
      }

      const baseUrl =
        attachmentType === 'expected'
          ? `/${API.UploadTestAttachment}`
          : `/${API.UploadRunAttachment}`
      
      const uploadUrl = `${baseUrl}?${params.toString()}`

      try {
        const response = await fetch(uploadUrl, {
          method: 'POST',
          body: formData,
        })

        const result = await response.json()

        if (result.error) {
          setUploadQueue((prev) =>
            prev.map((item) =>
              item.filename === file.name
                ? {...item, status: 'error', error: result.error}
                : item,
            ),
          )
          onUploadError?.(result.error)
        } else if (result.data) {
          setUploadQueue((prev) =>
            prev.map((item) =>
              item.filename === file.name
                ? {...item, status: 'completed', progress: 100}
                : item,
            ),
          )
          onUploadComplete?.(result.data)

          // Remove from queue after a delay
          setTimeout(() => {
            setUploadQueue((prev) =>
              prev.filter((item) => item.filename !== file.name),
            )
          }, 2000)
        }
      } catch (error: any) {
        setUploadQueue((prev) =>
          prev.map((item) =>
            item.filename === file.name
              ? {...item, status: 'error', error: error.message}
              : item,
          ),
        )
        onUploadError?.(error.message)
      }
    },
    [projectId, testId, runId, attachmentType, onUploadComplete, onUploadError, validateFile],
  )

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || disabled || remainingSlots <= 0) return

      const filesToUpload = Array.from(files).slice(0, remainingSlots)

      for (const file of filesToUpload) {
        uploadFile(file)
      }
    },
    [uploadFile, disabled, remainingSlots],
  )

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      if (!disabled && remainingSlots > 0) {
        setIsDragOver(true)
      }
    },
    [disabled, remainingSlots],
  )

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
      handleFiles(e.dataTransfer.files)
    },
    [handleFiles],
  )

  const handleClick = useCallback(() => {
    if (!disabled && remainingSlots > 0) {
      fileInputRef.current?.click()
    }
  }, [disabled, remainingSlots])

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(e.target.files)
      // Reset input so same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    },
    [handleFiles],
  )

  const removeFromQueue = useCallback((filename: string) => {
    setUploadQueue((prev) => prev.filter((item) => item.filename !== filename))
  }, [])

  const isDisabled = disabled || remainingSlots <= 0

  return (
    <div className="space-y-3">
      {/* Dropzone */}
      <div
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'relative border-2 border-dashed rounded-lg p-6 transition-all cursor-pointer',
          'flex flex-col items-center justify-center gap-2 min-h-[120px]',
          isDragOver && !isDisabled
            ? 'border-blue-500 bg-blue-50'
            : 'border-slate-300 hover:border-slate-400',
          isDisabled && 'opacity-50 cursor-not-allowed hover:border-slate-300',
        )}>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPTED_TYPES.join(',')}
          onChange={handleFileChange}
          className="hidden"
          disabled={isDisabled}
        />

        <Upload
          className={cn(
            'w-8 h-8',
            isDragOver && !isDisabled ? 'text-blue-500' : 'text-slate-400',
          )}
        />

        <div className="text-center">
          <p className="text-sm font-medium text-slate-700">
            {isDragOver && !isDisabled
              ? 'Drop files here'
              : 'Drag & drop files or click to browse'}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Images (PNG, JPEG, GIF, WebP) up to 10MB • Videos (MP4, WebM, MOV) up to
            100MB
          </p>
          {remainingSlots < maxFiles && (
            <p className="text-xs text-slate-500 mt-1">
              {remainingSlots > 0
                ? `${remainingSlots} slot${remainingSlots !== 1 ? 's' : ''} remaining`
                : 'Maximum attachments reached'}
            </p>
          )}
        </div>
      </div>

      {/* Upload Queue */}
      {uploadQueue.length > 0 && (
        <div className="space-y-2">
          {uploadQueue.map((item) => (
            <div
              key={item.filename}
              className={cn(
                'flex items-center gap-3 p-3 rounded-lg border',
                item.status === 'error'
                  ? 'border-red-200 bg-red-50'
                  : item.status === 'completed'
                    ? 'border-green-200 bg-green-50'
                    : 'border-slate-200 bg-slate-50',
              )}>
              {/* File icon */}
              <div className="flex-shrink-0">
                {item.status === 'error' ? (
                  <AlertCircle className="w-5 h-5 text-red-500" />
                ) : (
                  <FileImage className="w-5 h-5 text-slate-400" />
                )}
              </div>

              {/* File info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-700 truncate">
                  {item.filename}
                </p>
                {item.status === 'error' ? (
                  <p className="text-xs text-red-600">{item.error}</p>
                ) : item.status === 'uploading' ? (
                  <div className="mt-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all duration-300"
                      style={{width: `${item.progress}%`}}
                    />
                  </div>
                ) : (
                  <p className="text-xs text-green-600">Upload complete</p>
                )}
              </div>

              {/* Remove button */}
              {(item.status === 'error' || item.status === 'completed') && (
                <button
                  onClick={() => removeFromQueue(item.filename)}
                  className="flex-shrink-0 p-1 hover:bg-slate-200 rounded">
                  <X className="w-4 h-4 text-slate-500" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default MediaUploader

