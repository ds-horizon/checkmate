import {TestDetailsResponse} from '@api/testDetails'
import {InputsSpacing} from '@components/Forms/InputsSpacing'
import {IGetAllSectionsResponse} from '@controllers/sections.controller'
import {useCustomNavigate} from '@hooks/useCustomNavigate'
import {useFetcher, useParams} from '@remix-run/react'
import {Button} from '@ui/button'
import {toast} from '@ui/use-toast'
import {cn} from '@ui/utils'
import {useCallback, useEffect, useState} from 'react'
import {API} from '~/routes/utilities/api'
import {
  ORG_ID,
  LARGE_PAGE_SIZE as PAGE_SIZE,
} from '~/routes/utilities/constants'
import {
  AutomationStatus,
  Lables,
  Platforms,
  Priority,
  TestCoveredBy,
  Type,
} from '~/screens/CreateRun/CreateRunFilter'
import {Squad} from '~/screens/RunTestList/interfaces'
import {
  OptionsInputComponent,
  ShortTextInputComponent,
  TextInputComponent,
} from './EditTestComponents'
import {AddTestLabels, labelToFormFieldMapping, TestFormData} from './interface'
import {
  isMandatory,
  sectionListPlaceholder,
  squadListPlaceholder,
} from './utils'
import {getSectionHierarchy} from '@components/SectionList/utils'
import {
  MediaUploader,
  MediaGallery,
  AttachmentSection,
  Attachment,
} from '~/components/Attachments'

