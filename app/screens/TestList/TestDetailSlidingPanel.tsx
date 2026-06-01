import {API} from '~/routes/utilities/api'
import {CustomDrawer} from '@components/CustomDrawer'
import {InputsSpacing} from '@components/Forms/InputsSpacing'
import {useCustomNavigate} from '@hooks/useCustomNavigate'
import {Button} from '@ui/button'
import {Skeleton} from '@ui/skeleton'
import {useEffect, useState} from 'react'
import {useFetcher} from 'react-router-dom'
import {LinkContent, OptionContent, TextContent} from '../TestDetail/Contents'
import {InputLabels} from './InputLabels'
import {AddResultDialog} from '../RunTestList/AddResultDialog'
import {TestStatusType} from '@controllers/types'
import {StatusEntry} from '@api/testStatusHistory'
import {TestStatusHistroyDialog} from '../TestDetail/TestStatusHistroyDialog'
import {MediaGallery, Attachment} from '~/components/Attachments'
import {ImageIcon} from 'lucide-react'

export interface TestDetailAPI {
  additionalGroups?: string
  automationId?: string
  automationStatus?: string
  defects?: string
  description?: string
  expectedResult: string
  jiraTicket?: string
  labelNames?: string
  platform: string
  preConditions?: string
  priority: string
  section: string
  sectionHierarchy?: string
  squad?: string
  steps: string
  testCoveredBy?: string
  title: string
  type?: string
  automationStatusName?: string
  testId: number
}

