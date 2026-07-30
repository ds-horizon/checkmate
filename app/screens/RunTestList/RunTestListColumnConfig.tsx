import {Tests} from '@api/runTestsList'
import {Tooltip} from '@components/Tooltip/Tooltip'
import {TestStatusType} from '@controllers/types'
import {
  ChevronDownIcon,
  ChevronUpIcon,
  DoubleArrowUpIcon,
  PauseIcon,
} from '@radix-ui/react-icons'
import {useParams} from '@remix-run/react'
import {ColumnDef} from '@tanstack/react-table'
import {MessageSquare} from 'lucide-react'
import {ReactNode, useState} from 'react'
import {Checkbox} from '~/ui/checkbox'
import {cn} from '~/ui/utils'
import {TestDetailDrawer} from '../TestList/TestDetailSlidingPanel'
import {
  HeaderComponent,
  PlatformComponent,
  PriorityRowComponent,
  SortingHeaderComponent,
  TitleRowComponent,
} from '../TestList/TestListRowColumns'
import {TestListingColumns} from '../TestList/UploadTest/constants'
import {AddResultDialog} from './AddResultDialog'

export const priorityMapping: {[key: string]: ReactNode} = {
  Critical: <DoubleArrowUpIcon stroke={'#f01000'} height={18} width={18} />,
  High: <ChevronUpIcon stroke={'#c74022'} height={18} width={18} />,
  Medium: (
    <PauseIcon
      stroke={'#ffc40c'}
      strokeWidth={1.5}
      className={'rotate-90'}
      height={18}
      width={18}
    />
  ),
  Low: <ChevronDownIcon stroke={'#323ea8'} height={18} width={18} />,
}

export const RunTestListColumnConfig: ColumnDef<Tests>[] = [
  {
    accessorKey: 'select',
    header: ({table}) => (
      <div className="flex items-center">
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && 'indeterminate')
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      </div>
    ),
    cell: ({row}) => (
      <div className="flex items-center">
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
        />
      </div>
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: TestListingColumns.testId,
    header: () => (
      <SortingHeaderComponent
        heading={TestListingColumns.testId}
        position="left"
      />
    ),
    cell: ({row}) => (
      <div className="text-left text-sm text-slate-600">
        {row.original.testId}
      </div>
    ),
    enableHiding: false,
  },
  {
    accessorKey: TestListingColumns.title,
    header: () => (
      <SortingHeaderComponent
        heading={TestListingColumns.title}
        position="left"
      />
    ),

    cell: ({row, table}) => {
      const [isDrawerOpen, setDrawerOpen] = useState(false)

      const toggleDrawer = () => {
        setDrawerOpen((prev) => !prev)
      }
      const {runId, projectId} = useParams()
      const visibleColumnsCount = table.getVisibleLeafColumns().length
      const columnWidth = `${100 / visibleColumnsCount}%`
      return (
        <>
          <TitleRowComponent
            clickable={true}
            content={row.original.title}
            onClick={toggleDrawer}
            columnWidth={columnWidth}
            initialWidth="576px"
          />
          <TestDetailDrawer
            isOpen={isDrawerOpen}
            onClose={toggleDrawer}
            props={{
              projectId: projectId ? +projectId : 0,
              testId: row.original.testId ? +row.original.testId : 0,
              runId: runId ? +runId : 0,
            }}
            pageType="runTestDetail"
            runActive={row.original.runStatus === 'Active'}
          />
        </>
      )
    },
    enableHiding: false,
  },
  {
    accessorKey: TestListingColumns.status,
    header: () => (
      <HeaderComponent heading={TestListingColumns.status} position="center" />
    ),
    cell: ({row}) => {
      const params = useParams()
      const runId = +(params['runId'] ?? 0)
      const comment = row.original.comment
      return row.original.runStatus === 'Active' ? (
        <div className="flex items-center justify-center gap-1">
          <AddResultDialog
            getSelectedRows={() => {
              return [{testId: row.original.testId}]
            }}
            runId={runId}
            variant="runRowUpdate"
            currStatus={row.original.testStatus as TestStatusType}
            currComment={comment}
          />
          {comment && (
            <Tooltip
              anchor={
                <MessageSquare
                  size={16}
                  className="text-slate-500 shrink-0 cursor-pointer"
                />
              }
              content={<div className="max-w-[300px]">{comment}</div>}
            />
          )}
        </div>
      ) : (
        <div className="flex items-center justify-center gap-1 text-sm text-slate-700">
          {row.original.testStatus}
          {comment && (
            <Tooltip
              anchor={
                <MessageSquare
                  size={16}
                  className="text-slate-500 shrink-0 cursor-pointer"
                />
              }
              content={<div className="max-w-[300px]">{comment}</div>}
            />
          )}
        </div>
      )
    },
    enableHiding: false,
  },
  {
    accessorKey: TestListingColumns.testedBy,
    header: () => (
      <HeaderComponent heading={TestListingColumns.testedBy} position="left" />
    ),
    cell: ({row}) => {
      return (
        <div className="text-left text-sm text-slate-700 truncate">
          {row.original.testedBy ? row.original.testedBy : '-'}
        </div>
      )
    },
  },
  {
    accessorKey: TestListingColumns.priority,
    header: ({}) => (
      <SortingHeaderComponent
        position="left"
        heading={TestListingColumns.priority}
      />
    ),
    cell: ({row}) => <PriorityRowComponent priority={row.original.priority} />,
  },
  {
    accessorKey: TestListingColumns.squad,
    header: () => (
      <HeaderComponent position="left" heading={TestListingColumns.squad} />
    ),
    cell: ({row}) => {
      return (
        <div className="text-left text-sm text-slate-700 text-nowrap">
          {row.original.squadName}
        </div>
      )
    },
  },
  {
    accessorKey: TestListingColumns.platform,
    header: () => (
      <SortingHeaderComponent
        position="left"
        heading={TestListingColumns.platform}
      />
    ),
    cell: ({row}) => {
      return <PlatformComponent content={row.original.platform} />
    },
  },
  {
    accessorKey: TestListingColumns.automationStatus,
    header: () => (
      <SortingHeaderComponent
        position="left"
        heading={TestListingColumns.automationStatus}
      />
    ),
    cell: ({row}) => (
      <div className="text-left text-sm text-slate-700">
        {row.original.automationStatus}
      </div>
    ),
  },
  {
    accessorKey: TestListingColumns.labelName,
    header: () => (
      <HeaderComponent position="left" heading={TestListingColumns.labelName} />
    ),
    cell: ({row}) => (
      <Tooltip
        anchor={
          <div className="text-left max-w-32 truncate text-sm text-slate-700">
            {row.original.labelNames}
          </div>
        }
        content={row.original.labelNames}
      />
    ),
  },
  {
    accessorKey: TestListingColumns.section,
    header: () => (
      <SortingHeaderComponent
        position="left"
        heading={TestListingColumns.section}
      />
    ),
    cell: ({row}) => (
      <div className="text-left max-w-32 truncate text-sm text-slate-700">
        {row.original.sectionName}
      </div>
    ),
  },
  {
    accessorKey: TestListingColumns.testCoveredBy,
    header: () => (
      <HeaderComponent
        position="left"
        heading={TestListingColumns.testCoveredBy}
      />
    ),
    cell: ({row}) => {
      return (
        <div className="max-w-32 text-left truncate text-sm text-slate-700">
          {row.original.testCoveredBy}
        </div>
      )
    },
  },
]
