import {API} from '~/routes/utilities/api'
import {TestStatusData} from '@api/testStatus'
import {InputsSpacing} from '@components/Forms/InputsSpacing'
import {useCustomNavigate} from '@hooks/useCustomNavigate'
import {useFetcher, useLoaderData, useParams} from '@remix-run/react'
import {Button} from '@ui/button'
import {cn} from '@ui/utils'
import {useEffect, useState, useCallback} from 'react'
import {AddResultDialog} from '../RunTestList/AddResultDialog'
import {InputLabels} from '../TestList/InputLabels'
import {LinkContent, OptionContent, TextContent} from './Contents'
import {TestStatusHistroyDialog} from './TestStatusHistroyDialog'
import {shortDate2} from '~/utils/getDate'
import {Tooltip} from '@components/Tooltip/Tooltip'
import {IGetAllSectionsResponse} from '@controllers/sections.controller'
import {getSectionHierarchy} from '@components/SectionList/utils'
import {
  MediaUploader,
  MediaGallery,
  AttachmentSection,
  Attachment,
} from '~/components/Attachments'
import {toast} from '@ui/use-toast'

export default function TestDetailsPage({
  pageType,
}: {
  pageType: 'testDetail' | 'runTestDetail'
}) {
  const resp = useLoaderData<{data: any}>()
  const projectId = Number(useParams().projectId)
  const testId = Number(useParams().testId)
  const runId = Number(useParams().runId)

  const testStatusFetcher = useFetcher<any>()
  const testStatusHistoryFetcher = useFetcher<any>()
  const sectionFetcher = useFetcher<{
    data: IGetAllSectionsResponse[]
  }>()
  const attachmentsFetcher = useFetcher<{data: {expected: Attachment[]; actual: Attachment[]}}>()
  const deleteAttachmentFetcher = useFetcher<any>()
  const [sectionsData, setSectionsData] = useState<
    {
      sectionId: number
      sectionName: string
      parentId: number | null
      projectId: number
    }[]
  >([])
  const [expectedAttachments, setExpectedAttachments] = useState<Attachment[]>([])
  const [actualAttachments, setActualAttachments] = useState<Attachment[]>([])

  const data = resp?.data
  const [testStatus, setTestStatus] = useState<TestStatusData>()
  const [testStatusHistory, setTestStatusHistory] = useState()

  const navigate = useCustomNavigate()

  useEffect(() => {
    pageType === 'runTestDetail'
      ? testStatusFetcher.load(
          `/${API.GetRunTestStatus}?projectId=${projectId}&runId=${runId}&testId=${testId}`,
        )
      : null

    testStatusHistoryFetcher.load(
      pageType === 'testDetail'
        ? `/${API.GetTestStatusHistory}?testId=${testId}`
        : `/${API.GetTestStatusHistoryInRun}?runId=${runId}&testId=${testId}`,
    )
    sectionFetcher.load(`/${API.GetSections}?projectId=${projectId}`)
    
    // Load attachments based on page type
    if (pageType === 'runTestDetail') {
      attachmentsFetcher.load(
        `/${API.GetRunAttachments}?projectId=${projectId}&runId=${runId}&testId=${testId}`,
      )
    } else {
      attachmentsFetcher.load(
        `/${API.GetTestAttachments}?projectId=${projectId}&testId=${testId}`,
      )
    }
  }, [projectId, testId, runId])

  useEffect(() => {
    if (testStatusFetcher.data) {
      setTestStatus(testStatusFetcher.data)
    }
  }, [testStatusFetcher.data])

  useEffect(() => {
    if (sectionFetcher.data) {
      setSectionsData(sectionFetcher.data.data)
    }
  }, [sectionFetcher.data])

  // Update attachments when fetcher completes
  useEffect(() => {
    if (attachmentsFetcher.data?.data) {
      if (pageType === 'runTestDetail') {
        // Run test detail returns both expected and actual
        const attachmentsData = attachmentsFetcher.data.data as {expected: Attachment[]; actual: Attachment[]}
        setExpectedAttachments(attachmentsData.expected || [])
        setActualAttachments(attachmentsData.actual || [])
      } else {
        // Test detail returns only expected (as array)
        setExpectedAttachments(attachmentsFetcher.data.data as unknown as Attachment[])
      }
    }
  }, [attachmentsFetcher.data, pageType])

  useEffect(() => {
    if (testStatusHistoryFetcher && testStatusHistoryFetcher.data) {
      setTestStatusHistory(testStatusHistoryFetcher.data)
    }
  }, [testStatusHistoryFetcher.data])

  const handleGoBack = () => {
    navigate(-1)
  }

  const editTestClicked = (
    e: React.MouseEvent<HTMLButtonElement, MouseEvent>,
  ) => {
    navigate(
      `/project/${projectId}/tests/editTest/${testId}`,
      {
        state: {source: 'testDetail'},
      },
      e,
    )
  }

  // Attachment handlers
  const handleActualAttachmentUpload = useCallback(
    (attachment: Attachment) => {
      setActualAttachments((prev) => [...prev, attachment])
      toast({
        variant: 'success',
        description: 'Attachment uploaded successfully',
      })
    },
    [],
  )

  const handleAttachmentUploadError = useCallback((error: string) => {
    toast({
      variant: 'destructive',
      description: error,
    })
  }, [])

  const handleDeleteActualAttachment = useCallback(
    (attachmentId: number) => {
      deleteAttachmentFetcher.submit(
        {attachmentId, projectId},
        {
          method: 'DELETE',
          action: `/${API.DeleteRunAttachment}`,
          encType: 'application/json',
        },
      )
      setActualAttachments((prev) =>
        prev.filter((a) => a.attachmentId !== attachmentId),
      )
      toast({
        variant: 'success',
        description: 'Attachment deleted',
      })
    },
    [projectId],
  )

  return (
    <div className="flex flex-col h-full pt-6">
      {/* Header Section */}
      <div className="pb-6 mb-6 border-b border-slate-200">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold text-slate-900">{data?.title}</h1>
              <span className="px-3 py-1 text-xs font-medium bg-slate-100 text-slate-600 rounded-md">
                ID: {data?.testId}
              </span>
            </div>
            {data?.description && (
              <p className="text-sm text-slate-600 leading-relaxed max-w-4xl">
                {data?.description}
              </p>
            )}
          </div>
          
          <div className="flex items-center gap-3">
            {pageType === 'runTestDetail' ? (
              testStatus?.data?.[0].runStatus === 'Active' ? (
                <AddResultDialog
                  getSelectedRows={() => {
                    return [{testId: testId}]
                  }}
                  runId={runId}
                  variant="detailPageUpdate"
                  currStatus={testStatus?.data?.[0]?.status}
                />
              ) : null
            ) : (
              <Button size="default" onClick={editTestClicked}>Edit Test</Button>
            )}
            {testStatusHistory && (
              <TestStatusHistroyDialog
                data={testStatusHistory}
                pageType={pageType}
              />
            )}
            <Button
              size="default"
              variant="outline"
              onClick={handleGoBack}>
              Go Back
            </Button>
          </div>
        </div>
      </div>

      {/* Content - Scrollable */}
      <div className="flex-1 overflow-y-auto space-y-6 pr-2">
        {/* Basic Info Card */}
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Basic Information</h2>
          <div className="grid grid-cols-4 gap-6">
            <div>
              <InputLabels labelName="Section" />
              <p className="text-sm text-slate-700 mt-1.5">
                {getSectionHierarchy({
                  sectionId: data?.sectionId,
                  sectionsData,
                })}
              </p>
            </div>
            {data?.createdBy && (
              <div>
                <InputLabels labelName="Created By" />
                <Tooltip
                  anchor={
                    <p className="text-sm text-slate-700 mt-1.5 cursor-help">
                      {data?.createdBy}
                    </p>
                  }
                  content={shortDate2(data?.createdOn)}
                />
              </div>
            )}
            {data?.updatedBy && (
              <div>
                <InputLabels labelName="Updated By" />
                <Tooltip
                  anchor={
                    <p className="text-sm text-slate-700 mt-1.5 cursor-help">
                      {data?.updatedBy}
                    </p>
                  }
                  content={shortDate2(data?.updatedOn)}
                />
              </div>
            )}
          </div>
        </div>

        {/* Properties Card */}
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Test Properties</h2>
          <div className="grid grid-cols-3 gap-x-6 gap-y-5">
            <OptionContent data={data?.squad} heading="Squad" />
            <OptionContent
              data={data?.labelNames?.split(',')?.join(', ')}
              heading="Labels"
            />
            <OptionContent data={data?.priority} heading="Priority" />
            <OptionContent
              data={data?.automationStatus}
              heading="Automation Status"
            />
            <OptionContent data={data?.type} heading="Type" />
            <OptionContent data={data?.platform} heading="Platform" />
            <OptionContent data={data?.testCoveredBy} heading="Test Covered By" />
            <LinkContent heading="Jira Ticket" data={data?.jiraTicket} />
            <OptionContent data={data?.defects} heading="Defects" />
            <OptionContent data={data?.automationId} heading="Automation ID" />
          </div>
        </div>

        {/* Test Details Card */}
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Test Details</h2>
          <div className="space-y-5">
            <TextContent data={data?.preConditions} heading="Preconditions" />
            <TextContent data={data?.steps} heading="Steps" />
            <TextContent data={data?.expectedResult} heading="Expected Result" />
            <TextContent
              data={data?.additionalGroups}
              heading="Additional Groups"
            />
          </div>
        </div>

        {/* Expected Behavior Attachments - Always shown */}
        {expectedAttachments.length > 0 && (
          <div className="bg-white rounded-lg border border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              Expected Behavior
            </h2>
            <p className="text-sm text-slate-500 mb-4">
              Screenshots and videos showing the expected behavior for this test.
            </p>
            <MediaGallery
              attachments={expectedAttachments}
              canDelete={false}
              emptyMessage="No expected behavior attachments"
            />
          </div>
        )}

        {/* Actual Behavior Attachments - Only shown in run test detail */}
        {pageType === 'runTestDetail' && (
          <div className="bg-white rounded-lg border border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              Actual Behavior
            </h2>
            <p className="text-sm text-slate-500 mb-4">
              Upload screenshots or videos showing the actual behavior observed during this test run.
            </p>
            
            {/* Show existing actual attachments */}
            {actualAttachments.length > 0 && (
              <div className="mb-4">
                <MediaGallery
                  attachments={actualAttachments}
                  onDelete={handleDeleteActualAttachment}
                  canDelete={testStatus?.data?.[0]?.runStatus === 'Active'}
                  emptyMessage="No actual behavior attachments yet"
                />
              </div>
            )}
            
            {/* Upload component - only if run is active */}
            {testStatus?.data?.[0]?.runStatus === 'Active' && (
              <MediaUploader
                projectId={projectId}
                testId={testId}
                runId={runId}
                attachmentType="actual"
                onUploadComplete={handleActualAttachmentUpload}
                onUploadError={handleAttachmentUploadError}
                currentCount={actualAttachments.length}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
