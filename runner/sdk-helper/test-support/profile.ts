export async function fakeClaudeProfile(home: string) {
  return {
    directory: `${home}/.conductive/anthropic`,
    name: 'test-profile',
    remove: async () => {},
  }
}
