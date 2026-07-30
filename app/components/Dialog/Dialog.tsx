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
  anchorComponent: ReactNode
  headerComponent?: ReactNode
  contentComponent?: ReactNode
  footerComponent?: ReactNode
  isDialogTriggerDisabled?: boolean
  variant?: 'delete' | 'edit' | 'add'
  onOpenChange?: (open: boolean) => void
}

const dialogVariants = cva('gap-0 border-t-[3px] border-x-0 border-b-0', {
  variants: {
    variant: {
      delete: 'border-red-500',
      edit: 'border-slate-700',
      add: 'border-slate-700',
      default: 'border-slate-700',
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

export const CustomDialog = ({
  anchorComponent,
  headerComponent,
  footerComponent,
  contentComponent,
  isDialogTriggerDisabled = false,
  variant,
  onOpenChange,
}: DialogComponentProps) => {
  return (
    <Dialog onOpenChange={onOpenChange}>
      <DialogTrigger
        aria-describedby="dialog-trigger"
        asChild
        disabled={isDialogTriggerDisabled}
      >
        {anchorComponent}
      </DialogTrigger>
      <DialogContent
        aria-describedby="dialog content"
        className={cn(dialogVariants({variant}))}
      >
        <DialogHeader aria-describedby="dialog-header">
          {headerComponent}
        </DialogHeader>
        {contentComponent}
        <DialogFooter aria-describedby="dialog-footer">
          {footerComponent}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
