/**
 * Delete Confirmation Dialog
 *
 * Shows a confirmation dialog before deleting an attachment.
 */

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/ui/alert-dialog'
import {Attachment} from './types'

interface DeleteConfirmDialogProps {
  attachment: Attachment | null
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
}

export function DeleteConfirmDialog({
  attachment,
  isOpen,
  onClose,
  onConfirm,
}: DeleteConfirmDialogProps) {
  if (!attachment) return null

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Attachment?</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete{' '}
            <span className="font-medium text-slate-700">
              "{attachment.originalFilename}"
            </span>
            ? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-red-600 hover:bg-red-700 focus:ring-red-600">
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export default DeleteConfirmDialog

