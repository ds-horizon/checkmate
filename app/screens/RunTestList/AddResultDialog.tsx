import {API} from '~/routes/utilities/api'
import {TestStatusType} from '@controllers/types'
import {useFetcher} from '@remix-run/react'
import {ChevronDown, X} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'
import {ComboboxDemo} from '~/components/ComboBox/ComboBox'
import {CustomDialog} from '~/components/Dialog/Dialog'
import {Loader} from '~/components/Loader/Loader'
import {Button} from '~/ui/button'
import {DialogClose, DialogTitle} from '~/ui/dialog'
import {Input} from '~/ui/input'
import {Textarea} from '~/ui/textarea'
import {useToast} from '~/ui/use-toast'
import {getStatusColor, getStatusTextColor} from '../TestDetail/util'
import {cn} from '@ui/utils'

const TEST_STATUS_OPTIONS = [
  {label: 'Passed', value: 'Passed'},
  {label: 'Failed', value: 'Failed'},
  {label: 'Blocked', value: 'Blocked'},
  {label: 'Untested', value: 'Untested'},
  {label: 'Retest', value: 'Retest'},
  {label: 'Archived', value: 'Archived'},
  {label: 'Skipped', value: 'Skipped'},
  {label: 'InProgress', value: 'InProgress'},
]

interface AddResultsDialogProps {
  getSelectedRows: () => {testId: number}[]
  runId: number
  onAddResultSubmit?: () => void
  variant?: 'bulkUpdate' | 'detailPageUpdate' | 'runRowUpdate'
  currStatus?: TestStatusType
  currComment?: string | null
  isAddResultEnabled?: boolean
  containerClassName?: string
}

