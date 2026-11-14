import { API_PATHS, type Org } from '../../src/shared/api'
import { withSoftwareRelease } from '../lifecycle/software-release-test-support'
import type { FakeGitHub } from './fake-github'

export async function createTestOrg(
  client: {
    github: FakeGitHub
    db: D1Database
    request: (
      path: string,
      session: string,
      init?: RequestInit,
    ) => Promise<Response>
  },
  session: string,
  name: string,
): Promise<Org> {
  const original = client.github.fetch
  const installationId = 9_000_000_001
  client.github.fetch = withSoftwareRelease(async (request) => {
    const path = new URL(request.url).pathname
    if (path === '/user/installations')
      return Response.json({
        total_count: 1,
        installations: [
          {
            id: installationId,
            account: { login: 'fixture', type: 'User' },
            html_url: 'https://github.com/settings/installations/9000000001',
            suspended_at: null,
          },
        ],
      })
    if (path === `/user/installations/${installationId}/repositories`)
      return Response.json({
        total_count: 1,
        repositories: [
          {
            id: 9_000_000_001,
            full_name: 'fixture/repository',
            description: '',
            default_branch: 'main',
          },
        ],
      })
    return original(request)
  })
  try {
    const response = await client.request(API_PATHS.orgs, session, {
      method: 'POST',
      body: JSON.stringify({ name, repositoryIds: [9_000_000_001] }),
    })
    if (response.status !== 201)
      throw new Error(
        `Org create returned ${response.status}: ${await response.text()}`,
      )
    const value: { org: Org } = await response.json()
    // Each scenario supplies its own repositories after the real create.
    await client.db
      .prepare('DELETE FROM repositories WHERE org_id = ?')
      .bind(value.org.id)
      .run()
    await client.db
      .prepare('DELETE FROM github_installations WHERE id = ?')
      .bind(installationId)
      .run()
    return value.org
  } finally {
    client.github.fetch = original
  }
}
