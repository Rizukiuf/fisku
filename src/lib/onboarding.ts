import { entityKeys, type Data } from './model'
import type { Workspace } from './repository'

export type StartChoice = 'template' | 'empty'
export type OnboardingStatus = StartChoice | 'pending' | 'existing'
export const onboardingStatuses: OnboardingStatus[] = ['pending', 'template', 'empty', 'existing']
const hasHistory = (data: Data) => entityKeys.some(key => data[key].length > 0 || data.purged[key].length > 0)

export function inferOnboarding(workspace: Workspace): OnboardingStatus {
  const status = workspace.onboarding ?? 'pending'
  if (status !== 'pending') return status
  // Tombstones, purge markers and acknowledged cloud data are evidence of a
  // workspace already in use, even when it has no active rows after a reset.
  return hasHistory(workspace.state) || hasHistory(workspace.base) || Boolean(workspace.pending || workspace.conflict) || workspace.revision > 0 ? 'existing' : 'pending'
}