export const AddResultDialog = ({
  getSelectedRows,
  onAddResultSubmit,
  runId,
  variant,
  currStatus,
  currComment,
  isAddResultEnabled = true,
  containerClassName,
}: AddResultsDialogProps) => {
  const updateStatusFetcher = useFetcher<any>()
  const [status, setStatus] = useState(currStatus ?? '')
  const [comment, setComment] = useState(currComment ?? '')
  const [shouldAnimate, setShouldAnimate] = useState(false)
  const [attachments, setAttachments] = useState<string[]>([])
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false)
  const {toast} = useToast()
  const submittedRef = useRef(false)

  // Re-prefill from props each time the dialog opens, so a cancelled edit
  // never leaks a stale draft into the next open, and reopening to amend an
  // existing comment starts from that comment rather than blank. On close
  // without submitting (Cancel, Escape, overlay click), delete any
  // already-uploaded attachments from S3 instead of leaving them orphaned.
  const onDialogOpenChange = (open: boolean) => {
    if (open) {
      setStatus(currStatus ?? '')
      setComment(currComment ?? '')
      setAttachments([])
      submittedRef.current = false
      return
    }

    if (!submittedRef.current) {
      attachments.forEach((key) => {
        fetch(`/${API.DeleteAttachment}`, {
          method: 'DELETE',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({key}),
        }).catch(() => {})
      })
    }
  }

  useEffect(() => {
    if (isAddResultEnabled) {
      setShouldAnimate(true)
      const timer = setTimeout(() => setShouldAnimate(false), 300)
      return () => clearTimeout(timer)
    }
  }, [isAddResultEnabled])

  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setIsUploadingAttachment(true)
    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch(`/${API.UploadAttachment}`, {
        method: 'POST',
        body: formData,
      })
      const result = await response.json()

      if (!response.ok || result?.error) {
        toast({
          variant: 'destructive',
          description: result?.error ?? 'Failed to upload attachment',
        })
        return
      }

      setAttachments((prev) => [...prev, result.data.key])
    } catch (error) {
      toast({
        variant: 'destructive',
        description: 'Failed to upload attachment',
      })
    } finally {
      setIsUploadingAttachment(false)
    }
  }

  const removeAttachment = (index: number) => {
    const key = attachments[index]
    setAttachments((prev) => prev.filter((_, i) => i !== index))
    fetch(`/${API.DeleteAttachment}`, {
      method: 'DELETE',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({key}),
    }).catch(() => {
      // Best-effort cleanup: the attachment is already gone from this draft
      // either way, so a delete failure here shouldn't block the user.
    })
  }

  const onAddResultSubmited = () => {
    submittedRef.current = true
    const selectedRows = getSelectedRows()
    const updatedSelectedRows = selectedRows.map((row) => {
      return {
        testId: Number(row.testId),
        status: status,
        ...(attachments.length ? {attachments} : {}),
      }
    })
    updateStatusFetcher.submit(
      {
        testIdStatusArray: updatedSelectedRows,
        runId: runId,
        comment: comment,
      },
      {
        method: 'PUT',
        action: `/${API.RunUpdateTestStatus}`,
        encType: 'application/json',
      },
    )
    onAddResultSubmit?.()
  }

  const triggerComponent = (variant: AddResultsDialogProps['variant']) => {
    if (variant === 'detailPageUpdate') {
      return currStatus ? (
        <Button
          style={{
            width: 'min-96',
            backgroundColor: getStatusColor(currStatus as TestStatusType),
            fontWeight: 500,
            color: currStatus === TestStatusType.Blocked ? 'white' : 'black',
          }}
        >
          {currStatus}
          <ChevronDown size={22} strokeWidth={2} className="ml-2" />
        </Button>
      ) : null
    }

    if (variant === 'runRowUpdate') {
      return (
        <Button
          style={{
            backgroundColor: getStatusColor(currStatus as TestStatusType),
            fontWeight: 400,
            width: 108,
            color: getStatusTextColor(currStatus as TestStatusType),
          }}
          className="px-2 py-3 h-3"
        >
          {currStatus}
          <ChevronDown size={16} strokeWidth={2} className="ml-2" />
        </Button>
      )
    }

    return (
      <Button
        disabled={!isAddResultEnabled}
        variant={isAddResultEnabled ? 'default' : 'outline'}
        size="default"
        className={cn(
          'shadow-sm',
          shouldAnimate ? 'animate-bounce' : '',
          'transition-all duration-300',
        )}
      >
        Add Result
      </Button>
    )
  }

  if (updateStatusFetcher.state !== 'idle') {
    return <Loader />
  }

  return (
    <CustomDialog
      onOpenChange={onDialogOpenChange}
      anchorComponent={
        <div className={containerClassName}>{triggerComponent(variant)}</div>
      }
      headerComponent={
        <DialogTitle className="text-lg font-semibold text-slate-900">
          Add Test Result
        </DialogTitle>
      }
      contentComponent={
        <div className="pt-2 space-y-5">
          <div className="space-y-2.5">
            <label
              htmlFor="status"
              className="text-sm font-semibold text-slate-700"
            >
              Status <span className="text-red-600">*</span>
            </label>

            <ComboboxDemo
              value={status}
              onChange={(value) => setStatus(value)}
              options={TEST_STATUS_OPTIONS}
            />

            {status === '' && (
              <p className="pt-1 text-xs text-slate-500">
                Please select a test status
              </p>
            )}
          </div>
          <div className="space-y-2.5">
            <label
              htmlFor="comment"
              className="text-sm font-semibold text-slate-700"
            >
              Comment
            </label>
            <Textarea
              id="comment"
              placeholder="Add optional notes about this test result..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="min-h-[100px] resize-none"
            />
            <p className="pt-1 text-xs text-slate-500">
              Optional: Add any relevant notes or observations
            </p>
          </div>
          <div className="space-y-2.5">
            <label
              htmlFor="attachments"
              className="text-sm font-semibold text-slate-700"
            >
              Screenshots
            </label>
            <Input
              id="attachments"
              type="file"
              accept="image/*"
              disabled={isUploadingAttachment}
              onChange={onFileSelected}
            />
            {isUploadingAttachment && (
              <p className="pt-1 text-xs text-slate-500">Uploading...</p>
            )}
            {attachments.length > 0 && (
              <div className="flex gap-2 flex-wrap pt-1">
                {attachments.map((key, index) => (
                  <div key={key} className="relative">
                    <div className="h-14 w-14 rounded border border-slate-200 bg-slate-100 flex items-center justify-center text-xs text-slate-500 truncate px-1">
                      Image {index + 1}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeAttachment(index)}
                      className="absolute -top-1.5 -right-1.5 bg-slate-900 text-white rounded-full p-0.5"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <p className="pt-1 text-xs text-slate-500">
              Optional: Attach one or more screenshots
            </p>
          </div>
        </div>
      }
      footerComponent={
        <updateStatusFetcher.Form method="POST" className="w-full">
          <div className="flex gap-3 pt-2">
            <DialogClose asChild>
              <Button type="button" variant="outline" className="flex-1">
                Cancel
              </Button>
            </DialogClose>
            <DialogClose
              disabled={status === '' || isUploadingAttachment}
              asChild
            >
              <Button
                type="button"
                variant="default"
                onClick={onAddResultSubmited}
                className="flex-1 bg-slate-900 hover:bg-slate-800"
                disabled={
                  updateStatusFetcher.state !== 'idle' ||
                  status === '' ||
                  isUploadingAttachment
                }
              >
                Submit Result
              </Button>
            </DialogClose>
          </div>
        </updateStatusFetcher.Form>
      }
    />
  )
}
