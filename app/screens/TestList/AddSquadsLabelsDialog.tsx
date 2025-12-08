import {StateDialog} from '@components/Dialog/StateDialog'
import {DialogDescription, DialogTitle} from '@radix-ui/react-dialog'
import {Button} from '@ui/button'
import {DialogClose} from '@ui/dialog'
import {Input} from '@ui/input'
import {useState} from 'react'

interface AddSquadsLabelsDialogProps {
  heading: string
  handleSaveChanges: (value: string) => void
  state: boolean
  setState: React.Dispatch<React.SetStateAction<boolean>>
}

export const AddSquadsLabelsDialog = ({
  heading,
  handleSaveChanges,
  state,
  setState,
}: AddSquadsLabelsDialogProps) => {
  const [value, setValue] = useState<string>('')

  return (
    <StateDialog
      variant={'add'}
      setState={setState}
      state={state}
      headerComponent={
        <>
          <DialogTitle className="font-semibold text-lg">{`Add ${heading}`}</DialogTitle>
          <DialogDescription className="text-xs text-slate-500">
            {`Please add ${heading.toLocaleLowerCase()}s with comma separated values.`}
          </DialogDescription>
        </>
      }
      contentComponent={
        <div className="gap-4 py-4">
          <Input
            id="name"
            onChange={(e) => {
              setValue(e.target.value)
            }}
            className="col-span-3"
            value={value}
          />
        </div>
      }
      footerComponent={
        <DialogClose asChild>
          <Button
            type="submit"
            onClick={(_) => {
              handleSaveChanges(value)
            }}>
            Add {heading}
          </Button>
        </DialogClose>
      }
    />
  )
}
