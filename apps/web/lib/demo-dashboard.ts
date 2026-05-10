const defaultDemoDashboardProjectId = 'proj_62dc3460ccb749a388c40356c101a01f'

export const demoDashboardProjectId = process.env.NEXT_PUBLIC_DEMO_DASHBOARD_PROJECT_ID ?? defaultDemoDashboardProjectId
export const demoDashboardHref = `/merchant/${demoDashboardProjectId}`

export function isDemoDashboardProject(projectId: string | null | undefined) {
  return projectId === demoDashboardProjectId
}
