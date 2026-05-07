import {
  ApiRequestError,
  getPaymentProjects,
  getProjectOverview,
  isUnauthorizedApiError,
  type PaymentProject,
  type ProjectDashboardOverview,
} from './api.ts'

export type MerchantPortalResult<T> =
  | {
      data: T
      status: 'ready'
    }
  | {
      reason: string
      status: 'unauthorized'
    }
  | {
      reason: string
      status: 'unavailable'
    }

export async function loadMerchantProjects(cookieHeader: string): Promise<MerchantPortalResult<PaymentProject[]>> {
  try {
    return {
      data: await getPaymentProjects(cookieHeader),
      status: 'ready',
    }
  } catch (error) {
    return portalFailure(error, 'Payment project list')
  }
}

export async function loadMerchantProjectOverview(
  projectId: string,
  cookieHeader: string,
): Promise<MerchantPortalResult<ProjectDashboardOverview | null>> {
  try {
    return {
      data: await getProjectOverview(projectId, cookieHeader),
      status: 'ready',
    }
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) {
      return {
        data: null,
        status: 'ready',
      }
    }

    return portalFailure(error, 'Payment project overview')
  }
}

function portalFailure(error: unknown, label: string): MerchantPortalResult<never> {
  if (isUnauthorizedApiError(error)) {
    return {
      reason: error instanceof Error ? error.message : 'Merchant session is missing.',
      status: 'unauthorized',
    }
  }

  return {
    reason: portalFailureReason(error, label),
    status: 'unavailable',
  }
}

function portalFailureReason(error: unknown, label: string): string {
  if (error instanceof ApiRequestError) {
    return `${label} failed with ${error.status}: ${error.message}`
  }

  if (error instanceof Error) {
    return error.message
  }

  return `${label} is unavailable.`
}
