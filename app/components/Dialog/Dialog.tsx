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
  open?: boolean
  contentClassName?: string
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
  open,
  contentClassName,
}: DialogComponentProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        asChild
        disabled={isDialogTriggerDisabled}
      >
        {anchorComponent}
      </DialogTrigger>
      <DialogContent
        className={cn(dialogVariants({variant}), contentClassName)}
      >
        <DialogHeader>{headerComponent}</DialogHeader>
        {contentComponent}
        <DialogFooter>{footerComponent}</DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
