/**
 * Media Gallery Component
 *
 * Displays a grid of media thumbnails with lightbox viewing and navigation.
 * Supports soft delete (staging deletions until form submission).
 */

import {useState, useCallback} from 'react'
import {ImageIcon, VideoIcon, Trash2, Undo2} from 'lucide-react'
import {cn} from '~/ui/utils'
import {
  MediaGalleryProps,
  Attachment,
  formatFileSize,
  isImageType,
  isVideoType,
} from './types'
import {MediaViewer} from './MediaViewer'
import {DeleteConfirmDialog} from './DeleteConfirmDialog'

export function MediaGallery({
  attachments,
  onDelete,
  canDelete = false,
  emptyMessage = 'No attachments',
  title,
  pendingDeletions = new Set(),
  onUndoDelete,
}: MediaGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [attachmentToDelete, setAttachmentToDelete] = useState<Attachment | null>(null)

  // Filter out pending deletions for display count
  const activeAttachments = attachments.filter(
    (a) => !pendingDeletions.has(a.attachmentId)
  )
  const deletedCount = pendingDeletions.size

  const handleThumbnailClick = useCallback((index: number) => {
    // Don't open viewer for soft-deleted attachments
    const attachment = attachments[index]
    if (pendingDeletions.has(attachment.attachmentId)) return
    setSelectedIndex(index)
  }, [attachments, pendingDeletions])

  const handleCloseViewer = useCallback(() => {
    setSelectedIndex(null)
  }, [])

  const handleNavigate = useCallback((index: number) => {
    // Skip soft-deleted attachments during navigation
    const attachment = attachments[index]
    if (attachment && !pendingDeletions.has(attachment.attachmentId)) {
      setSelectedIndex(index)
    }
  }, [attachments, pendingDeletions])

  // Show delete confirmation dialog
  const handleRequestDelete = useCallback((attachment: Attachment) => {
    setAttachmentToDelete(attachment)
  }, [])

  // Close delete confirmation dialog
  const handleCancelDelete = useCallback(() => {
    setAttachmentToDelete(null)
  }, [])

  // Confirm and execute delete (soft delete)
  const handleConfirmDelete = useCallback(() => {
    if (attachmentToDelete && onDelete) {
      onDelete(attachmentToDelete.attachmentId)
      
      // Close viewer if the deleted attachment was selected
      if (selectedIndex !== null) {
        const selectedAttachment = attachments[selectedIndex]
        if (selectedAttachment?.attachmentId === attachmentToDelete.attachmentId) {
          setSelectedIndex(null)
        }
      }
    }
    setAttachmentToDelete(null)
  }, [attachmentToDelete, onDelete, selectedIndex, attachments])

  // Handle undo delete
  const handleUndoDelete = useCallback((attachmentId: number) => {
    onUndoDelete?.(attachmentId)
  }, [onUndoDelete])

  if (attachments.length === 0) {
    return (
      <div className="text-center py-8 text-slate-500">
        <ImageIcon className="w-12 h-12 mx-auto mb-2 opacity-30" />
        <p className="text-sm">{emptyMessage}</p>
      </div>
    )
  }

  const selectedAttachment = selectedIndex !== null ? attachments[selectedIndex] : null

  return (
    <div className="space-y-3">
      {title && (
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      )}

      {/* Pending deletions notice */}
      {deletedCount > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm">
          <span className="text-amber-700">
            {deletedCount} attachment{deletedCount !== 1 ? 's' : ''} marked for deletion.
          </span>
          <span className="text-amber-600">
            Changes will be applied when you save.
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {attachments.map((attachment, index) => {
          const isPendingDelete = pendingDeletions.has(attachment.attachmentId)
          return (
            <MediaThumbnail
              key={attachment.attachmentId}
              attachment={attachment}
              onClick={() => handleThumbnailClick(index)}
              onDelete={canDelete && !isPendingDelete ? () => handleRequestDelete(attachment) : undefined}
              onUndoDelete={isPendingDelete ? () => handleUndoDelete(attachment.attachmentId) : undefined}
              canDelete={canDelete}
              isPendingDelete={isPendingDelete}
            />
          )
        })}
      </div>

      {/* Media Viewer Modal with Navigation */}
      {selectedAttachment && selectedIndex !== null && !pendingDeletions.has(selectedAttachment.attachmentId) && (
        <MediaViewer
          attachment={selectedAttachment}
          attachments={activeAttachments}
          currentIndex={activeAttachments.findIndex(a => a.attachmentId === selectedAttachment.attachmentId)}
          isOpen={true}
          onClose={handleCloseViewer}
          onNavigate={(newIndex) => {
            const newAttachment = activeAttachments[newIndex]
            if (newAttachment) {
              const originalIndex = attachments.findIndex(a => a.attachmentId === newAttachment.attachmentId)
              setSelectedIndex(originalIndex)
            }
          }}
          onDelete={
            canDelete ? () => handleRequestDelete(selectedAttachment) : undefined
          }
          canDelete={canDelete}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        attachment={attachmentToDelete}
        isOpen={attachmentToDelete !== null}
        onClose={handleCancelDelete}
        onConfirm={handleConfirmDelete}
      />
    </div>
  )
}

interface MediaThumbnailProps {
  attachment: Attachment
  onClick: () => void
  onDelete?: () => void
  onUndoDelete?: () => void
  canDelete?: boolean
  isPendingDelete?: boolean
}

function MediaThumbnail({
  attachment,
  onClick,
  onDelete,
  onUndoDelete,
  canDelete,
  isPendingDelete = false,
}: MediaThumbnailProps) {
  const isImage = isImageType(attachment.mimeType)
  const isVideo = isVideoType(attachment.mimeType)

  const handleDeleteClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onDelete?.()
    },
    [onDelete],
  )

  const handleUndoClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onUndoDelete?.()
    },
    [onUndoDelete],
  )

  return (
    <div
      className={cn(
        'group relative aspect-square rounded-lg overflow-hidden border',
        'transition-all',
        isPendingDelete
          ? 'border-red-300 opacity-50 cursor-default'
          : 'border-slate-200 hover:border-slate-300 hover:shadow-sm cursor-pointer',
        'bg-slate-100',
      )}
      onClick={onClick}>
      {/* Thumbnail */}
      {isImage ? (
        <img
          src={attachment.url}
          alt={attachment.originalFilename}
          className={cn(
            'w-full h-full object-cover',
            isPendingDelete && 'grayscale',
          )}
          loading="lazy"
        />
      ) : isVideo ? (
        <div className={cn(
          'w-full h-full flex items-center justify-center bg-slate-800',
          isPendingDelete && 'grayscale',
        )}>
          <VideoIcon className="w-10 h-10 text-white opacity-70" />
        </div>
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <ImageIcon className="w-10 h-10 text-slate-400" />
        </div>
      )}

      {/* Pending delete overlay */}
      {isPendingDelete && (
        <div className="absolute inset-0 bg-red-500/20 flex items-center justify-center">
          <div className="text-center">
            <Trash2 className="w-6 h-6 text-red-600 mx-auto mb-1" />
            <span className="text-xs font-medium text-red-700 bg-white/80 px-2 py-0.5 rounded">
              Marked for deletion
            </span>
          </div>
        </div>
      )}

      {/* Undo button for pending deletions */}
      {isPendingDelete && onUndoDelete && (
        <button
          onClick={handleUndoClick}
          className="absolute top-2 right-2 p-1.5 bg-white rounded-full shadow-md hover:bg-slate-100 transition-colors z-10"
          title="Undo delete">
          <Undo2 className="w-4 h-4 text-slate-700" />
        </button>
      )}

      {/* Normal overlay on hover (only for non-deleted) */}
      {!isPendingDelete && (
        <div
          className={cn(
            'absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100',
            'transition-opacity flex items-end justify-between p-2',
          )}>
          <div className="text-white text-xs truncate max-w-[80%]">
            {attachment.originalFilename}
          </div>

          {canDelete && onDelete && (
            <button
              onClick={handleDeleteClick}
              className="p-1.5 bg-red-500 rounded-full hover:bg-red-600 transition-colors">
              <Trash2 className="w-3.5 h-3.5 text-white" />
            </button>
          )}
        </div>
      )}

      {/* Video indicator */}
      {isVideo && !isPendingDelete && (
        <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-black/60 rounded text-white text-xs">
          Video
        </div>
      )}

      {/* File size indicator */}
      {!isPendingDelete && (
        <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-black/60 rounded text-white text-xs">
          {formatFileSize(attachment.fileSize)}
        </div>
      )}
    </div>
  )
}

export default MediaGallery