export default function EditTestPage({
  source,
}: {
  source: 'testDetail' | 'testList' | 'addTest'
}) {
  const projectId = Number(useParams().projectId)
  const testId = Number(useParams().testId)
  const squadsFetcher = useFetcher<{data: Squad[]}>()
  const labelsFetcher = useFetcher<{data: Lables[]}>()
  const sectionFetcher = useFetcher<{data: IGetAllSectionsResponse[]}>()
  const priorityFetcher = useFetcher<{data: Priority[]}>()
  const automationStatusFetcher = useFetcher<{data: AutomationStatus[]}>()
  const typeFetcher = useFetcher<{data: Type[]}>()
  const platformFetcher = useFetcher<{data: Platforms[]}>()
  const testCoveredByFetcher = useFetcher<{data: TestCoveredBy[]}>()
  const testDetailsFetcher = useFetcher<{data: TestDetailsResponse}>()
  const [isAddAndNext, setIsAddAndNext] = useState(false)
  const orgId = ORG_ID
  const navigate = useCustomNavigate()

  useEffect(() => {
    squadsFetcher.load(`/${API.GetSquads}?projectId=${projectId}`)
    labelsFetcher.load(`/${API.GetLabels}?projectId=${projectId}`)
    sectionFetcher.load(`/${API.GetSections}?projectId=${projectId}`)
  }, [projectId])

  useEffect(() => {
    priorityFetcher.load(`/${API.GetPriority}?orgId=${orgId}`)
    automationStatusFetcher.load(`/${API.GetAutomationStatus}?orgId=${orgId}`)
    typeFetcher.load(`/${API.GetType}?orgId=${orgId}`)
    platformFetcher.load(`/${API.GetPlatforms}?orgId=${orgId}`)
    testCoveredByFetcher.load(`/${API.GetTestCoveredBy}?orgId=${orgId}`)
  }, [orgId])

  const testUpdationFetcher = useFetcher<any>()
  const addTestFetcher = useFetcher<any>()
  const attachmentsFetcher = useFetcher<{data: Attachment[]}>()
  const deleteAttachmentFetcher = useFetcher<any>()
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [pendingDeletions, setPendingDeletions] = useState<Set<number>>(new Set())

  useEffect(() => {
    if (source !== 'addTest') {
      testDetailsFetcher.load(
        `/${API.GetTestDetails}?projectId=${projectId}&testId=${testId}`,
      )
      // Load attachments for existing test
      attachmentsFetcher.load(
        `/${API.GetTestAttachments}?projectId=${projectId}&testId=${testId}`,
      )
    }
  }, [projectId, testId])

  // Update attachments when fetcher completes
  useEffect(() => {
    if (attachmentsFetcher.data?.data) {
      setAttachments(attachmentsFetcher.data.data)
    }
  }, [attachmentsFetcher.data])

  const [formData, setFormData] = useState<TestFormData>(
    source === 'addTest'
      ? {
          title: '',
          sectionId: 0,
          priorityId: 3,
          automationStatusId: 3,
          labelIds: [],
          platformId: 1,
          testCoveredById: 1,
        }
      : {
          title: '',
          sectionId: 0,
          priorityId: 0,
          automationStatusId: 0,
          labelIds: [],
          platformId: 0,
          testCoveredById: 0,
        },
  )

  useEffect(() => {
    if (testDetailsFetcher.data) {
      console.log('testDetailsFetcher.data', testDetailsFetcher.data)

      const sectionId = formData.sectionId
        ? formData.sectionId
        : sectionFetcher.data?.data?.find((section) => {
            return (
              section.sectionName === testDetailsFetcher.data?.data.section &&
              section.sectionId === testDetailsFetcher.data?.data.sectionId &&
              section.parentId ===
                testDetailsFetcher.data?.data.sectionParentId &&
              section.projectId === projectId
            )
          })?.sectionId || 0

      const squadId = formData.squadId
        ? formData.squadId
        : squadsFetcher.data?.data?.find((squad) => {
            return squad.squadName === testDetailsFetcher.data?.data.squad
          })?.squadId ?? null

      const priorityId = formData.priorityId
        ? formData.priorityId
        : priorityFetcher.data?.data?.find(
            (priority) =>
              priority.priorityName === testDetailsFetcher.data?.data.priority,
          )?.priorityId ?? 0

      const automationStatusId = formData.automationStatusId
        ? formData.automationStatusId
        : automationStatusFetcher.data?.data?.find(
            (automationStatus) =>
              automationStatus.automationStatusName ===
              testDetailsFetcher.data?.data.automationStatus,
          )?.automationStatusId || null

      const platformId = formData.platformId
        ? formData.platformId
        : platformFetcher.data?.data?.find(
            (platform) =>
              platform.platformName === testDetailsFetcher.data?.data.platform,
          )?.platformId ?? 0

      const testCoveredById = formData.testCoveredById
        ? formData.testCoveredById
        : testCoveredByFetcher.data?.data?.find(
            (testCoveredBy) =>
              testCoveredBy.testCoveredByName ===
              testDetailsFetcher.data?.data.testCoveredBy,
          )?.testCoveredById ?? null

      const labelNameArray =
        testDetailsFetcher.data?.data.labelNames?.split(',')

      const labelIdArray =
        formData.labelIds && formData.labelIds.length > 0
          ? formData.labelIds
          : labelsFetcher.data?.data
          ? labelsFetcher.data.data
              .filter((label) => labelNameArray?.includes(label.labelName))
              .map((label) => label.labelId)
          : []

      const typeId = formData.typeId
        ? formData.typeId
        : typeFetcher.data?.data?.find(
            (type) => type.typeName === testDetailsFetcher.data?.data.type,
          )?.typeId ?? null

      setFormData({
        title: formData.title
          ? formData.title
          : testDetailsFetcher.data?.data?.title ?? '',
        preConditions: formData.preConditions
          ? formData.preConditions
          : testDetailsFetcher.data?.data?.preConditions ?? null,
        steps: formData.steps
          ? formData.steps
          : testDetailsFetcher.data?.data?.steps ?? null,
        expectedResult: formData.expectedResult
          ? formData.expectedResult
          : testDetailsFetcher.data?.data?.expectedResult ?? null,
        jiraTicket: formData.jiraTicket
          ? formData.jiraTicket
          : testDetailsFetcher.data?.data?.jiraTicket ?? null,
        defects: formData.defects
          ? formData.defects
          : testDetailsFetcher.data?.data?.defects ?? null,
        additionalGroups: formData.additionalGroups
          ? formData.additionalGroups
          : testDetailsFetcher.data?.data?.additionalGroups ?? null,
        automationId: formData.automationId
          ? formData.automationId
          : testDetailsFetcher.data?.data?.automationId ?? null,
        description: formData.description
          ? formData.description
          : testDetailsFetcher.data?.data?.description ?? null,
        sectionId,
        squadId,
        priorityId,
        automationStatusId,
        typeId,
        platformId,
        testCoveredById,
        labelIds: labelIdArray,
      })
    }
  }, [
    labelsFetcher.data,
    testCoveredByFetcher.data,
    platformFetcher.data,
    typeFetcher.data,
    automationStatusFetcher.data,
    priorityFetcher.data,
    squadsFetcher.data,
    testDetailsFetcher.data,
    sectionFetcher.data,
  ])

  const handleChange = useCallback(
    (e: any) => {
      const formField = labelToFormFieldMapping[e.target.id as AddTestLabels]
      if (formField) {
        setFormData((prevFormData) => ({
          ...prevFormData,
          [formField]: e.target.value,
        }))
      }
    },
    [setFormData],
  )

  const handleEditSubmit = useCallback(async () => {
    // First, delete all pending attachments
    if (pendingDeletions.size > 0) {
      for (const attachmentId of pendingDeletions) {
        deleteAttachmentFetcher.submit(
          {attachmentId, projectId},
          {
            method: 'DELETE',
            action: `/${API.DeleteTestAttachment}`,
            encType: 'application/json',
          },
        )
      }
      // Clear pending deletions and update attachments state
      setAttachments((prev) =>
        prev.filter((a) => !pendingDeletions.has(a.attachmentId)),
      )
      setPendingDeletions(new Set())
    }

    // Then submit the form update
    testUpdationFetcher.submit(
      {...formData, projectId, testId},
      {
        method: 'put',
        action: `/${API.EditTest}`,
        encType: 'application/json',
      },
    )
  }, [formData, projectId, testId, pendingDeletions])

  const handleAddSubmit = useCallback(
    (addAndNext = false) => {
      addTestFetcher.submit(
        {...formData, projectId},
        {
          method: 'post',
          action: `/${API.AddTest}`,
          encType: 'application/json',
        },
      )
      setIsAddAndNext(addAndNext)
    },
    [formData, projectId],
  )

  useEffect(() => {
    if (addTestFetcher.data) {
      const data = addTestFetcher.data

      if (data.error) {
        toast({
          variant: 'destructive',
          description: data?.error ?? 'Something went wrong',
        })
      } else if (data.data) {
        if (isAddAndNext) {
          toast({
            variant: 'success',
            description: 'Testcase added, please add new one.',
          })

          setFormData((prevFormData) => ({
            ...prevFormData,
            title: '',
            labelIds: [],
            jiraTicket: '',
            defects: '',
            preConditions: '',
            steps: '',
            expectedResult: '',
          }))
        } else {
          navigate(`/project/${projectId}/tests?page=1&pageSize=${PAGE_SIZE}`, {
            replace: true,
            state: {data: data?.data ?? {}, isCreateTestPage: true},
          })
        }
      }
    }
  }, [addTestFetcher.state])

  useEffect(() => {
    if (testUpdationFetcher.data) {
      const data = testUpdationFetcher.data

      if (data.error) {
        toast({
          variant: 'destructive',
          description: data?.error ?? 'Something went wrong',
        })
      } else {
        if (source === 'testList')
          navigate(`/project/${projectId}/tests?page=1&pageSize=${PAGE_SIZE}`, {
            replace: true,
            state: {data: data?.data ?? {}, isEditTestPage: true},
          })
        else {
          navigate(`/project/${projectId}/tests/${testId}`, {
            replace: true,
            state: {data: data?.data ?? {}, isEditTestPage: true},
          })
        }
      }
    }
  }, [testUpdationFetcher.state])

  const handleGoBack = useCallback(() => {
    navigate(-1)
  }, [])

  // Attachment handlers
  const handleAttachmentUploadComplete = useCallback((attachment: Attachment) => {
    setAttachments((prev) => [...prev, attachment])
    toast({
      variant: 'success',
      description: 'Attachment uploaded successfully',
    })
  }, [])

  const handleAttachmentUploadError = useCallback((error: string) => {
    toast({
      variant: 'destructive',
      description: error,
    })
  }, [])

  // Soft delete - mark attachment for deletion (will be deleted on save)
  const handleDeleteAttachment = useCallback(
    (attachmentId: number) => {
      setPendingDeletions((prev) => new Set([...prev, attachmentId]))
      toast({
        description: 'Attachment marked for deletion. Click "Update Test" to confirm.',
      })
    },
    [],
  )

  // Undo soft delete - restore an attachment
  const handleUndoDelete = useCallback(
    (attachmentId: number) => {
      setPendingDeletions((prev) => {
        const newSet = new Set(prev)
        newSet.delete(attachmentId)
        return newSet
      })
      toast({
        description: 'Attachment restored',
      })
    },
    [],
  )

  return (
    <div className="flex flex-col h-full pt-6">
      {/* Header Section */}
      <div className="pb-6 mb-6 border-b border-slate-200">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">
              {source === 'addTest' ? 'Create Test Case' : 'Edit Test Case'}
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              {source === 'addTest'
                ? 'Fill in the details below to create a new test case'
                : 'Update the test case details below'}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Unsaved changes indicator */}
            {pendingDeletions.size > 0 && (
              <span className="text-sm text-amber-600 bg-amber-50 px-3 py-1 rounded-full border border-amber-200">
                {pendingDeletions.size} unsaved change{pendingDeletions.size !== 1 ? 's' : ''}
              </span>
            )}
            
            {source === 'addTest' ? (
              <>
                <Button
                  size="default"
                  variant="outline"
                  onClick={() => handleAddSubmit(true)}>
                  Add & Create Another
                </Button>
                <Button size="default" onClick={() => handleAddSubmit(false)}>
                  Create Test Case
                </Button>
              </>
            ) : (
              <Button size="default" onClick={() => handleEditSubmit()}>
                Update Test
              </Button>
            )}
            <Button size="default" variant="outline" onClick={handleGoBack}>
              Cancel
            </Button>
          </div>
        </div>
      </div>

      {/* Content - Scrollable */}
      <div className="flex-1 overflow-y-auto space-y-6 pr-2">
        {/* Basic Information Card */}
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-5">
            Basic Information
          </h2>
          <div className="space-y-5">
            <ShortTextInputComponent
              labelName={AddTestLabels.Title}
              value={formData.title}
              onChange={handleChange}
              id={AddTestLabels.Title}
              isMandatory={isMandatory(AddTestLabels.Title)}
            />
            <ShortTextInputComponent
              labelName={AddTestLabels.Description}
              id={AddTestLabels.Description}
              value={formData?.description ?? ''}
              onChange={handleChange}
            />
          </div>
        </div>

        {/* Test Properties Card */}
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-5">
            Test Properties
          </h2>
          <div className="grid grid-cols-3 gap-x-6 gap-y-5">
            {sectionFetcher.data?.data && (
              <OptionsInputComponent
                labelName={AddTestLabels.Section}
                isMandatory={isMandatory('Section')}
                placeholder={sectionListPlaceholder({
                  sectionId: formData.sectionId,
                  sectionData: sectionFetcher.data,
                  newProperty: formData.new_section,
                })}
                selectedItemId={formData.sectionId}
                key={AddTestLabels.Section}
                list={
                  sectionFetcher.data?.data
                    ? sectionFetcher.data?.data
                        ?.map((section) => {
                          return {
                            id: section.sectionId,
                            property: section.sectionName,
                            name: getSectionHierarchy({
                              sectionId: section.sectionId,
                              sectionsData: sectionFetcher.data?.data,
                            }),
                          }
                        })
                        ?.sort((a, b) =>
                          a.name.localeCompare(b.name, undefined, {
                            sensitivity: 'base',
                          }),
                        )
                    : []
                }
                handleCheckboxChange={(param) => {
                  setFormData({
                    ...formData,
                    sectionId: param.id,
                    new_section: undefined,
                  })
                }}
                createNewPropertyClicked={(section: string) => {
                  setFormData({...formData, sectionId: 0, new_section: section})
                }}
                createNewToolTipString={`Select to create new section, use ' > ' for nested section`}
                addingNewValue={formData.new_section}
              />
            )}

            {squadsFetcher.data?.data && (
              <OptionsInputComponent
                labelName={AddTestLabels.Squad}
                placeholder={squadListPlaceholder({
                  squadId: formData.squadId,
                  squadData: squadsFetcher.data,
                  newProperty: formData.new_squad,
                })}
                key={AddTestLabels.Squad}
                list={squadsFetcher.data?.data?.map((squad) => {
                  return {
                    id: squad.squadId,
                    name: squad.squadName,
                  }
                })}
                handleCheckboxChange={(param) => {
                  setFormData({
                    ...formData,
                    squadId: param.id,
                    new_squad: undefined,
                  })
                }}
                createNewPropertyClicked={(squad: string) => {
                  setFormData({...formData, squadId: 0, new_squad: squad})
                }}
                addingNewValue={formData.new_squad}
              />
            )}

            {labelsFetcher.data?.data && (
              <OptionsInputComponent
                labelName={AddTestLabels.Labels}
                key={AddTestLabels.Labels}
                placeholder={
                  formData?.labelIds && formData?.labelIds?.length > 0
                    ? labelsFetcher.data?.data
                        ?.filter((label) =>
                          formData.labelIds?.includes(label.labelId),
                        )
                        .map((label) => label.labelName)
                        .join(', ') ?? 'None'
                    : 'None'
                }
                list={labelsFetcher.data?.data?.map((labels) => {
                  return {
                    id: labels.labelId,
                    name: labels.labelName,
                  }
                })}
                handleCheckboxChange={(param) => {
                  setFormData((prevData) => {
                    const isSelected = prevData?.labelIds?.includes(param.id)
                    const updatedLabelIds = isSelected
                      ? prevData?.labelIds?.filter((id) => id !== param.id)
                      : [...prevData?.labelIds, param.id]
                    return {...prevData, labelIds: updatedLabelIds}
                  })
                }}
              />
            )}

            {priorityFetcher.data?.data && (
              <OptionsInputComponent
                labelName={AddTestLabels.Priority}
                isMandatory={isMandatory(AddTestLabels.Priority)}
                placeholder={
                  formData.priorityId
                    ? priorityFetcher.data?.data?.find(
                        (priority) => priority.priorityId === formData.priorityId,
                      )?.priorityName ?? 'None'
                    : 'None'
                }
                key={AddTestLabels.Priority}
                list={priorityFetcher.data?.data?.map((priority) => {
                  return {
                    id: priority.priorityId,
                    name: priority.priorityName,
                  }
                })}
                handleCheckboxChange={(param) => {
                  setFormData({...formData, priorityId: param.id})
                }}
              />
            )}

            {automationStatusFetcher.data?.data && (
              <OptionsInputComponent
                labelName={AddTestLabels.AutomationStatus}
                isMandatory={isMandatory(AddTestLabels.AutomationStatus)}
                key={AddTestLabels.AutomationStatus}
                placeholder={
                  formData.automationStatusId
                    ? automationStatusFetcher.data?.data?.find(
                        (item) =>
                          item.automationStatusId === formData.automationStatusId,
                      )?.automationStatusName ?? 'None'
                    : 'None'
                }
                list={automationStatusFetcher.data?.data?.map(
                  (automationStatus) => {
                    return {
                      id: automationStatus.automationStatusId,
                      name: automationStatus.automationStatusName,
                    }
                  },
                )}
                handleCheckboxChange={(param) => {
                  setFormData({...formData, automationStatusId: param.id})
                }}
              />
            )}

            {typeFetcher.data?.data && (
              <OptionsInputComponent
                labelName={AddTestLabels.Type}
                isMandatory={isMandatory('Type')}
                key={AddTestLabels.Type}
                placeholder={
                  formData.typeId
                    ? typeFetcher.data?.data?.find(
                        (item) => item.typeId === formData.typeId,
                      )?.typeName ?? 'None'
                    : 'None'
                }
                list={typeFetcher.data?.data?.map((type) => ({
                  id: type.typeId,
                  name: type.typeName || 'Unknown Type',
                }))}
                handleCheckboxChange={(selectedOption) => {
                  setFormData({...formData, typeId: selectedOption.id})
                }}
              />
            )}

            {platformFetcher.data?.data && (
              <OptionsInputComponent
                labelName={AddTestLabels.Platform}
                isMandatory={isMandatory('Platform')}
                key={AddTestLabels.Platform}
                placeholder={
                  formData.platformId
                    ? platformFetcher.data?.data?.find(
                        (item) => item.platformId === formData.platformId,
                      )?.platformName ?? 'None'
                    : 'None'
                }
                list={platformFetcher.data?.data?.map((platform) => ({
                  id: platform.platformId,
                  name: platform.platformName || 'Unknown Platform',
                }))}
                handleCheckboxChange={(selectedOption) => {
                  setFormData({...formData, platformId: selectedOption.id})
                }}
              />
            )}

            {testCoveredByFetcher.data?.data && (
              <OptionsInputComponent
                labelName={AddTestLabels.TestCoveredBy}
                isMandatory={isMandatory(AddTestLabels.TestCoveredBy)}
                key={AddTestLabels.TestCoveredBy}
                placeholder={
                  formData.testCoveredById
                    ? testCoveredByFetcher.data?.data?.find(
                        (item) => item.testCoveredById === formData.testCoveredById,
                      )?.testCoveredByName ?? 'None'
                    : 'None'
                }
                list={testCoveredByFetcher.data?.data?.map((testCoveredBy) => ({
                  id: testCoveredBy.testCoveredById,
                  name:
                    testCoveredBy.testCoveredByName || 'Unknown Test Covered By',
                }))}
                handleCheckboxChange={(selectedOption) => {
                  setFormData({...formData, testCoveredById: selectedOption.id})
                }}
              />
            )}
          </div>
        </div>

        {/* Additional Fields Card */}
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-5">
            Additional Information
          </h2>
          <div className="grid grid-cols-3 gap-6">
            <ShortTextInputComponent
              labelName={AddTestLabels.JiraTicket}
              id={AddTestLabels.JiraTicket}
              value={formData?.jiraTicket ?? ''}
              onChange={handleChange}
            />
            <ShortTextInputComponent
              labelName={AddTestLabels.Defects}
              id={AddTestLabels.Defects}
              value={formData?.defects ?? ''}
              onChange={handleChange}
            />
            <ShortTextInputComponent
              labelName={AddTestLabels.AutomationId}
              id={AddTestLabels.AutomationId}
              value={formData?.automationId ?? ''}
              onChange={handleChange}
            />
          </div>
        </div>

        {/* Test Details Card */}
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-5">
            Test Details
          </h2>
          <div className="space-y-5">
            <TextInputComponent
              onChange={handleChange}
              id={AddTestLabels.Preconditions}
              labelName={AddTestLabels.Preconditions}
              value={formData?.preConditions ?? ''}
            />
            <TextInputComponent
              onChange={handleChange}
              id={AddTestLabels.Steps}
              labelName={AddTestLabels.Steps}
              value={formData?.steps ?? ''}
              isMandatory={isMandatory('Steps')}
            />
            <TextInputComponent
              onChange={handleChange}
              id={AddTestLabels.ExpectedResult}
              labelName={AddTestLabels.ExpectedResult}
              value={formData?.expectedResult ?? ''}
              isMandatory={isMandatory('Expected Result')}
            />
            <TextInputComponent
              onChange={handleChange}
              id={AddTestLabels.AdditionalGroups}
              labelName={AddTestLabels.AdditionalGroups}
              value={formData?.additionalGroups ?? ''}
            />
          </div>
        </div>

        {/* Attachments Card */}
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-5">
            Expected Behavior Attachments
          </h2>
          
          {source === 'addTest' ? (
            // Show info message when creating a new test
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-blue-800">
                    Attachments available after creation
                  </p>
                  <p className="text-sm text-blue-600 mt-1">
                    Create the test case first, then edit it to add screenshots or videos 
                    showing the expected behavior. These attachments will be visible in all test runs.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            // Show upload interface when editing an existing test
            <>
              <p className="text-sm text-slate-500 mb-4">
                Upload screenshots or videos showing the expected behavior for this test case.
                These attachments will be visible in all test runs.
              </p>
              
              {/* Attachment Gallery */}
              {attachments.length > 0 && (
                <div className="mb-4">
                  <MediaGallery
                    attachments={attachments}
                    onDelete={handleDeleteAttachment}
                    onUndoDelete={handleUndoDelete}
                    pendingDeletions={pendingDeletions}
                    canDelete={true}
                    emptyMessage="No attachments yet"
                  />
                </div>
              )}
              
              {/* Upload Component */}
              <MediaUploader
                projectId={projectId}
                testId={testId}
                attachmentType="expected"
                onUploadComplete={handleAttachmentUploadComplete}
                onUploadError={handleAttachmentUploadError}
                currentCount={attachments.filter(a => !pendingDeletions.has(a.attachmentId)).length}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
