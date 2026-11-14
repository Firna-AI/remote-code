import type { DiffResponse } from '../../src/shared/generated/DiffResponse'
import type { FileResponse } from '../../src/shared/generated/FileResponse'
import type { RunnerFileCommand } from '../../src/shared/generated/RunnerFileCommand'
import { HttpError, isRecord } from '../http'
import { parseDiff, parseFile } from './content'
import {
  FileTooLargeError,
  fileUnavailable,
  invalidFileResponse,
} from './errors'
import { natural } from './parsers'
import { checkByteLimit, readFilePath } from './paths'

interface PendingRequest {
  connectionId: string
  type: 'file.read.result' | 'file.diff.result'
  finish(value: unknown): void
  fail(error: unknown): void
}

export class RunnerFiles {
  private connection: {
    id: string
    send: (command: RunnerFileCommand) => void
  } | null = null
  private readonly pending = new Map<string, PendingRequest>()
  private readonly requestId: () => string

  constructor(requestId: () => string) {
    this.requestId = requestId
  }

  attach(
    connectionId: string,
    send: (command: RunnerFileCommand) => void,
  ): void {
    if (this.connection) this.detach(this.connection.id)
    this.connection = { id: connectionId, send }
  }

  detach(connectionId: string): void {
    if (this.connection?.id !== connectionId) return
    this.connection = null
    for (const request of [...this.pending.values()])
      request.fail(fileUnavailable())
  }

  /** Results bypass the owner's numbered event and chat history path. */
  receive(connectionId: string, value: unknown): boolean {
    if (!isRecord(value) || typeof value.requestId !== 'string') return false
    const request = this.pending.get(value.requestId)
    if (
      !request ||
      request.connectionId !== connectionId ||
      request.type !== value.type
    )
      return false
    request.finish(value.result)
    return true
  }

  read(
    path: string,
    maxBytes: number,
    signal?: AbortSignal,
  ): Promise<FileResponse> | null {
    readFilePath(path)
    checkByteLimit(maxBytes)
    return this.request(
      { type: 'file.read', requestId: this.requestId(), path, maxBytes },
      (value) => parseFile(value, path, maxBytes),
      signal,
    )
  }

  diff(
    path: string,
    defaultBranch: string,
    signal?: AbortSignal,
  ): Promise<DiffResponse> | null {
    readFilePath(path)
    return this.request(
      { type: 'file.diff', requestId: this.requestId(), path, defaultBranch },
      (value) => parseDiff(value, path, defaultBranch),
      signal,
    )
  }

  private request<T>(
    command: RunnerFileCommand,
    parse: (value: unknown) => T,
    signal?: AbortSignal,
  ): Promise<T> | null {
    const connection = this.connection
    if (!connection) return null
    return new Promise<T>((resolve, reject) => {
      const clear = () => {
        this.pending.delete(command.requestId)
        signal?.removeEventListener('abort', abort)
      }
      const fail = (error: unknown) => {
        clear()
        reject(error)
      }
      const abort = () => fail(fileUnavailable())
      this.pending.set(command.requestId, {
        connectionId: connection.id,
        type:
          command.type === 'file.read'
            ? 'file.read.result'
            : 'file.diff.result',
        fail,
        finish: (value) => {
          clear()
          try {
            if (!isRecord(value) || typeof value.ok !== 'boolean')
              throw invalidFileResponse()
            if (!value.ok) throw readError(value.error, command)
            resolve(
              parse(command.type === 'file.read' ? value.file : value.diff),
            )
          } catch (error) {
            reject(error)
          }
        },
      })
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) {
        abort()
        return
      }
      try {
        connection.send(command)
      } catch {
        fail(fileUnavailable())
      }
    })
  }
}

function readError(value: unknown, command: RunnerFileCommand): HttpError {
  if (!isRecord(value) || typeof value.message !== 'string')
    return invalidFileResponse()
  if (value.code === 'file_not_found') {
    return new HttpError(404, 'file_not_found', 'The file is not available.')
  }
  if (value.code === 'file_unavailable') return fileUnavailable()
  if (
    value.code === 'file_too_large' &&
    natural(value.sizeBytes) &&
    natural(value.limitBytes)
  ) {
    return new FileTooLargeError(
      value.sizeBytes,
      command.type === 'file.read' ? command.maxBytes : value.limitBytes,
    )
  }
  return invalidFileResponse()
}
