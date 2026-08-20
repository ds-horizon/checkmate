/** @jest-environment jsdom */

import '@testing-library/jest-dom'
import {render, screen} from '@testing-library/react'

jest.mock('@remix-run/react', () => ({
  Form: ({children, ...props}: React.FormHTMLAttributes<HTMLFormElement>) => (
    <form {...props}>{children}</form>
  ),
}))

import {MyRetestsPage} from '../MyRetestsPage'

const notification = {
  resultNotificationId: 91,
  defectCycleId: 73,
  resultRevisionId: 41,
  projectId: 5,
  projectName: 'Checkout',
  runId: 7,
  runName: 'Release candidate',
  testId: 11,
  testTitle: 'Payment succeeds',
  readOn: null,
  createdOn: new Date('2026-08-20T01:00:00.000Z'),
}

describe('MyRetestsPage', () => {
  it('shows unread retest work with an acknowledgement form', () => {
    render(<MyRetestsPage notifications={[notification]} />)

    expect(screen.getByText('1 test is ready for you.')).not.toBeNull()
    expect(screen.getByText('Payment succeeds')).not.toBeNull()
    expect(screen.getByText('Checkout / Release candidate')).not.toBeNull()
    expect(screen.getByLabelText('Unread')).not.toBeNull()
    expect(screen.getByRole('button', {name: 'Open retest'})).not.toBeNull()
    expect(
      screen.getByDisplayValue('91').getAttribute('name'),
    ).toBe('resultNotificationId')
  })

  it('shows a clear empty state', () => {
    render(<MyRetestsPage notifications={[]} />)

    expect(screen.getByText('You are all caught up')).not.toBeNull()
    expect(screen.getByText('0 tests are ready for you.')).not.toBeNull()
  })
})
