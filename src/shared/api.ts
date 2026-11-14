export const API_PATHS = {
  githubSignIn: '/api/auth/github',
  githubCallback: '/api/auth/github/callback',
  signOut: '/api/auth/logout',
  session: '/api/session',
  orgs: '/api/orgs',
  orgOrder: '/api/org-order',
} as const

export function orgPath(orgId: string): string {
  return `${API_PATHS.orgs}/${encodeURIComponent(orgId)}`
}

export interface User {
  id: string
  githubId: number
  githubLogin: string
  displayName: string | null
  avatarUrl: string | null
}

export type OrgRole = 'admin' | 'member'

export interface Org {
  id: string
  name: string
  role: OrgRole
}

export interface ApiErrorBody {
  error: {
    code: string
    message: string
    details?: {
      login: string
      triggerIndex: number
      list: 'is' | 'isNot'
    }
  }
}

/** Writes with no fields still send an empty JSON object through the app gate. */
export type EmptyRequest = Record<string, never>
