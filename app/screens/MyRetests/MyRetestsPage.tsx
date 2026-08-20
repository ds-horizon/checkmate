import {Form} from '@remix-run/react'
import {BellRing, CheckCircle2, ExternalLink} from 'lucide-react'
import type {MyRetestNotification} from '~/services/resultNotifications'

type MyRetestNotificationView = Omit<
  MyRetestNotification,
  'readOn' | 'createdOn'
> & {
  readOn: Date | string | null
  createdOn: Date | string
}

export const MyRetestsPage = ({
  notifications,
}: {
  notifications: MyRetestNotificationView[]
}) => {
  const unreadCount = notifications.filter((notification) => !notification.readOn)
    .length

  return (
    <main className="mx-auto flex h-full max-w-5xl flex-col py-8">
      <div className="mb-6 border-b border-slate-200 pb-5">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-violet-100 p-2 text-violet-700">
            <BellRing size={22} aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">My Retests</h1>
            <p className="text-sm text-slate-600">
              {unreadCount === 1
                ? '1 test is ready for you.'
                : `${unreadCount} tests are ready for you.`}
            </p>
          </div>
        </div>
      </div>

      {notifications.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
          <CheckCircle2 className="mx-auto mb-3 text-emerald-600" size={34} />
          <h2 className="text-base font-semibold text-slate-900">
            You are all caught up
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Tests will appear here when their Plane ticket is ready for retest.
          </p>
        </div>
      ) : (
        <ul className="space-y-3 overflow-y-auto pb-8">
          {notifications.map((notification) => (
            <li
              key={notification.resultNotificationId}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-start justify-between gap-6">
                <div className="min-w-0">
                  <div className="mb-2 flex items-center gap-2">
                    {!notification.readOn && (
                      <span
                        className="h-2 w-2 rounded-full bg-violet-600"
                        aria-label="Unread"
                      />
                    )}
                    <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-1 text-xs font-medium text-violet-800">
                      Ready to retest
                    </span>
                  </div>
                  <h2 className="truncate text-base font-semibold text-slate-900">
                    {notification.testTitle}
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {notification.projectName} / {notification.runName}
                  </p>
                </div>

                <Form method="post">
                  <input
                    type="hidden"
                    name="resultNotificationId"
                    value={notification.resultNotificationId}
                  />
                  <button
                    type="submit"
                    className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-slate-900 px-3 text-sm font-medium text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2"
                  >
                    Open retest
                    <ExternalLink size={14} aria-hidden="true" />
                  </button>
                </Form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
