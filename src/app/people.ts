import type { MessageSender } from '../shared/generated/MessageSender'
type Person = Pick<MessageSender, 'displayName' | 'githubLogin'>

function words(name: string): string[] {
  return name
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '')
}

function first(word: string): string {
  return Array.from(word)[0] ?? ''
}

/** The name of a person: the GitHub display name, or else the login. */
export function personName(person: Person): string {
  return person.displayName?.trim() || person.githubLogin
}

/** The initials of a person's avatar: one letter, or two for two names. */
export function personInitials(person: Person): string {
  const parts = words(personName(person))
  const letters =
    parts.length > 1 ? first(parts[0]) + first(parts[1]) : first(parts[0] ?? '')
  return letters.toUpperCase()
}

/**
 * The two letters of an org tile in the rail: the first letters of two
 * words, or the first two letters of one word.
 */
export function orgInitials(name: string): string {
  const parts = words(name)
  if (parts.length > 1) return (first(parts[0]) + first(parts[1])).toUpperCase()
  return Array.from(parts[0] ?? '?')
    .slice(0, 2)
    .join('')
    .toUpperCase()
}
