import {
  boolean,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/mysql-core'
import {projects} from './projects'
import {tests} from './tests'
import {users} from './users'
import {sql} from 'drizzle-orm'

export type statusUpdateHistory = {
  status: string
  updatedBy: number
  updatedOn: number
  comment?: string
}

export const testRunsStatusHistory = mysqlTable(
  'testRunsStatusHistory',
  {
    testRunsStatusHistoryId: int('testRunsStatusHistoryId')
      .primaryKey()
      .autoincrement(),
    runId: int('runId').references(() => runs.runId, {onDelete: 'cascade'}),
    testId: int('testId').references(() => tests.testId, {onDelete: 'cascade'}),
    status: varchar('status', {length: 25}).notNull(),
    updatedBy: int('updatedBy').references(() => users.userId, {
      onDelete: 'set null',
    }),
    updatedOn: timestamp('updatedOn')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
    createdOn: timestamp('createdOn')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    comment: text('comment'),
    attachments: json('attachments').$type<string[]>(),
    totalTestCase: int('totalTestCase').default(0),
    passedTestCase: int('passedTestCase').default(0),
    failedTestCase: int('failedTestCase').default(0),
    untestedTestCase: int('untestedTestCase').default(0),
  },
  (testRunsHistory) => {
    return {
      testRunsStatusHistoryRunIdIndex: index(
        'testRunsStatusHistoryRunIdIndex',
      ).on(testRunsHistory.runId, testRunsHistory.testId),
    }
  },
)

export const runs = mysqlTable(
  'runs',
  {
    runId: int('runId').primaryKey().autoincrement(),
    projectId: int('projectId')
      .references(() => projects.projectId, {onDelete: 'cascade'})
      .notNull(),
    status: mysqlEnum('status', ['Active', 'Locked', 'Archived', 'Deleted']),
    runDescription: varchar('runDescription', {length: 255}),
    refrence: varchar('refrence', {length: 255}),
    createdBy: int('createdBy').references(() => users.userId, {
      onDelete: 'set null',
    }),
    createdOn: timestamp('createdOn').default(sql`CURRENT_TIMESTAMP`),
    updatedOn: timestamp('updatedOn')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
    updatedBy: int('updatedBy').references(() => users.userId, {
      onDelete: 'set null',
    }),
    runName: varchar('runName', {length: 50}).notNull(),
    lockedBy: int('lockedBy').references(() => users.userId, {
      onDelete: 'set null',
    }),
    lockedOn: timestamp('lockedOn'),
  },
  (runs) => {
    return {
      runProjectStatusIndex: index('runProjectIndex').on(
        runs.projectId,
        runs.status,
      ),
    }
  },
)

export const testRunMap = mysqlTable(
  'testRunMap',
  {
    testRunMapId: int('testRunMapId').primaryKey().autoincrement(),
    runId: int('runId').references(() => runs.runId, {onDelete: 'cascade'}),
    testId: int('testId').references(() => tests.testId, {onDelete: 'cascade'}),
    projectId: int('projectId')
      .references(() => projects.projectId, {onDelete: 'cascade'})
      .notNull(),
    isIncluded: boolean('isIncluded').default(true),
    status: varchar('status', {length: 25}).notNull().default('Untested'),
    statusUpdateHistory: json('statusUpdates').$type<statusUpdateHistory[]>(),
    updatedBy: int('updatedBy').references(() => users.userId, {
      onDelete: 'set null',
    }),
    createdOn: timestamp('createdOn').default(sql`CURRENT_TIMESTAMP`),
    updatedOn: timestamp('updatedOn')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
    comment: text('comment'),
    currentResultRevisionId: int('currentResultRevisionId'),
  },
  (testRunMap) => {
    return {
      testRunMapRunIdIndex: index('testRunMapRunIdIndex').on(testRunMap.runId),
      testRunMapStatusIndex: index('testRunMapStatusIndex').on(
        testRunMap.status,
      ),
      testRunMapCurrentResultRevisionIndex: index(
        'testRunMapCurrentResultRevisionIndex',
      ).on(testRunMap.currentResultRevisionId),
    }
  },
)
