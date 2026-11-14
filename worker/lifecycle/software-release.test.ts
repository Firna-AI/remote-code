import { expect, it } from 'vitest'

import { latestSoftwareRelease } from './software-release'

const metadata = {
  binary: 'conductive',
  target: 'x86_64-unknown-linux-musl',
  version: '0.0.42',
  asset_name: 'conductive.tar.gz',
  download_url: 'https://releases.example.test/conductive.tar.gz',
  sha256: 'A'.repeat(64),
}

it('fetches and validates the newest release from the configured server', async () => {
  const requests: Request[] = []
  const release = await latestSoftwareRelease(
    { CONDUCTIVE_RELEASE_SERVER: 'https://releases.example.test/base/' },
    async (request) => {
      requests.push(request)
      return Response.json(metadata)
    },
  )
  expect(requests.map((request) => [request.url, request.redirect])).toEqual([
    [
      'https://releases.example.test/base/releases/latest/conductive/x86_64-unknown-linux-musl',
      'manual',
    ],
  ])
  expect(release).toEqual({
    url: metadata.download_url,
    sha256: 'a'.repeat(64),
    version: '0.0.42',
    server: 'https://releases.example.test/base',
  })
})

it('refuses unsafe or incomplete release metadata', async () => {
  const invalid = [
    { download_url: 'http://releases.example.test/program.tar.gz' },
    {
      download_url:
        'https://user:password@releases.example.test/program.tar.gz',
    },
    {
      download_url: 'https://releases.example.test/program.tar.gz?token=secret',
    },
    { sha256: null },
    { sha256: 'a'.repeat(63) },
    { sha256: 'z'.repeat(64) },
    { binary: 'other' },
    { target: 'aarch64-apple-darwin' },
    { version: '0.0.42; reboot' },
    { asset_name: 'program.zip' },
  ]
  for (const value of invalid)
    await expect(
      latestSoftwareRelease({}, async () =>
        Response.json({ ...metadata, ...value }),
      ),
      JSON.stringify(value),
    ).rejects.toMatchObject({
      status: 503,
      code: 'runner_software_unavailable',
    })
})

it('fails clearly when the release server redirects, fails or returns invalid JSON', async () => {
  for (const response of [
    Response.json(metadata, {
      status: 302,
      headers: { Location: 'https://other.example.test/release' },
    }),
    new Response(null, { status: 503 }),
    new Response('{'),
  ])
    await expect(
      latestSoftwareRelease({}, async () => response),
    ).rejects.toMatchObject({
      message:
        'The cloud computer software release is not available. Try again later.',
    })
  await expect(
    latestSoftwareRelease({}, async () => {
      throw new Error('offline')
    }),
  ).rejects.toMatchObject({ status: 503 })
  let fetched = false
  await expect(
    latestSoftwareRelease(
      { CONDUCTIVE_RELEASE_SERVER: 'http://unsafe.test' },
      async () => {
        fetched = true
        return Response.json(metadata)
      },
    ),
  ).rejects.toMatchObject({ status: 503 })
  expect(fetched).toBe(false)
})
