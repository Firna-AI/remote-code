import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { dirname, join } from 'node:path'

import { TOOL_TURN_HEADER } from '../../src/shared/agent-tools'

interface GitRequest {
  method: string
  path: string
  authorization: string | undefined
}

interface FakeGitHubGitInput {
  repository: string
  gitExecPath: string
  environment: NodeJS.ProcessEnv
  issueCredential(turnId: string): Promise<Response>
  expectedToken: string
  authorize?(authorization: string | undefined, path: string): boolean
  privateRequest?(request: IncomingMessage): Promise<Response | null>
}

/** GitHub's local Git boundary uses a real bare repository and smart HTTP. */
export class FakeGitHubGit {
  private readonly input: FakeGitHubGitInput
  readonly requests: GitRequest[] = []
  readFailure: 'none' | 'denied' | 'unavailable' = 'none'
  denyPush = false
  beforeReceive: (() => Promise<void>) | undefined
  private readonly server = createServer((request, response) => {
    void this.handle(request, response).catch(() => {
      response.writeHead(500)
      response.end('Local fake GitHub request failed')
    })
  })

  constructor(input: FakeGitHubGitInput) {
    this.input = input
  }

  async listen(): Promise<string> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(0, '127.0.0.1', resolve)
    })
    const address = this.server.address()
    if (!address || typeof address === 'string')
      throw new Error('Missing local fake GitHub address')
    return `http://127.0.0.1:${address.port}`
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()))
      this.server.closeAllConnections()
    })
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? '/', 'http://local.test')
    const privateResponse = await this.input.privateRequest?.(request)
    if (privateResponse) {
      response.writeHead(
        privateResponse.status,
        Object.fromEntries(privateResponse.headers),
      )
      response.end(await privateResponse.text())
      return
    }
    if (url.pathname === '/credential') {
      const turnId = request.headers[TOOL_TURN_HEADER.toLowerCase()]
      const credential = await this.input.issueCredential(
        typeof turnId === 'string' ? turnId : '',
      )
      response.writeHead(credential.status, {
        'Content-Type': 'application/json',
      })
      response.end(await credential.text())
      return
    }
    this.requests.push({
      method: request.method ?? '',
      path: `${url.pathname}${url.search}`,
      authorization: request.headers.authorization,
    })
    const expected = `Basic ${Buffer.from(`x-access-token:${this.input.expectedToken}`).toString('base64')}`
    if (!(
      this.input.authorize?.(request.headers.authorization, url.pathname) ??
      request.headers.authorization === expected
    )) {
      response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="GitHub"' })
      response.end('GitHub sign-in required')
      return
    }
    const isPush =
      url.searchParams.get('service') === 'git-receive-pack' ||
      url.pathname.endsWith('/git-receive-pack')
    if ((isPush && this.denyPush) || (!isPush && this.readFailure !== 'none')) {
      response.writeHead(
        this.readFailure === 'unavailable' && !isPush ? 503 : 403,
      )
      response.end('GitHub request refused')
      return
    }
    if (isPush && this.beforeReceive) {
      const beforeReceive = this.beforeReceive
      this.beforeReceive = undefined
      await beforeReceive()
    }
    await this.gitBackend(request, response, url)
  }

  private async gitBackend(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ) {
    const output: Buffer[] = []
    const child = spawn(join(this.input.gitExecPath, 'git-http-backend'), [], {
      cwd: dirname(this.input.repository),
      env: {
        ...this.input.environment,
        GIT_PROJECT_ROOT: dirname(this.input.repository),
        GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: url.pathname,
        QUERY_STRING: url.search.slice(1),
        REQUEST_METHOD: request.method,
        CONTENT_TYPE: request.headers['content-type'] ?? '',
        CONTENT_LENGTH: request.headers['content-length'] ?? '',
        HTTP_GIT_PROTOCOL: request.headers['git-protocol']?.toString(),
        REMOTE_USER: 'x-access-token',
        REMOTE_ADDR: '127.0.0.1',
      },
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk))
    request.pipe(child.stdin)
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`Git backend exited ${code}`)),
      )
    })
    const bytes = Buffer.concat(output)
    const split = bytes.indexOf('\r\n\r\n')
    if (split < 0) throw new Error('Missing Git backend response headers')
    const lines = bytes.subarray(0, split).toString().split('\r\n')
    let status = 200
    for (const line of lines) {
      const separator = line.indexOf(':')
      const name = line.slice(0, separator)
      const value = line.slice(separator + 1).trim()
      if (name.toLowerCase() === 'status') status = Number(value.split(' ')[0])
      else response.setHeader(name, value)
    }
    response.writeHead(status)
    response.end(bytes.subarray(split + 4))
  }
}
