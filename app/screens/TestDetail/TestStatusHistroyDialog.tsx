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
import {
  getAttachmentFileName,
  getAttachmentKeyFromUrl,
  ResultAttachment,
  ResultAttachmentGallery,
} from '../RunTestList/ResultAttachments'

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
        <div className="mt-4 max-h-[65vh] overflow-auto">
          <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className="w-[100px]">Status</TableHead>
              <TableHead scope="col">Updated By</TableHead>
              <TableHead scope="col">Comment</TableHead>
              {showAttachments && <TableHead scope="col">Attachments</TableHead>}
              <TableHead scope="col" className="text-right">
                {pageType === 'testDetail' ? 'Run Name' : 'Updated On'}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {testStatusData.map((item: any, index: number) => (
              <TableRow key={index}>
                <TableCell className="truncate">{item.status}</TableCell>
                <TableCell className="truncate">{item.updatedBy}</TableCell>
                <TableCell className="min-w-[180px] max-w-[360px]">
                  {item.comment ? (
                    <div className="break-words whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                      {item.comment}
                    </div>
                  ) : (
                    <span className="text-slate-400">-</span>
                  )}
                </TableCell>
                {showAttachments && (
                  <TableCell className="min-w-[220px]">
                    {item.attachments?.length ? (
                      <ResultAttachmentGallery
                        attachments={item.attachments.map(
                          (attachmentUrl: string, attachmentIndex: number): ResultAttachment => ({
                            id: `history-${index}-${attachmentIndex}-${attachmentUrl}`,
                            url: attachmentUrl,
                            fileName:
                              getAttachmentFileName(attachmentUrl) ||
                              `Screenshot ${attachmentIndex + 1}`,
                            key: getAttachmentKeyFromUrl(attachmentUrl),
                            isExisting: true,
                            status: 'ready',
                          }),
                        )}
                        emptyLabel="No screenshots"
                      />
                    ) : (
                      <span className="text-slate-400">No screenshots</span>
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
        </div>
      )
    }
  }

  return (
    <CustomDialog
      anchorComponent={<Button variant="outline">Status Log</Button>}
      headerComponent={<DialogTitle>Status Log</DialogTitle>}
      contentComponent={content()}
      contentClassName="max-w-[min(96vw,1180px)]"
    />
  )
}
