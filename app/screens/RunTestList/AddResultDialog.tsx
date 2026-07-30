import {API} from '~/routes/utilities/api'
import {TestStatusType} from '@controllers/types'
import {useFetcher} from '@remix-run/react'
import {ChevronDown} from 'lucide-react'
import {useEffect, useState} from 'react'
import {ComboboxDemo} from '~/components/ComboBox/ComboBox'
import {CustomDialog} from '~/components/Dialog/Dialog'
import {Loader} from '~/components/Loader/Loader'
import {Button} from '~/ui/button'
import {DialogClose, DialogTitle} from '~/ui/dialog'
import {Textarea} from '~/ui/textarea'
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
  isAddResultEnabled?: boolean
  containerClassName?: string
}

export const AddResultDialog = ({
  getSelectedRows,
  onAddResultSubmit,
  runId,
  variant,
  currStatus,
  isAddResultEnabled = true,
  containerClassName,
}: AddResultsDialogProps) => {
  const updateStatusFetcher = useFetcher<any>()
  const [status, setStatus] = useState(currStatus ?? '')
  const [comment, setComment] = useState('')
  const [shouldAnimate, setShouldAnimate] = useState(false)

  // Keep status in sync with currStatus so that reopening the dialog to edit
  // an already-submitted result (e.g. to update the comment) prefills the
  // existing status instead of leaving it blank and blocking Submit. Also
  // clear any unsubmitted draft comment so a cancelled edit on one row can't
  // leak into a later submission for another row/reopen.
  useEffect(() => {
    setStatus(currStatus ?? '')
    setComment('')
  }, [currStatus])

  useEffect(() => {
    if (isAddResultEnabled) {
      setShouldAnimate(true)
      const timer = setTimeout(() => setShouldAnimate(false), 300)
      return () => clearTimeout(timer)
    }
  }, [isAddResultEnabled])

  const onAddResultSubmited = () => {
    const selectedRows = getSelectedRows()
    const updatedSelectedRows = selectedRows.map((row) => {
      return {testId: Number(row.testId), status: status}
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
          }}>
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
          className="px-2 py-3 h-3">
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
        )}>
        Add Result
      </Button>
    )
  }

  if (updateStatusFetcher.state !== 'idle') {
    return <Loader />
  }

  return (
    <CustomDialog
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
            <label htmlFor="status" className="text-sm font-semibold text-slate-700">
              Status <span className="text-red-600">*</span>
            </label>
            
            <ComboboxDemo
              value={status}
              onChange={(value) => setStatus(value)}
              options={TEST_STATUS_OPTIONS}
            />
            
            {status === '' && (
              <p className="pt-1 text-xs text-slate-500">Please select a test status</p>
            )}
          </div>
          <div className="space-y-2.5">
            <label htmlFor="comment" className="text-sm font-semibold text-slate-700">
              Comment
            </label>
            <Textarea
              id="comment"
              placeholder="Add optional notes about this test result..."
              onChange={(e) => setComment(e.target.value)}
              className="min-h-[100px] resize-none"
            />
            <p className="pt-1 text-xs text-slate-500">Optional: Add any relevant notes or observations</p>
          </div>
        </div>
      }
      footerComponent={
        <updateStatusFetcher.Form method="POST" className="w-full">
          <div className="flex gap-3 pt-2">
            <DialogClose asChild>
              <Button
                type="button"
                variant="outline"
                className="flex-1">
                Cancel
              </Button>
            </DialogClose>
            <DialogClose disabled={status === ''} asChild>
              <Button
                type="button"
                variant="default"
                onClick={onAddResultSubmited}
                className="flex-1 bg-slate-900 hover:bg-slate-800"
                disabled={updateStatusFetcher.state !== 'idle' || status === ''}>
                Submit Result
              </Button>
            </DialogClose>
          </div>
        </updateStatusFetcher.Form>
      }
    />
  )
}