export const TestDetailDrawer = ({
  isOpen,
  onClose,
  props,
  pageType,
  runActive = false,
}: {
  isOpen: boolean
  onClose: () => void
  props: {projectId: number; testId: number; runId?: number}
  pageType: 'testDetail' | 'runTestDetail'
  runActive?: boolean
}) => {
  const testDetailFetcher = useFetcher<{data: TestDetailAPI}>()
  const [data, setData] = useState<TestDetailAPI | null>(null)
  const testStatusHistoryFetcher = useFetcher<any>()
  const [testStatusHistory, setTestStatusHistory] = useState<{
    data: StatusEntry[]
  }>()
  const navigate = useCustomNavigate()

  // Attachment fetchers
  const expectedAttachmentsFetcher = useFetcher<{data: Attachment[]}>()
  const actualAttachmentsFetcher = useFetcher<{data: Attachment[]}>()
  const [expectedAttachments, setExpectedAttachments] = useState<Attachment[]>([])
  const [actualAttachments, setActualAttachments] = useState<Attachment[]>([])

  const testDetailClicked = (
    e: React.MouseEvent<HTMLButtonElement, MouseEvent>,
  ) => {
    if (pageType === 'runTestDetail')
      navigate(
        `/project/${props.projectId}/run/${props.runId}/test/${props.testId}`,
        {},
        e,
      )
    else navigate(`/project/${props.projectId}/tests/${props.testId}`, {}, e)
  }

  useEffect(() => {
    if (isOpen) {
      testDetailFetcher.load(
        `/${API.GetTestDetails}?projectId=${props.projectId}&testId=${props.testId}`,
      )
      
      // Load expected behavior attachments
      expectedAttachmentsFetcher.load(
        `/${API.GetTestAttachments}?projectId=${props.projectId}&testId=${props.testId}`,
      )
      
      if (pageType === 'runTestDetail') {
        testStatusHistoryFetcher.load(
          `/${API.GetTestStatusHistoryInRun}?runId=${props.runId}&testId=${props.testId}`,
        )
        
        // Load actual behavior attachments (run-specific)
        if (props.runId) {
          actualAttachmentsFetcher.load(
            `/${API.GetRunAttachments}?projectId=${props.projectId}&testId=${props.testId}&runId=${props.runId}`,
          )
        }
      }
    }
  }, [isOpen, props.projectId, props.testId, props.runId])

  useEffect(() => {
    if (testDetailFetcher.data?.data) setData(testDetailFetcher.data?.data)
  }, [testDetailFetcher.data])

  useEffect(() => {
    if (testStatusHistoryFetcher && testStatusHistoryFetcher.data) {
      setTestStatusHistory(testStatusHistoryFetcher.data)
    }
  }, [testStatusHistoryFetcher.data])

  // Update attachments when fetchers complete
  useEffect(() => {
    if (expectedAttachmentsFetcher.data?.data) {
      setExpectedAttachments(expectedAttachmentsFetcher.data.data)
    }
  }, [expectedAttachmentsFetcher.data])

  useEffect(() => {
    if (actualAttachmentsFetcher.data?.data) {
      setActualAttachments(actualAttachmentsFetcher.data.data)
    }
  }, [actualAttachmentsFetcher.data])

  // Reset attachments when drawer closes
  useEffect(() => {
    if (!isOpen) {
      setExpectedAttachments([])
      setActualAttachments([])
    }
  }, [isOpen])

  return (
    <CustomDrawer isOpen={isOpen} onClose={onClose}>
      {data ? (
        <div className="h-full flex flex-col bg-slate-50">
          {/* Fixed Header */}
          <div className="flex-shrink-0 px-6 py-5 bg-white border-b border-slate-200">
            <h2 className="text-xl font-bold text-slate-900">{data?.title}</h2>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <div className="space-y-6">
              {/* Description & Basic Info */}
              <div className="bg-white rounded-lg border border-slate-200 p-5">
                {data?.description && (
                  <div className="mb-4">
                    <InputLabels labelName="Description" />
                    <p className="text-sm text-slate-700 mt-1.5">{data?.description}</p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <InputLabels labelName="Test ID" />
                    <p className="text-sm text-slate-700 mt-1.5">{data?.testId}</p>
                  </div>
                  <div>
                    <InputLabels labelName="Section" />
                    <p className="text-sm text-slate-700 mt-1.5">{data?.section}</p>
                  </div>
                </div>
              </div>

              {/* Properties Grid */}
              <div className="bg-white rounded-lg border border-slate-200 p-5">
                <div className="grid grid-cols-2 gap-4">
                  <OptionContent data={data?.squad} heading="Squad" />
                  <OptionContent
                    data={data?.labelNames?.split(',')?.join(', ')}
                    heading="Labels"
                  />
                  <OptionContent data={data?.priority} heading="Priority" />
                  <OptionContent
                    data={data?.automationStatusName}
                    heading="Automation Status"
                  />
                  <OptionContent data={data?.type} heading="Type" />
                  <OptionContent data={data?.platform} heading="Platform" />
                  <OptionContent
                    data={data?.testCoveredBy}
                    heading="Test Covered By"
                  />
                  <LinkContent heading="Jira Ticket" data={data?.jiraTicket} />
                  <OptionContent data={data?.defects} heading="Defects" />
                  <OptionContent data={data?.automationId} heading="Automation ID" />
                </div>
              </div>

              {/* Test Details */}
              <div className="bg-white rounded-lg border border-slate-200 p-5 space-y-4">
                <TextContent data={data?.preConditions} heading="Preconditions" />
                <TextContent data={data?.steps} heading="Steps" />
                <TextContent
                  data={data?.expectedResult}
                  heading="Expected Result"
                />
                <TextContent
                  data={data?.additionalGroups}
                  heading="Additional Groups"
                />
              </div>

              {/* Attachments Section */}
              <div className="bg-white rounded-lg border border-slate-200 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <ImageIcon className="w-4 h-4 text-blue-500" />
                  <h3 className="text-sm font-semibold text-slate-700">
                    {pageType === 'runTestDetail' ? 'Expected Behavior' : 'Attachments'}
                  </h3>
                  {expectedAttachments.length > 0 && (
                    <span className="text-xs text-slate-500">
                      ({expectedAttachments.length} attachment{expectedAttachments.length !== 1 ? 's' : ''})
                    </span>
                  )}
                </div>
                {expectedAttachments.length > 0 ? (
                  <MediaGallery
                    attachments={expectedAttachments}
                    canDelete={false}
                    emptyMessage="No attachments"
                  />
                ) : (
                  <p className="text-sm text-slate-500">
                    No attachments for this test.
                  </p>
                )}
              </div>

              {/* Actual Behavior Attachments (Run-specific) */}
              {pageType === 'runTestDetail' && (
                <div className="bg-white rounded-lg border border-slate-200 p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <ImageIcon className="w-4 h-4 text-green-500" />
                    <h3 className="text-sm font-semibold text-slate-700">
                      Actual Behavior
                    </h3>
                    {actualAttachments.length > 0 && (
                      <span className="text-xs text-slate-500">
                        ({actualAttachments.length} attachment{actualAttachments.length !== 1 ? 's' : ''})
                      </span>
                    )}
                  </div>
                  {actualAttachments.length > 0 ? (
                    <MediaGallery
                      attachments={actualAttachments}
                      canDelete={false}
                      emptyMessage="No attachments"
                    />
                  ) : (
                    <p className="text-sm text-slate-500">
                      No actual behavior attachments uploaded for this run.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Fixed Footer */}
          <div className="flex-shrink-0 px-6 py-4 bg-white border-t border-slate-200">
            <div className="flex items-center justify-end gap-3">
              {pageType === 'runTestDetail' && runActive && testStatusHistory && (
                <AddResultDialog
                  getSelectedRows={() => {
                    return [{testId: props.testId}]
                  }}
                  runId={props?.runId ?? 0}
                  variant="detailPageUpdate"
                  currStatus={
                    (testStatusHistory?.data?.[0]?.status as TestStatusType) ??
                    (TestStatusType.Untested as TestStatusType)
                  }
                />
              )}
              {testStatusHistory && (
                <TestStatusHistroyDialog
                  data={testStatusHistory}
                  pageType={pageType}
                />
              )}
              <Button variant="default" size="default" onClick={testDetailClicked}>
                View Full Details
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="h-full flex flex-col bg-slate-50 p-6 gap-6">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-40 w-full rounded-lg" />
          <Skeleton className="h-40 w-full rounded-lg" />
          <Skeleton className="h-56 w-full rounded-lg" />
          <div className="flex justify-end mt-auto">
            <Skeleton className="h-10 w-32" />
          </div>
        </div>
      )}
    </CustomDrawer>
  )
}
