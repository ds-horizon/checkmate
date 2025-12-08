import {StateDialog} from '@components/Dialog/StateDialog'
import {FilterDropdown} from '@components/MultipleUnifiedFilter/FilterDropdown'
import {InputsSpacing} from '@components/Forms/InputsSpacing'
import {DialogDescription, DialogTitle} from '@radix-ui/react-dialog'
import {useFetcher, useParams} from '@remix-run/react'
import {Button} from '@ui/button'
import {DialogClose} from '@ui/dialog'
import {Input} from '@ui/input'
import {Label} from '@ui/label'
import {RadioGroup, RadioGroupItem} from '@ui/radio-group'
import {Skeleton} from '@ui/skeleton'
import {RotateCcw} from 'lucide-react'
import {useEffect, useState} from 'react'
import {
  AND_SELECTION,
  MULTIPLE_SELECTED,
  NONE_SELECTED,
  OR_SELECTION,
} from '~/constants'
import {API} from '~/routes/utilities/api'
import {ORG_ID} from '~/routes/utilities/constants'
import {FilterNames} from './testTable.interface'
import {InputLabels} from './InputLabels'
import {Squad} from '~/screens/RunTestList/interfaces'
import {TestListFilter} from '@components/MultipleUnifiedFilter/MultipleUnifiedFilter'

interface Labels {
  labelName: string
  labelId: number
  labelType: string
}

interface Platforms {
  platformName: string
  platformId: number
}

interface Priority {
  priorityName: string
  priorityId: number
}

interface AddRunDialogProps {
  handleSaveChanges: (data: {
    runName: string
    runDescription: string
    squadIds: number[]
    labelIds: number[]
    platformIds: number[]
    priorityIds: number[]
    filterType: 'and' | 'or'
  }) => void
  state: boolean
  setState: React.Dispatch<React.SetStateAction<boolean>>
}

