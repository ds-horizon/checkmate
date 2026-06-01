/**
 * Attachment Section Component
 *
 * A section wrapper for displaying attachments with a title and optional actions.
 */

import {cn} from '~/ui/utils'
import {MediaGallery} from './MediaGallery'
import {AttachmentSectionProps} from './types'

export function AttachmentSection({
  title,
  attachments,
  onDelete,
  canDelete = false,
  children,
  emptyMessage,
}: AttachmentSectionProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          {title}
          {attachments.length > 0 && (
            <span className="px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-600 rounded-full">
              {attachments.length}
            </span>
          )}
        </h3>
        {children}
      </div>

      <MediaGallery
        attachments={attachments}
        onDelete={onDelete}
        canDelete={canDelete}
        emptyMessage={emptyMessage}
      />
    </div>
  )
}

export default AttachmentSection

