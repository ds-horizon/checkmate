import {action} from '~/routes/api/v1/deleteAttachment'
import {deleteAttachment} from '@services/s3'
import {getUserAndCheckAccess} from '~/routes/utilities/checkForUserAndAccess'
import {
  responseHandler,
  errorResponseHandler,
} from '~/routes/utilities/responseHandler'

jest.mock('@services/s3', () => ({
  ...jest.requireActual('@services/s3'),
  deleteAttachment: jest.fn(),
}))
jest.mock('~/routes/utilities/responseHandler')
jest.mock('~/routes/utilities/checkForUserAndAccess')

describe('Delete Attachment - Action Function', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('deletes a validly-shaped attachment key', async () => {
    const key =
      'test-run-attachments/8b1e6f2a-1c2d-4e3f-9a0b-123456789abc-shot.png'
    const request = new Request('http://localhost', {
      method: 'DELETE',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({key}),
    })

    ;(getUserAndCheckAccess as jest.Mock).mockResolvedValue({userId: 1})
    ;(deleteAttachment as jest.Mock).mockResolvedValue(undefined)
    ;(responseHandler as jest.Mock).mockImplementation((response) => response)

    await action({request} as any)

    expect(deleteAttachment).toHaveBeenCalledWith(key)
    expect(responseHandler).toHaveBeenCalledWith({
      data: {success: true},
      status: 200,
    })
  })

  it('rejects a key outside the expected attachment shape without calling deleteAttachment', async () => {
    const request = new Request('http://localhost', {
      method: 'DELETE',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({key: 'db-backups/nightly.sql.gz'}),
    })

    ;(getUserAndCheckAccess as jest.Mock).mockResolvedValue({userId: 1})
    ;(errorResponseHandler as jest.Mock).mockImplementation(
      (error) =>
        new Response(JSON.stringify({error: error.message}), {status: 400}),
    )

    await action({request} as any)

    expect(deleteAttachment).not.toHaveBeenCalled()
    expect(errorResponseHandler).toHaveBeenCalled()
  })
})
