import * as React from 'react'
import {CaretSortIcon, CheckIcon} from '@radix-ui/react-icons'

import {Button} from '~/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '~/ui/command'
import {Popover, PopoverContent, PopoverTrigger} from '~/ui/popover'
import {cn} from '~/ui/utils'

export type ComboBoxProps = {
  value: string
  onChange: (value: string) => void
  options: {value: string; label: string}[]
  id?: string
  'aria-labelledby'?: string
  searchStringPlaceholder?: string
  typePlaceholderString?: string
  emptyStateString?: string
}

export function ComboboxDemo(props: ComboBoxProps) {
  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={props.id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-labelledby={props['aria-labelledby']}
          className="w-[200px] justify-between">
          {props.value
            ? props.options.find((framework) => framework.value === props.value)
                ?.label
            : props.typePlaceholderString
            ? props.typePlaceholderString
            : 'Select Status...'}
          <CaretSortIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0">
        <Command>
          <CommandInput
            placeholder={
              props.searchStringPlaceholder
                ? props.searchStringPlaceholder
                : 'Search Property...'
            }
            className="h-9 text-xs"
            id={'status'}
          />
          <CommandList>
            <CommandEmpty>
              {props.emptyStateString
                ? props.emptyStateString
                : 'No Status Found'}
            </CommandEmpty>
            <CommandGroup>
              {props.options.map((framework) => (
                <CommandItem
                  style={{
                    pointerEvents: 'auto',
                  }}
                  key={framework.value}
                  value={framework.value}
                  onSelect={(currentValue) => {
                    props.onChange(
                      currentValue === props.value ? '' : currentValue,
                    )
                    setOpen(false)
                  }}>
                  {framework.label}
                  <CheckIcon
                    className={cn(
                      'ml-auto h-4 w-4',
                      props.value === framework.value
                        ? 'opacity-100'
                        : 'opacity-0',
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
