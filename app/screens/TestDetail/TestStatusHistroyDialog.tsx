import {CustomDialog} from '@components/Dialog/Dialog'
import {Tooltip} from '@components/Tooltip/Tooltip'
import {Button} from '@ui/button'
import {DialogTitle} from '@ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@ui/table'
import {useEffect} from 'react'
import {getFormatedDate, shortDate} from '~/utils/getDate'

export const TestStatusHistroyDialog = ({
  data,
  pageType,
}: {
  data: any
  pageType: 'testDetail' | 'runTestDetail'
}) => {
  // Attachments are only ever populated on the run-scoped history
  // (testRunsStatusHistory); the test-detail variant reads from
  // testRunMap, which does not have an attachments column.
  const showAttachments = pageType === 'runTestDetail'
  const testStatusData = data?.data

  useEffect(() => {
    const elementsWithAutofocus = document.querySelectorAll('[autofocus]')
    elementsWithAutofocus.forEach((el) => el.removeAttribute('autofocus'))
  }, [])

  const content = () => {
    if (!testStatusData || testStatusData?.length === 0) {
      return <div className="text-center mt-4">No Status History Found</div>
    } else {
      return (
        <Table className="mt-4">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[100px]">Status</TableHead>
              <TableHead>Updated By</TableHead>
              <TableHead>Comment</TableHead>
              {showAttachments && <TableHead>Attachments</TableHead>}
              <TableHead className="text-right">
                {pageType === 'testDetail' ? 'Run Name' : 'Updated On'}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {testStatusData.map((item: any, index: number) => (
              <TableRow key={index}>
                <TableCell className="truncate">{item.status}</TableCell>
                <TableCell className="truncate">{item.updatedBy}</TableCell>
                <TableCell className="max-w-[200px]">
                  {item.comment ? (
                    <Tooltip
                      anchor={<div className="truncate">{item.comment}</div>}
                      content={
                        <div className="max-w-[300px]">{item.comment}</div>
                      }
                    />
                  ) : (
                    '-'
                  )}
                </TableCell>
                {showAttachments && (
                  <TableCell>
                    {item.attachments?.length ? (
                      <div className="flex gap-1.5 flex-wrap">
                        {item.attachments.map(
                          (attachmentUrl: string, attachmentIndex: number) => (
                            <a
                              key={attachmentIndex}
                              href={attachmentUrl}
                              target="_blank"
                              rel="noopener noreferrer">
                              <img
                                src={attachmentUrl}
                                loading="lazy"
                                alt="Attachment thumbnail"
                                className="h-10 w-10 object-cover rounded border border-slate-200"
                              />
                            </a>
                          ),
                        )}
                      </div>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                )}
                <TableCell className="text-right">
                  <Tooltip
                    anchor={
                      <div className="truncate">
                        {pageType === 'testDetail'
                          ? item.runName
                          : shortDate(item.updatedOn)}
                      </div>
                    }
                    content={getFormatedDate(item.updatedOn)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )
    }
  }

  return (
    <CustomDialog
      anchorComponent={<Button variant="outline">Status Log</Button>}
      headerComponent={<DialogTitle>Status Log</DialogTitle>}
      contentComponent={content()}
    />
  )
}
