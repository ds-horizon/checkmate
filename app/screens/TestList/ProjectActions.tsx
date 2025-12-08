import {useCustomNavigate} from '@hooks/useCustomNavigate'
import {PlusCircledIcon} from '@radix-ui/react-icons'
import {useFetcher, useParams} from '@remix-run/react'
import {Button} from '@ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@ui/dropdown-menu'
import {toast} from '@ui/use-toast'
import {MouseEvent, useEffect, useState} from 'react'
import {Loader} from '~/components/Loader/Loader'
import {API} from '~/routes/utilities/api'
import {AddSquadsLabelsDialog} from './AddSquadsLabelsDialog'
import {AddRunDialog} from './AddRunDialog'

enum Actions {
  AddTest = 'Test',
  AddLabel = 'Label',
  AddSquad = 'Squad',
  CreateRun = 'Run',
}

const ACTION_ITEMS: {
  id: number
  action: Actions
}[] = [
  {
    id: 1,
    action: Actions.AddTest,
  },
  {
    id: 2,
    action: Actions.AddLabel,
  },
  {
    id: 3,
    action: Actions.AddSquad,
  },
  {
    id: 4,
    action: Actions.CreateRun,
  },
]

export const ProjectActions = () => {
  const navigate = useCustomNavigate()
  const projectId = useParams().projectId ? Number(useParams().projectId) : 0
  const saveChanges = useFetcher<any>()
  const createRun = useFetcher<any>()
  const [actionDD, setActionDD] = useState<boolean>(false)
  const [addSquadDialog, setAddSquadDialog] = useState<boolean>(false)
  const [addLabelDialog, setAddLabelDialog] = useState<boolean>(false)
  const [addRunDialog, setAddRunDialog] = useState<boolean>(false)

  useEffect(() => {
    if (saveChanges.data?.error === null) {
      let toastMessage = ''

      if (saveChanges.data?.data?.success?.message)
        toastMessage += saveChanges.data?.data?.success?.message

      if (saveChanges.data?.data?.failed?.message)
        toastMessage += ' ' + saveChanges.data?.data?.failed?.message

      if (saveChanges.data?.data?.message)
        toastMessage = saveChanges.data?.data?.message

      if (!toastMessage) toastMessage = 'Changes saved successfully'
      toast({
        description: toastMessage,
        variant: 'info',
      })
    } else if (saveChanges.data?.error) {
      const message = saveChanges.data?.error
      toast({
        title: 'Failed',
        description: message,
        variant: 'destructive',
      })
    }
  }, [saveChanges.data])

  useEffect(() => {
    if (createRun.data?.data?.runId) {
      const runId = createRun.data?.data?.runId
      navigate(
        `/project/${projectId}/run/${runId}?page=1&pageSize=100&sortOrder=asc`,
      )
    } else if (createRun.data?.error) {
      toast({
        title: 'Failed',
        description: createRun.data?.error,
        variant: 'destructive',
      })
    }
  }, [createRun.data])

  const handleActionClick = (
    action: Actions,
    e: MouseEvent<HTMLButtonElement, globalThis.MouseEvent>,
  ) => {
    setActionDD(false)

    if (action === Actions.AddLabel) setAddLabelDialog(true)
    else if (action === Actions.AddSquad) setAddSquadDialog(true)
    else if (action === Actions.CreateRun) setAddRunDialog(true)
    else if (action === Actions.AddTest)
      navigate(`/project/${projectId}/tests/createTest`, {}, e)
  }

  const handleSaveChangesLabels = (value: string) => {
    const labels = value
      .split(',')
      .map((val) => val.trim())
      .filter((val) => val !== '')
    const postData = {labels, projectId}
    saveChanges.submit(postData, {
      method: 'POST',
      action: `/${API.AddLabels}`,
      encType: 'application/json',
    })
  }

  const handleSaveChangesSquads = (value: string) => {
    const squads = value
      .split(',')
      .map((val) => val.trim())
      .filter((val) => val !== '')
    const postData = {squads, projectId}
    saveChanges.submit(postData, {
      method: 'POST',
      action: `/${API.AddSquads}`,
      encType: 'application/json',
    })
  }

  const handleSaveChangesRuns = (data: {
    runName: string
    runDescription: string
    squadIds: number[]
    labelIds: number[]
    platformIds: number[]
    priorityIds: number[]
    filterType: 'and' | 'or'
  }) => {
    const postData = {
      runName: data.runName,
      runDescription: data.runDescription || null,
      squadIds: data.squadIds.length > 0 ? data.squadIds : null,
      labelIds: data.labelIds.length > 0 ? data.labelIds : null,
      platformIds: data.platformIds.length > 0 ? data.platformIds : null,
      priorityIds: data.priorityIds.length > 0 ? data.priorityIds : null,
      projectId,
      filterType: data.filterType,
    }

    createRun.submit(postData, {
      method: 'POST',
      action: `/${API.AddRun}`,
      encType: 'application/json',
    })
  }

  return (
    <div>
      <DropdownMenu open={actionDD} onOpenChange={setActionDD}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="default" className="shadow-sm">
            <PlusCircledIcon className="w-4 h-4 mr-2" />
            New
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-fit" align="end">
          {ACTION_ITEMS.map((action) => (
            <DropdownMenuItem
              onSelect={(e: any) => handleActionClick(action.action, e)}
              key={action.id}
              className="capitalize">
              <Button
                variant={'ghost'}
                size={'sm'}
                className={'w-full text-sm font-medium justify-start'}>
                {action.action}
              </Button>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <AddSquadsLabelsDialog
        heading={Actions.AddLabel}
        handleSaveChanges={handleSaveChangesLabels}
        state={addLabelDialog}
        setState={setAddLabelDialog}
      />
      <AddSquadsLabelsDialog
        heading={Actions.AddSquad}
        handleSaveChanges={handleSaveChangesSquads}
        state={addSquadDialog}
        setState={setAddSquadDialog}
      />
      <AddRunDialog
        handleSaveChanges={handleSaveChangesRuns}
        state={addRunDialog}
        setState={setAddRunDialog}
      />
      {createRun.state !== 'idle' && <Loader />}
    </div>
  )
}
