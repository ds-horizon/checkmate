import {Dialog, DialogContent, DialogDescription, DialogTitle} from '~/ui/dialog'
import {Download, ExternalLink, Image as ImageIcon, Paperclip, X} from 'lucide-react'
import {useRef, useState} from 'react'
import {Button} from '~/ui/button'
import {cn} from '~/ui/utils'

export interface ResultAttachment {
  id: string
  url: string
  fileName: string
  key?: string
  status?: 'loading' | 'ready' | 'error'
  error?: string
  isExisting?: boolean
}

const ATTACHMENT_KEY_IN_PATH =
  /test-run-attachments\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[a-zA-Z0-9._-]+/

export const getAttachmentFileName = (value: string): string => {
  const withoutQuery = value.split('?')[0]
  const pathName = withoutQuery.split('/').pop() ?? value
  let decodedPathName = pathName
  try {
    decodedPathName = decodeURIComponent(pathName)
  } catch {
    // Keep the raw path segment if an upstream URL contains malformed escaping.
  }
  return decodedPathName.replace(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i,
    '',
  )
}

/**
 * The history endpoint intentionally returns signed URLs for viewing. The
 * write endpoint accepts the underlying attachment key. Since the key is
 * present in the signed URL path, keep this conversion local to the UI and
 * never send a signed URL to the write endpoint.
 */
export const getAttachmentKeyFromUrl = (url: string): string | undefined => {
  try {
    const path = decodeURIComponent(new URL(url).pathname)
    return path.match(ATTACHMENT_KEY_IN_PATH)?.[0]
  } catch {
    return url.match(ATTACHMENT_KEY_IN_PATH)?.[0]
  }
}

interface ResultAttachmentGalleryProps {
  attachments: ResultAttachment[]
  onRemove?: (attachment: ResultAttachment) => void
  className?: string
  emptyLabel?: string
  labelledBy?: string
}

export const ResultAttachmentGallery = ({
  attachments,
  onRemove,
  className,
  emptyLabel = 'No screenshots attached',
  labelledBy,
}: ResultAttachmentGalleryProps) => {
  const [selectedAttachment, setSelectedAttachment] =
    useState<ResultAttachment | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  if (attachments.length === 0) {
    return <p className="text-sm text-slate-500">{emptyLabel}</p>
  }

  return (
    <>
      <div
        className={cn('space-y-2', className)}
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : `${attachments.length} screenshots`}
      >
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
          <Paperclip size={14} aria-hidden="true" />
          <span>
            {attachments.length} screenshot{attachments.length === 1 ? '' : 's'}
          </span>
        </div>
        <ul className="flex flex-wrap gap-2" aria-label="Screenshot attachments">
          {attachments.map((attachment, index) => {
            const isLoading = attachment.status === 'loading'
            const isError = attachment.status === 'error'
            return (
              <li key={attachment.id} className="group relative w-[92px]">
                <button
                  type="button"
                  className="block w-full rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2"
                  onClick={(event) => {
                    if (isLoading || isError) return
                    triggerRef.current = event.currentTarget
                    setSelectedAttachment(attachment)
                  }}
                  disabled={isLoading || isError}
                  aria-label={`Open screenshot ${index + 1}: ${attachment.fileName}`}
                >
                  <span className="flex h-16 w-[92px] items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                    {isLoading ? (
                      <span className="text-xs text-slate-500">Uploading...</span>
                    ) : isError ? (
                      <span className="px-1 text-center text-xs font-medium text-red-700">
                        Upload failed
                      </span>
                    ) : (
                      <img
                        src={attachment.url}
                        alt={attachment.fileName || `Screenshot ${index + 1}`}
                        loading="lazy"
                        width={92}
                        height={64}
                        className="h-full w-full object-cover"
                      />
                    )}
                  </span>
                  <span className="mt-1 block truncate text-[11px] text-slate-600">
                    {attachment.fileName || `Screenshot ${index + 1}`}
                  </span>
                </button>
                {onRemove && (
                  <button
                    type="button"
                    className="absolute -right-1.5 -top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-1"
                    onClick={() => onRemove(attachment)}
                    aria-label={`Remove ${attachment.fileName || `screenshot ${index + 1}`}`}
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                )}
                {isError && attachment.error && (
                  <p className="mt-1 break-words text-[11px] text-red-700" role="alert">
                    {attachment.error}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      <Dialog
        open={selectedAttachment !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedAttachment(null)
            if (typeof window !== 'undefined') {
              window.requestAnimationFrame(() => triggerRef.current?.focus())
            }
          }
        }}
      >
        <DialogContent className="max-w-[min(94vw,1100px)] border-slate-700 bg-slate-950 p-4 text-white sm:p-6">
          <DialogTitle className="pr-10 text-left text-base text-white">
            {selectedAttachment?.fileName ?? 'Screenshot preview'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Full-size screenshot preview. Press Escape to close.
          </DialogDescription>
          {selectedAttachment && (
            <div className="space-y-4">
              <div className="flex min-h-[200px] items-center justify-center overflow-hidden rounded-md bg-black/40 p-2">
                <img
                  src={selectedAttachment.url}
                  alt={selectedAttachment.fileName || 'Full-size screenshot'}
                  className="max-h-[70vh] max-w-full object-contain"
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex min-w-0 items-center gap-1.5 text-xs text-slate-300">
                  <ImageIcon size={14} aria-hidden="true" />
                  <span className="truncate">{selectedAttachment.fileName}</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="border-slate-600 bg-slate-900 text-white hover:bg-slate-800 hover:text-white"
                  >
                    <a href={selectedAttachment.url} download={selectedAttachment.fileName}>
                      <Download size={14} className="mr-1.5" aria-hidden="true" />
                      Download
                    </a>
                  </Button>
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="border-slate-600 bg-slate-900 text-white hover:bg-slate-800 hover:text-white"
                  >
                    <a href={selectedAttachment.url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink size={14} className="mr-1.5" aria-hidden="true" />
                      Open original
                    </a>
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
