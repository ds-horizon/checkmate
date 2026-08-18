import {TestStatusType} from '@controllers/types'
import {useFetcher} from '@remix-run/react'
import {ChevronDown, Loader2} from 'lucide-react'
import {useEffect, useId, useRef, useState} from 'react'
import {API} from '~/routes/utilities/api'
import {ComboboxDemo} from '~/components/ComboBox/ComboBox'
import {CustomDialog} from '~/components/Dialog/Dialog'
import {Button} from '~/ui/button'
import {DialogClose, DialogDescription, DialogTitle} from '~/ui/dialog'
import {Textarea} from '~/ui/textarea'
import {useToast} from '~/ui/use-toast'
import {getStatusColor, getStatusTextColor} from '../TestDetail/util'
import {
  getAttachmentFileName,
  getAttachmentKeyFromUrl,
  ResultAttachment,
  ResultAttachmentGallery,
} from './ResultAttachments'
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
  currAttachments?: string[] | null
  isAddResultEnabled?: boolean
  containerClassName?: string
}

interface HistoryResponse {
  data?: Array<{attachments?: string[] | null}>
  error?: string | null
}

const createExistingAttachment = (url: string, index: number): ResultAttachment => ({
  id: `existing-${index}-${url}`,
  url,
  fileName: getAttachmentFileName(url) || `Screenshot ${index + 1}`,
  key: getAttachmentKeyFromUrl(url),
  isExisting: true,
  status: 'ready',
})

