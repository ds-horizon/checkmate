/** @jest-environment jsdom */

import '@testing-library/jest-dom'
import {render, screen} from '@testing-library/react'
import {PlaneDefectStatus} from '../PlaneDefectStatus'

describe('PlaneDefectStatus', () => {
  it('stays hidden when no defect cycle exists', () => {
    const {container} = render(
      <PlaneDefectStatus state={null} url={null} evidenceState={null} />,
    )

    expect(container.childElementCount).toBe(0)
  })

  it.each([
    ['intake_pending', 'Creating ticket'],
    ['ready_for_retest', 'Ready to retest'],
    ['validated', 'Validated'],
    ['manual_attention', 'Needs help - contact owner'],
  ] as const)('shows %s as plain-language status', (state, label) => {
    render(<PlaneDefectStatus state={state} url={null} evidenceState={null} />)

    expect(screen.getByText(label)).not.toBeNull()
  })

  it('links a created ticket to its canonical Plane URL', () => {
    render(
      <PlaneDefectStatus
        state="work_item_open"
        url="https://plane-dev.geep-fence.ts.net/infinimind/browse/BIZ-38/"
        evidenceState="delivered"
      />,
    )

    const link = screen.getByRole('link', {
      name: 'Ticket created. Open Plane ticket in a new tab',
    })
    expect(link.getAttribute('href')).toBe(
      'https://plane-dev.geep-fence.ts.net/infinimind/browse/BIZ-38/',
    )
    expect(screen.getByText('Evidence copied')).not.toBeNull()
  })

  it('does not render a stored unsafe URL as a link', () => {
    render(
      <PlaneDefectStatus
        state="work_item_open"
        url="javascript:alert('unsafe')"
        evidenceState={null}
      />,
    )

    expect(screen.getByText('Ticket created')).not.toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it.each([
    ['pending', 'Evidence copying'],
    ['delivered', 'Evidence copied'],
    ['manual_attention', 'Evidence needs help'],
  ] as const)('shows %s evidence independently', (evidenceState, label) => {
    render(
      <PlaneDefectStatus
        state="work_item_open"
        url={null}
        evidenceState={evidenceState}
      />,
    )

    expect(screen.getByText(label)).not.toBeNull()
  })

  it.each([
    ['pending', 'Reopening ticket'],
    ['delivered', 'Waiting for Plane confirmation'],
    ['observed', 'Reopen confirmed'],
    ['manual_attention', 'Reopen needs help'],
  ] as const)(
    'shows %s reopen progress independently',
    (reopenState, label) => {
      render(
        <PlaneDefectStatus
          state="work_item_open"
          url={null}
          evidenceState={null}
          reopenState={reopenState}
        />,
      )

      expect(screen.getByText(label)).not.toBeNull()
    },
  )
})