export const AddRunDialog = ({
  handleSaveChanges,
  state,
  setState,
}: AddRunDialogProps) => {
  const pathParams = useParams()
  const projectId = Number(pathParams?.projectId)
  const orgId = ORG_ID

  const [runName, setRunName] = useState<string>('')
  const [runDescription, setRunDescription] = useState<string>('')
  const [filterType, setFilterType] = useState<'and' | 'or'>('and')
  const [filters, setFilters] = useState<TestListFilter[]>([])

  const squadsFetcher = useFetcher<{data: Squad[]}>()
  const labelsFetcher = useFetcher<{data: Labels[]}>()
  const platformFetcher = useFetcher<{data: Platforms[]}>()
  const priorityFetcher = useFetcher<{data: Priority[]}>()
  const testCountFetcher = useFetcher<{data: {count: number}}>()

  // Fetch filter options when dialog opens
  useEffect(() => {
    if (state) {
      platformFetcher.load(`/${API.GetPlatforms}?orgId=${orgId}`)
      priorityFetcher.load(`/${API.GetPriority}?orgId=${orgId}`)
      squadsFetcher.load(`/${API.GetSquads}?projectId=${projectId}`)
      labelsFetcher.load(`/${API.GetLabels}?projectId=${projectId}`)
    }
  }, [state, projectId, orgId])

  // Build filters from fetched data
  useEffect(() => {
    const squads = squadsFetcher.data?.data
    if (squads) {
      setFilters((prev) => {
        const isSquadFilterPresent = prev.some(
          (f) => f.filterName === FilterNames.Squad,
        )
        if (isSquadFilterPresent) return prev
        return [
          ...prev,
          {
            filterName: FilterNames.Squad,
            filterOptions: [
              ...squads.map((squad) => ({
                id: squad.squadId,
                optionName: squad.squadName,
                checked: false,
              })),
              {
                id: 0,
                optionName: 'No Squad',
                checked: false,
              },
            ],
          },
        ]
      })
    }
  }, [squadsFetcher.data])

  useEffect(() => {
    const labels = labelsFetcher.data?.data
    if (labels) {
      setFilters((prev) => {
        const isLabelFilterPresent = prev.some(
          (f) => f.filterName === FilterNames.Label,
        )
        if (isLabelFilterPresent) return prev
        return [
          ...prev,
          {
            filterName: FilterNames.Label,
            filterOptions: labels.map((label) => ({
              id: label.labelId,
              optionName: label.labelName,
              checked: false,
            })),
          },
        ]
      })
    }
  }, [labelsFetcher.data])

  useEffect(() => {
    const platforms = platformFetcher.data?.data
    if (platforms) {
      setFilters((prev) => {
        const isPlatformFilterPresent = prev.some(
          (f) => f.filterName === FilterNames.Platform,
        )
        if (isPlatformFilterPresent) return prev
        return [
          ...prev,
          {
            filterName: FilterNames.Platform,
            filterOptions: platforms.map((platform) => ({
              id: platform.platformId,
              optionName: platform.platformName,
              checked: false,
            })),
          },
        ]
      })
    }
  }, [platformFetcher.data])

  useEffect(() => {
    const priorities = priorityFetcher.data?.data
    if (priorities) {
      setFilters((prev) => {
        const isPriorityFilterPresent = prev.some(
          (f) => f.filterName === FilterNames.Priority,
        )
        if (isPriorityFilterPresent) return prev
        return [
          ...prev,
          {
            filterName: FilterNames.Priority,
            filterOptions: priorities.map((priority) => ({
              id: priority.priorityId,
              optionName: priority.priorityName,
              checked: false,
            })),
          },
        ]
      })
    }
  }, [priorityFetcher.data])

  // Fetch test count based on selected filters
  useEffect(() => {
    if (!state) return

    const squadIds = getSelectedIds(FilterNames.Squad)
    const labelIds = getSelectedIds(FilterNames.Label)
    const platformIds = getSelectedIds(FilterNames.Platform)
    const priorityIds = getSelectedIds(FilterNames.Priority)

    let url = `/${API.GetTestsCount}?projectId=${projectId}`

    if (squadIds.length > 0 || labelIds.length > 0 || platformIds.length > 0 || priorityIds.length > 0) {
      url += `&filterType=${filterType}`
      if (squadIds.length > 0) url += `&squadIds=${JSON.stringify(squadIds)}`
      if (labelIds.length > 0) url += `&labelIds=${JSON.stringify(labelIds)}`
      if (platformIds.length > 0)
        url += `&platformIds=${JSON.stringify(platformIds)}`
      if (priorityIds.length > 0)
        url += `&priorityIds=${JSON.stringify(priorityIds)}`
    }

    testCountFetcher.load(url)
  }, [filters, filterType, state, projectId])

  const getSelectedIds = (filterName: FilterNames): number[] => {
    const filter = filters.find((f) => f.filterName === filterName)
    if (!filter) return []
    return filter.filterOptions
      .filter((option) => option.checked)
      .map((option) => option.id ?? 0)
  }

  const handleCheckboxChange = ({
    filterName,
    optionName,
  }: {
    filterName: FilterNames
    optionName: string
    optionId?: number
  }) => {
    setFilters((prev) =>
      prev.map((filter) => {
        if (filter.filterName === filterName) {
          return {
            ...filter,
            filterOptions: filter.filterOptions.map((option) => {
              if (option.optionName === optionName) {
                return {...option, checked: !option.checked}
              }
              return option
            }),
          }
        }
        return filter
      }),
    )
  }

  const resetFilter = (filterName: FilterNames) => {
    setFilters((prev) =>
      prev.map((filter) => {
        if (filter.filterName === filterName) {
          return {
            ...filter,
            filterOptions: filter.filterOptions.map((option) => ({
              ...option,
              checked: false,
            })),
          }
        }
        return filter
      }),
    )
  }

  const resetAllFilters = () => {
    setFilters((prev) =>
      prev.map((filter) => ({
        ...filter,
        filterOptions: filter.filterOptions.map((option) => ({
          ...option,
          checked: false,
        })),
      })),
    )
  }

  const handleSubmit = () => {
    handleSaveChanges({
      runName,
      runDescription,
      squadIds: getSelectedIds(FilterNames.Squad),
      labelIds: getSelectedIds(FilterNames.Label),
      platformIds: getSelectedIds(FilterNames.Platform),
      priorityIds: getSelectedIds(FilterNames.Priority),
      filterType,
    })
    // Reset state after submission
    setRunName('')
    setRunDescription('')
    setFilterType('and')
    resetAllFilters()
  }

  const testCount = testCountFetcher.data?.data?.count
  const isLoading =
    squadsFetcher.state === 'loading' ||
    labelsFetcher.state === 'loading' ||
    platformFetcher.state === 'loading' ||
    priorityFetcher.state === 'loading'

  const hasAnyFilterSelected = filters.some((f) =>
    f.filterOptions.some((o) => o.checked),
  )

  return (
    <StateDialog
      variant={'add'}
      setState={setState}
      state={state}
      headerComponent={
        <>
          <DialogTitle className="font-semibold text-lg">Add Run</DialogTitle>
          <DialogDescription className="text-xs text-slate-500">
            Create a new test run with optional filters
          </DialogDescription>
        </>
      }
      contentComponent={
        <div className="pb-4 max-h-[70vh] overflow-y-auto">
          {/* Run Name */}
          <InputLabels
            className="text-xs font-normal"
            labelName="Run Name"
            isMandatory={true}
          />
          <Input
            id="runName"
            onChange={(e) => setRunName(e.target.value)}
            className="col-span-3"
            value={runName}
            placeholder="Enter run name"
          />

          <InputsSpacing />

          {/* Run Description */}
          <InputLabels className="text-xs font-normal" labelName="Run Description" />
          <Input
            id="runDescription"
            onChange={(e) => setRunDescription(e.target.value)}
            className="col-span-3"
            value={runDescription}
            placeholder="Enter run description (optional)"
          />

          <InputsSpacing />

          {/* Filter Section */}
          <div className="border-t border-slate-200 pt-4 mt-2">
            <div className="flex items-center justify-between mb-3">
              <InputLabels
                className="text-xs font-medium"
                labelName="Filter Tests (Optional)"
              />
              {hasAnyFilterSelected && (
                <button
                  onClick={resetAllFilters}
                  className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1">
                  <RotateCcw size={12} />
                  Reset all
                </button>
              )}
            </div>

            {isLoading ? (
              <div className="grid grid-cols-2 gap-3">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {filters.map((filter, index) => (
                  <div key={index} className="flex items-center gap-1">
                    <FilterDropdown
                      key={filter.filterName}
                      filter={filter}
                      handleCheckboxChange={handleCheckboxChange}
                    />
                    {filter.filterOptions.some((option) => option.checked) && (
                      <button
                        onClick={() => resetFilter(filter.filterName)}
                        className="p-1.5 hover:bg-slate-100 rounded-md transition-colors">
                        <RotateCcw
                          className="text-slate-500 hover:text-slate-700"
                          size={14}
                          strokeWidth={2}
                        />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Match Criteria */}
            {hasAnyFilterSelected && (
              <div className="mt-4 pt-4 border-t border-slate-200">
                <h4 className="text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide">
                  Match Criteria
                </h4>
                <RadioGroup
                  value={filterType}
                  onValueChange={(value: 'and' | 'or') => setFilterType(value)}>
                  <div className="flex items-center space-x-2 py-1">
                    <RadioGroupItem value="and" id="and" />
                    <Label
                      className="text-sm text-slate-600 font-normal cursor-pointer"
                      htmlFor="and">
                      {AND_SELECTION}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2 py-1">
                    <RadioGroupItem value="or" id="or" />
                    <Label
                      className="text-sm text-slate-600 font-normal cursor-pointer"
                      htmlFor="or">
                      {OR_SELECTION}
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            )}
          </div>

          {/* Test Count */}
          <div className="mt-4 pt-4 border-t border-slate-200">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">
                Tests to include:
              </span>
              {testCountFetcher.state === 'loading' ? (
                <Skeleton className="h-6 w-16" />
              ) : (
                <span className="text-sm font-semibold text-slate-900 bg-slate-100 px-2 py-1 rounded">
                  {testCount ?? 0} tests
                </span>
              )}
            </div>
            {!hasAnyFilterSelected && (
              <p className="text-xs text-slate-500 mt-1">{NONE_SELECTED}</p>
            )}
            {hasAnyFilterSelected && (
              <p className="text-xs text-slate-500 mt-1">{MULTIPLE_SELECTED}</p>
            )}
          </div>
        </div>
      }
      footerComponent={
        <DialogClose asChild>
          <Button
            type="submit"
            disabled={!runName.trim() || testCount === 0}
            onClick={handleSubmit}>
            Add Run
          </Button>
        </DialogClose>
      }
    />
  )
}