export const AddResultDialog = ({
  getSelectedRows,
  onAddResultSubmit,
  runId,
  variant,
  currStatus,
  currComment,
  currAttachments,
  isAddResultEnabled = true,
  containerClassName,
}: AddResultsDialogProps) => {
  const updateStatusFetcher = useFetcher<any>()
  const [status, setStatus] = useState(currStatus ?? '')
  const [comment, setComment] = useState(currComment ?? '')
  const [shouldAnimate, setShouldAnimate] = useState(false)
  const [attachments, setAttachments] = useState<ResultAttachment[]>([])
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false)
  const [isLoadingExistingAttachments, setIsLoadingExistingAttachments] =
    useState(false)
  const [isAttachmentHistoryPending, setIsAttachmentHistoryPending] =
    useState(false)
  const [attachmentLoadError, setAttachmentLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [removedExistingKeys, setRemovedExistingKeys] = useState<string[]>([])
  const {toast} = useToast()
  const sessionIdRef = useRef(0)
  const isDialogOpenRef = useRef(false)
  const attachmentHistoryPendingRef = useRef(false)
  const activeUploadIdsRef = useRef(new Set<string>())
  const cancelledUploadIdsRef = useRef(new Set<string>())
  const saveRequestedRef = useRef(false)
  const previousFetcherStateRef = useRef(updateStatusFetcher.state)
  const committedRef = useRef(false)
  const fieldId = useId().replace(/:/g, '')

  const isEditing = variant === 'detailPageUpdate' || variant === 'runRowUpdate'
  const isCommentRemovalBlocked =
    isEditing && Boolean(currComment?.trim()) && comment.trim() === ''

  const revokeDraftPreviewUrls = (draftAttachments: ResultAttachment[]) => {
    draftAttachments.forEach((attachment) => {
      if (!attachment.isExisting && attachment.url.startsWith('blob:')) {
        URL.revokeObjectURL(attachment.url)
      }
    })
  }

  const cleanupDraftAttachments = (draftAttachments: ResultAttachment[]) => {
    draftAttachments.forEach((attachment) => {
      if (!attachment.isExisting && attachment.key) {
        fetch(`/${API.DeleteAttachment}`, {
          method: 'DELETE',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({key: attachment.key}),
        }).catch(() => {})
      }
    })
    revokeDraftPreviewUrls(draftAttachments)
  }

  const setInitialAttachments = (urls: string[]) => {
    setAttachments(urls.map(createExistingAttachment))
  }

  const loadExistingAttachments = async () => {
    const selectedRows = getSelectedRows()
    if (selectedRows.length !== 1 || variant === 'bulkUpdate') return

    attachmentHistoryPendingRef.current = true
    setIsAttachmentHistoryPending(true)
    setIsLoadingExistingAttachments(true)
    setAttachmentLoadError(null)
    const sessionId = sessionIdRef.current
    try {
      const response = await fetch(
        `/${API.GetTestStatusHistoryInRun}?runId=${runId}&testId=${selectedRows[0].testId}`,
      )
      const result = (await response.json()) as HistoryResponse
      if (!response.ok || result.error) {
        throw new Error(result.error ?? 'Unable to load existing screenshots')
      }
      if (sessionId !== sessionIdRef.current || !isDialogOpenRef.current) return
      setInitialAttachments(result.data?.[0]?.attachments ?? [])
      attachmentHistoryPendingRef.current = false
      setIsAttachmentHistoryPending(false)
    } catch (error: any) {
      if (sessionId !== sessionIdRef.current || !isDialogOpenRef.current) return
      setAttachmentLoadError(error?.message ?? 'Unable to load existing screenshots')
    } finally {
      if (sessionId === sessionIdRef.current) setIsLoadingExistingAttachments(false)
    }
  }

  const onDialogOpenChange = (open: boolean) => {
    setIsDialogOpen(open)
    isDialogOpenRef.current = open
    if (open) {
      sessionIdRef.current += 1
      activeUploadIdsRef.current.clear()
      cancelledUploadIdsRef.current = new Set()
      saveRequestedRef.current = false
      committedRef.current = false
      const shouldLoadExistingAttachments = isEditing && currAttachments === undefined
      attachmentHistoryPendingRef.current = shouldLoadExistingAttachments
      setIsAttachmentHistoryPending(shouldLoadExistingAttachments)
      setIsUploadingAttachment(false)
      setIsSaving(false)
      setSaveError(null)
      setAttachmentLoadError(null)
      setRemovedExistingKeys([])
      setStatus(currStatus ?? '')
      setComment(currComment ?? '')
      setInitialAttachments(currAttachments ?? [])
      if (shouldLoadExistingAttachments) void loadExistingAttachments()
      return
    }

    attachmentHistoryPendingRef.current = false
    setIsAttachmentHistoryPending(false)
    cancelledUploadIdsRef.current = new Set(
      attachments.filter((attachment) => !attachment.isExisting).map((attachment) => attachment.id),
    )
    activeUploadIdsRef.current.clear()
    setIsUploadingAttachment(false)
    if (!committedRef.current) cleanupDraftAttachments(attachments)
    setAttachments([])
  }

  useEffect(() => {
    if (isAddResultEnabled) {
      setShouldAnimate(true)
      const timer = setTimeout(() => setShouldAnimate(false), 300)
      return () => clearTimeout(timer)
    }
  }, [isAddResultEnabled])

  useEffect(() => {
    const previousState = previousFetcherStateRef.current
    previousFetcherStateRef.current = updateStatusFetcher.state
    if (
      !saveRequestedRef.current ||
      previousState === 'idle' ||
      updateStatusFetcher.state !== 'idle'
    ) {
      return
    }

    const result = updateStatusFetcher.data
    const failedCount = result?.data?.failed?.count ?? 0
    if (result?.error || result?.status >= 400 || failedCount > 0) {
      const message =
        result?.error ??
        result?.data?.failed?.message ??
        'The result could not be saved. Check the run and try again.'
      setSaveError(message)
      setIsSaving(false)
      saveRequestedRef.current = false
      return
    }

    removedExistingKeys.forEach((key) => {
      fetch(`/${API.DeleteAttachment}`, {
        method: 'DELETE',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({key}),
      }).catch(() => {})
    })
    committedRef.current = true
    revokeDraftPreviewUrls(attachments)
    setAttachments([])
    saveRequestedRef.current = false
    setIsSaving(false)
    setIsDialogOpen(false)
    isDialogOpenRef.current = false
    onAddResultSubmit?.()
  }, [attachments, removedExistingKeys, updateStatusFetcher.data, updateStatusFetcher.state, onAddResultSubmit])

  const uploadFile = async (file: File) => {
    const sessionId = sessionIdRef.current
    const attachmentId = `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const previewUrl = URL.createObjectURL(file)
    cancelledUploadIdsRef.current.delete(attachmentId)
    setAttachments((prev) => [
      ...prev,
      {
        id: attachmentId,
        url: previewUrl,
        fileName: file.name,
        status: 'loading',
      },
    ])
    activeUploadIdsRef.current.add(attachmentId)
    setIsUploadingAttachment(true)

    const isUploadStale = () =>
      sessionId !== sessionIdRef.current ||
      !isDialogOpenRef.current ||
      cancelledUploadIdsRef.current.has(attachmentId)

    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch(`/${API.UploadAttachment}`, {
        method: 'POST',
        body: formData,
      })
      const result = await response.json()
      if (!response.ok || result?.error) {
        throw new Error(result?.error ?? 'Failed to upload screenshot')
      }

      const key = result.data.key
      if (isUploadStale()) {
        fetch(`/${API.DeleteAttachment}`, {
          method: 'DELETE',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({key}),
        }).catch(() => {})
        return
      }

      setAttachments((prev) =>
        prev.map((attachment) =>
          attachment.id === attachmentId
            ? {...attachment, key, status: 'ready'}
            : attachment,
        ),
      )
    } catch (error: any) {
      if (!isUploadStale()) {
        setAttachments((prev) =>
          prev.map((attachment) =>
            attachment.id === attachmentId
              ? {
                  ...attachment,
                  status: 'error',
                  error: error?.message ?? 'Failed to upload screenshot',
                }
              : attachment,
          ),
        )
      }
    } finally {
      if (activeUploadIdsRef.current.delete(attachmentId)) {
        setIsUploadingAttachment(activeUploadIdsRef.current.size > 0)
      }
    }
  }

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (attachmentHistoryPendingRef.current) return
    files.forEach((file) => void uploadFile(file))
  }

  useEffect(() => {
    if (!isDialogOpen) return

    const onPaste = (event: ClipboardEvent) => {
      if (attachmentHistoryPendingRef.current) return
      const images = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.type.startsWith('image/'))
        .map((item, index) => {
          const blob = item.getAsFile()
          return blob
            ? new File([blob], `pasted-image-${Date.now()}-${index}.png`, {
                type: item.type,
              })
            : null
        })
        .filter((file): file is File => file !== null)

      if (images.length === 0) return
      event.preventDefault()
      images.forEach((file) => void uploadFile(file))
    }

    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [isDialogOpen])

  const removeAttachment = (attachment: ResultAttachment) => {
    cancelledUploadIdsRef.current.add(attachment.id)
    if (activeUploadIdsRef.current.delete(attachment.id)) {
      setIsUploadingAttachment(activeUploadIdsRef.current.size > 0)
    }
    setAttachments((prev) => prev.filter((item) => item.id !== attachment.id))
    if (attachment.url.startsWith('blob:')) URL.revokeObjectURL(attachment.url)

    if (attachment.isExisting && attachment.key) {
      setRemovedExistingKeys((prev) =>
        prev.includes(attachment.key as string)
          ? prev
          : [...prev, attachment.key as string],
      )
      return
    }

    if (attachment.key) {
      fetch(`/${API.DeleteAttachment}`, {
        method: 'DELETE',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({key: attachment.key}),
      }).catch(() => {})
    }
  }

  const onAddResultSubmitted = () => {
    if (attachmentLoadError) {
      setSaveError(
        'Existing screenshots could not be loaded. Retry before saving so they are not removed.',
      )
      return
    }

    if (isCommentRemovalBlocked) {
      setSaveError('Existing comments can be changed, but not removed yet. Keep a value to save.')
      return
    }

    if (
      !status ||
      isUploadingAttachment ||
      isAttachmentHistoryPending ||
      isLoadingExistingAttachments ||
      attachments.some((attachment) => attachment.status !== 'ready')
    ) {
      return
    }

    const invalidExistingAttachment = attachments.find(
      (attachment) => attachment.isExisting && !attachment.key,
    )
    if (invalidExistingAttachment) {
      setSaveError(
        'One existing screenshot cannot be retained because its file key is unavailable. Remove it or refresh and try again.',
      )
      return
    }

    const selectedRows = getSelectedRows()
    const attachmentKeys = attachments
      .map((attachment) => attachment.key)
      .filter((key): key is string => Boolean(key))
    const updatedSelectedRows = selectedRows.map((row) => ({
      testId: Number(row.testId),
      status,
      comment,
      attachments: attachmentKeys,
    }))

    setSaveError(null)
    setIsSaving(true)
    saveRequestedRef.current = true
    updateStatusFetcher.submit(
      {
        testIdStatusArray: updatedSelectedRows,
        runId,
        comment,
      },
      {
        method: 'PUT',
        action: `/${API.RunUpdateTestStatus}`,
        encType: 'application/json',
      },
    )
  }

  const triggerComponent = (triggerVariant: AddResultsDialogProps['variant']) => {
    if (triggerVariant === 'detailPageUpdate') {
      return currStatus ? (
        <Button
          type="button"
          aria-label={`Edit result, current status ${currStatus}`}
          style={{
            backgroundColor: getStatusColor(currStatus as TestStatusType),
            fontWeight: 500,
            color: currStatus === TestStatusType.Blocked ? 'white' : 'black',
          }}
        >
          {currStatus}
          <ChevronDown size={22} strokeWidth={2} className="ml-2" aria-hidden="true" />
        </Button>
      ) : null
    }

    if (triggerVariant === 'runRowUpdate') {
      return (
        <Button
          type="button"
          aria-label={`Edit result, current status ${currStatus ?? 'not set'}`}
          style={{
            backgroundColor: getStatusColor(currStatus as TestStatusType),
            fontWeight: 400,
            color: getStatusTextColor(currStatus as TestStatusType),
          }}
          className="h-8 gap-1.5 px-2.5 text-xs"
        >
          <span>{currStatus}</span>
          <span className="border-l border-current/30 pl-1.5">Edit</span>
          <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
        </Button>
      )
    }

    return (
      <Button
        type="button"
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

  return (
    <CustomDialog
      open={isDialogOpen}
      onOpenChange={onDialogOpenChange}
      anchorComponent={
        <div className={containerClassName}>{triggerComponent(variant)}</div>
      }
      headerComponent={
        <div>
          <DialogTitle className="text-lg font-semibold text-slate-900">
            {isEditing ? 'Edit Test Result' : 'Add Test Result'}
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm text-slate-500">
            Update the status, result note, and supporting screenshots.
          </DialogDescription>
        </div>
      }
      contentClassName="max-h-[82vh] overflow-y-auto sm:max-w-[560px]"
      contentComponent={
        <div className="space-y-5 pt-2" aria-busy={isSaving || isUploadingAttachment}>
          <div className="space-y-2.5">
            <label
              id={`${fieldId}-status-label`}
              htmlFor={`${fieldId}-status`}
              className="text-sm font-semibold text-slate-700"
            >
              Status <span className="text-red-600">*</span>
            </label>
            <ComboboxDemo
              id={`${fieldId}-status`}
              aria-labelledby={`${fieldId}-status-label`}
              value={status}
              onChange={(value) => setStatus(value)}
              options={TEST_STATUS_OPTIONS}
            />
            {status === '' && (
              <p className="pt-1 text-xs text-slate-500">Please select a test status</p>
            )}
          </div>

          <div className="space-y-2.5">
            <label htmlFor={`${fieldId}-comment`} className="text-sm font-semibold text-slate-700">
              Comment
            </label>
            <Textarea
              id={`${fieldId}-comment`}
              placeholder="Add optional notes about this test result..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              aria-describedby={`${fieldId}-comment-hint${
                isCommentRemovalBlocked ? ` ${fieldId}-comment-removal-hint` : ''
              }`}
              className="min-h-[160px] resize-y leading-relaxed"
            />
            <p id={`${fieldId}-comment-hint`} className="pt-1 text-xs text-slate-500">
              Optional. Long notes in English or Japanese will wrap automatically.
            </p>
            {isCommentRemovalBlocked && (
              <p
                id={`${fieldId}-comment-removal-hint`}
                className="text-sm text-amber-700"
                role="alert"
              >
                Existing comments can be changed, but not removed yet. Keep a value to save.
              </p>
            )}
          </div>

          <div className="space-y-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor={`${fieldId}-attachments`} className="text-sm font-semibold text-slate-700">
                Screenshots
              </label>
              <span className="text-xs text-slate-500">PNG, JPG, GIF, or WebP · up to 10MB</span>
            </div>
            <input
              id={`${fieldId}-attachments`}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              disabled={
                isSaving || isAttachmentHistoryPending || isLoadingExistingAttachments
              }
              onChange={onFileSelected}
              aria-describedby={`${fieldId}-attachments-hint`}
              className="flex min-h-10 w-full cursor-pointer rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
            />
            {isLoadingExistingAttachments && (
              <p className="flex items-center gap-1.5 text-xs text-slate-500" role="status">
                <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                Loading existing screenshots...
              </p>
            )}
            {attachmentLoadError && (
              <div
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                role="alert"
              >
                <span>{attachmentLoadError}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void loadExistingAttachments()}
                  disabled={isLoadingExistingAttachments || isSaving}
                  className="border-red-300 bg-white text-red-800 hover:bg-red-100 hover:text-red-900"
                >
                  Retry
                </Button>
              </div>
            )}
            <ResultAttachmentGallery
              attachments={attachments}
              onRemove={removeAttachment}
              emptyLabel="No screenshots attached yet"
              labelledBy={`${fieldId}-attachments`}
            />
            <p id={`${fieldId}-attachments-hint`} className="pt-1 text-xs text-slate-500">
              {isAttachmentHistoryPending
                ? attachmentLoadError
                  ? 'Retry existing screenshots before adding new files.'
                  : 'Loading existing screenshots. File selection and paste will be available when loading finishes.'
                : 'Select one or more images, or paste an image with Cmd/Ctrl+V. Remove files before saving.'}
            </p>
          </div>

          {saveError && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
              {saveError}
            </p>
          )}
        </div>
      }
      footerComponent={
        <div className="flex w-full flex-col-reverse gap-3 pt-2 sm:flex-row">
          <DialogClose asChild>
            <Button type="button" variant="outline" className="flex-1" disabled={isSaving}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="default"
            onClick={onAddResultSubmitted}
            className="flex-1 bg-slate-900 hover:bg-slate-800"
            disabled={
              !isAddResultEnabled ||
              isSaving ||
              status === '' ||
              Boolean(attachmentLoadError) ||
              isCommentRemovalBlocked ||
              isUploadingAttachment ||
              isAttachmentHistoryPending ||
              isLoadingExistingAttachments ||
              attachments.some((attachment) => attachment.status !== 'ready')
            }
          >
            {isSaving ? (
              <>
                <Loader2 size={16} className="mr-2 animate-spin" aria-hidden="true" />
                Saving...
              </>
            ) : isEditing ? (
              'Save result'
            ) : (
              'Submit result'
            )}
          </Button>
        </div>
      }
    />
  )
}
