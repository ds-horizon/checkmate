/**
 * Media Viewer Component
 *
 * Full-screen lightbox for viewing images and videos with navigation.
 */

import {useCallback, useEffect} from 'react'
import {X, Trash2, Download, ExternalLink, ChevronLeft, ChevronRight} from 'lucide-react'
import {Button} from '~/ui/button'
import {cn} from '~/ui/utils'
import {
  MediaViewerProps,
  formatFileSize,
  isImageType,
  isVideoType,
} from './types'

export function MediaViewer({
  attachment,
  attachments = [],
  currentIndex = 0,
  isOpen,
  onClose,
  onDelete,
  canDelete = false,
  onNavigate,
}: MediaViewerProps) {
  const isImage = isImageType(attachment.mimeType)
  const isVideo = isVideoType(attachment.mimeType)
  
  // Navigation state
  const hasMultiple = attachments.length > 1
  const canGoPrev = hasMultiple && currentIndex > 0
  const canGoNext = hasMultiple && currentIndex < attachments.length - 1

  const handlePrev = useCallback(() => {
    if (canGoPrev && onNavigate) {
      onNavigate(currentIndex - 1)
    }
  }, [canGoPrev, currentIndex, onNavigate])

  const handleNext = useCallback(() => {
    if (canGoNext && onNavigate) {
      onNavigate(currentIndex + 1)
    }
  }, [canGoNext, currentIndex, onNavigate])

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return
      
      switch (e.key) {
        case 'Escape':
          onClose()
          break
        case 'ArrowLeft':
          handlePrev()
          break
        case 'ArrowRight':
          handleNext()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, handlePrev, handleNext])

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }

    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose()
      }
    },
    [onClose],
  )

  const handleDownload = useCallback(() => {
    const link = document.createElement('a')
    link.href = attachment.url
    link.download = attachment.originalFilename
    link.target = '_blank'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }, [attachment])

  const handleOpenInNewTab = useCallback(() => {
    window.open(attachment.url, '_blank')
  }, [attachment.url])

  if (!isOpen) return null

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center',
        'bg-black/90 backdrop-blur-sm',
      )}
      onClick={handleBackdropClick}>
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors z-10">
        <X className="w-6 h-6 text-white" />
      </button>

      {/* Counter badge */}
      {hasMultiple && (
        <div className="absolute top-4 left-4 px-3 py-1.5 rounded-full bg-white/10 text-white text-sm font-medium">
          {currentIndex + 1} / {attachments.length}
        </div>
      )}

      {/* Previous button */}
      {hasMultiple && (
        <button
          onClick={handlePrev}
          disabled={!canGoPrev}
          className={cn(
            'absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full transition-all z-10',
            canGoPrev
              ? 'bg-white/10 hover:bg-white/20 text-white cursor-pointer'
              : 'bg-white/5 text-white/30 cursor-not-allowed',
          )}>
          <ChevronLeft className="w-8 h-8" />
        </button>
      )}

      {/* Next button */}
      {hasMultiple && (
        <button
          onClick={handleNext}
          disabled={!canGoNext}
          className={cn(
            'absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full transition-all z-10',
            canGoNext
              ? 'bg-white/10 hover:bg-white/20 text-white cursor-pointer'
              : 'bg-white/5 text-white/30 cursor-not-allowed',
          )}>
          <ChevronRight className="w-8 h-8" />
        </button>
      )}

      {/* Media content */}
      <div className="relative max-w-[90vw] max-h-[85vh] flex flex-col px-16">
        {/* Media container */}
        <div className="flex-1 flex items-center justify-center min-h-0">
          {isImage ? (
            <img
              src={attachment.url}
              alt={attachment.originalFilename}
              className="max-w-full max-h-[75vh] object-contain rounded-lg"
            />
          ) : isVideo ? (
            <video
              src={attachment.url}
              controls
              autoPlay
              className="max-w-full max-h-[75vh] rounded-lg"
            />
          ) : (
            <div className="p-12 bg-slate-800 rounded-lg text-white text-center">
              <p>Unable to preview this file type</p>
              <p className="text-sm text-slate-400 mt-2">
                {attachment.mimeType}
              </p>
            </div>
          )}
        </div>

        {/* Info bar */}
        <div
          className={cn(
            'mt-4 p-4 bg-white/10 backdrop-blur-sm rounded-lg',
            'flex items-center justify-between gap-4',
          )}>
          <div className="text-white min-w-0">
            <p className="font-medium truncate">{attachment.originalFilename}</p>
            <p className="text-sm text-white/70">
              {formatFileSize(attachment.fileSize)} • {attachment.mimeType}
            </p>
            {attachment.description && (
              <p className="text-sm text-white/70 mt-1 line-clamp-2">
                {attachment.description}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenInNewTab}
              className="bg-white/10 border-white/20 text-white hover:bg-white/20">
              <ExternalLink className="w-4 h-4 mr-1.5" />
              Open
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              className="bg-white/10 border-white/20 text-white hover:bg-white/20">
              <Download className="w-4 h-4 mr-1.5" />
              Download
            </Button>

            {canDelete && onDelete && (
              <Button
                variant="destructive"
                size="sm"
                onClick={onDelete}>
                <Trash2 className="w-4 h-4 mr-1.5" />
                Delete
              </Button>
            )}
          </div>
        </div>

        {/* Keyboard hint */}
        {hasMultiple && (
          <p className="text-center text-white/50 text-xs mt-3">
            Use ← → arrow keys to navigate • ESC to close
          </p>
        )}
      </div>
    </div>
  )
}

export default MediaViewer
