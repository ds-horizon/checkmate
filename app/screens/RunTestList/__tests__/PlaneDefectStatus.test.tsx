/** @jest-environment jsdom */

import '@testing-library/jest-dom'
import {render, screen} from '@testing-library/react'
import {PlaneDefectStatus} from '../PlaneDefectStatus'

describe('PlaneDefectStatus', () => {
  it('stays hidden when no defect cycle exists', () => {
    const {container} = render(<PlaneDefectStatus state={null} url={null} />)

    expect(container.childElementCount).toBe(0)
  })

  it.each([
    ['intake_pending', 'Creating ticket'],
    ['ready_for_retest', 'Ready to retest'],
    ['validated', 'Validated'],
    ['manual_attention', 'Needs help - contact owner'],
  ] as const)('shows %s as plain-language status', (state, label) => {
    render(<PlaneDefectStatus state={state} url={null} />)

    expect(screen.getByText(label)).not.toBeNull()
  })

  it('links a created ticket to its canonical Plane URL', () => {
    render(
      <PlaneDefectStatus
        state="work_item_open"
        url="https://plane-dev.geep-fence.ts.net/infinimind/browse/BIZ-38/"
      />,
    )

    const link = screen.getByRole('link', {
      name: 'Ticket created. Open Plane ticket in a new tab',
    })
    expect(link.getAttribute('href')).toBe(
      'https://plane-dev.geep-fence.ts.net/infinimind/browse/BIZ-38/',
    )
  })

  it('does not render a stored unsafe URL as a link', () => {
    render(
      <PlaneDefectStatus
        state="work_item_open"
        url="javascript:alert('unsafe')"
      />,
    )

    expect(screen.getByText('Ticket created')).not.toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
