import {Tests} from '@api/runTestsList'
import {ExternalLink} from 'lucide-react'
import {cn} from '~/ui/utils'

type PlaneDefectState = NonNullable<Tests['planeDefectState']>

interface PlaneDefectStatusProps {
  state: Tests['planeDefectState']
  url: string | null
  evidenceState: Tests['planeEvidenceState']
}

const statePresentation: Record<
  PlaneDefectState,
  {label: string; className: string}
> = {
  intake_pending: {
    label: 'Creating ticket',
    className: 'border-amber-200 bg-amber-50 text-amber-800',
  },
  intake_open: {
    label: 'Ticket created',
    className: 'border-blue-200 bg-blue-50 text-blue-800',
  },
  work_item_open: {
    label: 'Ticket created',
    className: 'border-blue-200 bg-blue-50 text-blue-800',
  },
  ready_for_retest: {
    label: 'Ready to retest',
    className: 'border-violet-200 bg-violet-50 text-violet-800',
  },
  validated: {
    label: 'Validated',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  },
  resolved_before_sync: {
    label: 'Resolved before ticket creation',
    className: 'border-slate-200 bg-slate-50 text-slate-700',
  },
  intake_rejected: {
    label: 'Ticket request rejected',
    className: 'border-slate-200 bg-slate-50 text-slate-700',
  },
  canceled: {
    label: 'Ticket canceled',
    className: 'border-slate-200 bg-slate-50 text-slate-700',
  },
  superseded: {
    label: 'Ticket superseded',
    className: 'border-slate-200 bg-slate-50 text-slate-700',
  },
  orphaned: {
    label: 'Needs help - contact owner',
    className: 'border-red-200 bg-red-50 text-red-800',
  },
  manual_attention: {
    label: 'Needs help - contact owner',
    className: 'border-red-200 bg-red-50 text-red-800',
  },
}

const safePlaneUrl = (value: string | null) => {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

const evidencePresentation = {
  pending: {
    label: 'Evidence copying',
    className: 'border-amber-200 bg-amber-50 text-amber-800',
  },
  delivered: {
    label: 'Evidence copied',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  },
  manual_attention: {
    label: 'Evidence needs help',
    className: 'border-red-200 bg-red-50 text-red-800',
  },
} as const

export const PlaneDefectStatus = ({
  state,
  url,
  evidenceState,
}: PlaneDefectStatusProps) => {
  if (!state && !evidenceState) return null

  const presentation = state ? statePresentation[state] : null
  const safeUrl = safePlaneUrl(url)
  const ticketClassName = cn(
    'inline-flex max-w-[240px] items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-medium',
    presentation?.className,
  )
  const evidence = evidenceState
    ? evidencePresentation[evidenceState]
    : null
  const ticket = presentation ? (
    safeUrl ? (
      <a
        href={safeUrl}
        target="_blank"
        rel="noreferrer"
        className={cn(
          ticketClassName,
          'transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2',
        )}
        aria-label={`${presentation.label}. Open Plane ticket in a new tab`}
      >
        <span>{presentation.label}</span>
        <ExternalLink size={12} aria-hidden="true" />
      </a>
    ) : (
      <span className={ticketClassName}>{presentation.label}</span>
    )
  ) : null

  return (
    <div className="flex flex-col items-start gap-1">
      {ticket}
      {evidence && (
        <span
          className={cn(
            'inline-flex max-w-[240px] items-center rounded-full border px-2 py-1 text-[11px] font-medium',
            evidence.className,
          )}
        >
          {evidence.label}
        </span>
      )}
    </div>
  )
}
