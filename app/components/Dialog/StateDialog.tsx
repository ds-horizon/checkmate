import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from '~/ui/dialog'
import {ReactNode} from 'react'
import {cn} from '@ui/utils'
import {cva} from 'class-variance-authority'

interface DialogComponentProps {
  anchorComponent?: ReactNode
  headerComponent?: ReactNode
  contentComponent?: ReactNode
  footerComponent?: ReactNode
  isDialogTriggerDisabled?: boolean
  variant?: 'delete' | 'edit' | 'add' | 'warn'
  setState: React.Dispatch<React.SetStateAction<boolean>>
  state: boolean
}

const dialogVariants = cva('gap-0 border-t-4 border-x-0  border-b-0', {
  variants: {
    variant: {
      delete: 'border-destructive',
      edit: 'border-primary',
      add: 'border-green-600',
      warn: 'border-amber-500',
      default: '',
    },
    size: {
      default: 'sm:max-w-[425px]',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
})

export const StateDialog = ({
  anchorComponent,
  headerComponent,
  footerComponent,
  contentComponent,
  isDialogTriggerDisabled = false,
  variant,
  setState,
  state,
}: DialogComponentProps) => {
  return (
    <Dialog onOpenChange={setState} open={state}>
      {anchorComponent && (
        <DialogTrigger
          aria-describedby="dialog-trigger"
          asChild
          disabled={isDialogTriggerDisabled}>
          {anchorComponent}
        </DialogTrigger>
      )}
      <DialogContent
        className={cn(dialogVariants({variant}))}>
        {headerComponent && (
          <DialogHeader>{headerComponent}</DialogHeader>
        )}
        {contentComponent}
        {footerComponent && (
          <DialogFooter>{footerComponent}</DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
