import {ReactNode} from 'react'

export interface ITestListTable {
  section: ReactNode
  sectionHierarchy: ReactNode
  projectId: any
  refCreatedByName: string
  labelName: string
  squadName: string
  testId: number
  title: string
  priority: string
  squad: string
  automationStatus: string
  createdByName: string
  label: string
  createdOn: Date
  platform: string
  testCoveredBy: string
}

export enum FilterNames {
  Squad = 'Squad',
  Label = 'Label',
  Status = 'Status',
  Platform = 'Platform',
  Priority = 'Priority',
}

export enum EditableProperties {
  Squad = 'Squad',
  Label = 'Label',
  Priority = 'Priority',
  AutomationStatus = 'Automation Status',
}

export interface PriorityData {
  priorityId: number
  priorityName: string
}

export interface AutomationStatusData {
  automationStatusId: number
  automationStatusName: string
}

export interface ProjectData {
  projectId: number
  projectName: string
  projectDescription: string | null
  createdBy: number
  createdOn: Date
  orgId: number
  status: string
}

export enum ProjectActions {
  AddTest = 'Test',
  AddLabel = 'Label',
  AddSquad = 'Squad',
  CreateRun = 'Run',
}
