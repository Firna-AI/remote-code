import type { CommitAuthor } from './generated/CommitAuthor'
import type { User } from './api'

export function commitAuthor(
  user: Pick<User, 'githubId' | 'githubLogin' | 'displayName'>,
): CommitAuthor {
  const displayName = user.displayName?.trim() ?? ''
  const usableName = [...displayName].some(
    (character) =>
      character.charCodeAt(0) > 32 && !',:;<>"\\\''.includes(character),
  )
  return {
    name: usableName ? displayName : user.githubLogin,
    email: `${user.githubId}+${user.githubLogin}@users.noreply.github.com`,
  }
}

/** The Git variables that carry an agent turn's author. */
export const COMMIT_AUTHOR_VARIABLES = [
  'GIT_AUTHOR_NAME',
  'GIT_AUTHOR_EMAIL',
  'GIT_COMMITTER_NAME',
  'GIT_COMMITTER_EMAIL',
] as const

export function commitAuthorEnvironment(
  author: CommitAuthor,
): Record<(typeof COMMIT_AUTHOR_VARIABLES)[number], string> {
  return {
    GIT_AUTHOR_NAME: author.name,
    GIT_AUTHOR_EMAIL: author.email,
    GIT_COMMITTER_NAME: author.name,
    GIT_COMMITTER_EMAIL: author.email,
  }
}
