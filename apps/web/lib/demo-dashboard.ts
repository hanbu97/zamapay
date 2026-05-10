export const demoDashboardProjectId = 'proj_5f227192e2514a94a3bbbfa63e04e12a'
export const demoDashboardHref = `/merchant/${demoDashboardProjectId}`

export function isDemoDashboardProject(projectId: string | null | undefined) {
  return projectId === demoDashboardProjectId
}
