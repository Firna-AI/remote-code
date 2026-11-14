function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function object(value: unknown): Record<string, unknown> {
  if (!isObject(value)) {
    throw new Error('Expected an object.')
  }
  return value
}

export function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected text.')
  return value
}

export function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('Expected a finite number.')
  }
  return value
}

export function integer(value: unknown): number {
  const result = number(value)
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error('Expected a non-negative integer.')
  }
  return result
}

export function array<T>(value: unknown, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new Error('Expected a list.')
  return value.map(parse)
}

export function oneOf<const T extends readonly string[]>(
  value: unknown,
  values: T,
): T[number] {
  for (const candidate of values) if (value === candidate) return candidate
  throw new Error('The value is not supported.')
}

export function nullable(value: unknown): string | null {
  return value === null ? null : string(value)
}

export function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Expected a boolean.')
  return value
}
