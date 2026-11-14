# Terminal, previews, and desktop

This doc holds the requirements and the decisions in force for the security
of the terminal, the port previews, and the desktop. It also covers the
proxies to a sandbox. It belongs to
[Access and security](access-and-security.md), which covers sign-in, the
gates of the Worker, the request bodies, and the content security policy.
[Tools of a workspace](workspace-tools.md) states what these tools show.
The terms are those of the [architecture doc](../architecture.md#terms). A
decision number names a dated record, as
[Decision numbers](../architecture.md#decision-numbers) says.

## Terminal

- The terminal socket runs on `app.conductive.build`, behind its gate.
- The terminal listens on a private port of the sandbox. The Worker
  connects to it with Boat's port cookie and a password for each
  workspace.
- Reason: sandbox code can make a port public, and the password still
  guards the terminal.

## Port previews

- Previews live on `conductive.page`, a separate registrable domain
  (decisions 6 and 102).
- Each preview gets a random hostname one level under that domain, with at
  least 128 random bits. The hostname gives each preview its own origin.
  It is not a credential.
- A request to a preview hostname reaches the sandbox only with the valid
  credential cookie of that preview (decision 83).
- Reason: browsers send the preview origin in the `Origin` header of
  cross-site requests and sockets, also under `no-referrer`. A hostname as
  the credential was rejected, because a preview page then leaks it to
  each site that it calls.
- The API gives each preview a launch address on the app's hostname. The
  address holds no secret, because each load needs the sign-in and access
  to the workspace.
- Each load of the launch address, in a frame or in a tab, gets a new
  grant. A form on the launch page posts the grant to the authorizer, a
  fixed hostname on the preview domain. The authorizer sets the credential
  cookie, then sends the browser to the preview hostname.
- Only pages on the app origin and on the desktop origin of the
  [Mac app](desktop-app.md#the-page) can frame the launch page.
- A grant works for 60 seconds at most, and only for its own preview. It
  works only once (decision 95). A reusable grant was rejected, because a
  copy of a used grant could give a second browser access for the life of
  the preview.
- A used grant gets the same 404 as an invalid grant. The reply sets no
  cookie, and no sandbox gets a request.
- A request that fails any other check, such as a wrong `Origin` or the
  hostname of another preview, leaves its grant unused.
- A grant never goes to a sandbox or into a log. It never goes into the
  path or the query of a URL. A grant in a query was rejected, because
  the browser sends the query to the server.
- Only a [browser launch](desktop-app.md#port-previews) carries a grant in
  a URL. The grant and the preview hostname go in the fragment of an
  authorizer address, because a browser sends no fragment to a server.
- Risk: the browser can keep that address in its history. The grant in it
  works only once, and it stops working within 60 seconds.
- At that address, the authorizer serves its own page, the authorizer
  page. No page can frame it. Before any request or navigation, the page
  removes the fragment from its address.
- The authorizer accepts a grant in two ways. Each needs one preview
  hostname and one valid grant for an active preview:
  - a form POST with the app's `Origin`, from the launch page. The
    authorizer then sends the browser to the preview hostname.
  - a POST with the authorizer's own `Origin` and the grant in its
    `Authorization` header, from the authorizer page. The authorizer then
    returns the address of the preview hostname, and the page goes there.
- Both ways set the same credential cookie. The authorizer never serves
  sandbox content.
- Reason: a service worker of a previewed app can read a form that the
  browser posts to the origin of that preview. A handoff on the preview
  hostname was rejected for that reason.
- Authorizer form bodies have a size limit of 1,000,000 bytes under decision 65.
  The authorizer cancels an oversized body and returns 404.
- The authorizer never reads or buffers the body of a POST with an
  `Authorization` header.
- The launch page sends only the app's origin as its referrer. Reason:
  under `no-referrer`, the form sends `Origin: null`, and the authorizer
  refuses it.
- The credential cookie is HttpOnly, Secure, SameSite=None, and
  Partitioned. It expires no later than its preview.
- Reason: a frame under the app is a third-party context, where browsers
  can block a cookie that is not partitioned. A partitioned cookie works
  there, but only under the top-level site that set it. So a frame and a
  tab each get their own cookie, and another site that frames a preview
  gets none.
- The Durable Object of the workspace revokes the preview when the sandbox
  stops, when the user closes the preview, and after 24 hours. Reason: the
  cookies and the grants of a revoked preview stop working at once.
- Each grant and each credential cookie belongs to one viewer: the user
  and the session that launched the preview.
- Each preview request and each batch of preview data checks the preview
  and that viewer. One successful read of that access covers the checks of
  that viewer that start within 1 second after the read started (preview
  access decision 1). Preview access decisions are the decisions of the
  change that added this rule.
  [Previews and their viewers](operator-actions.md#previews-and-their-viewers)
  states the full rules.
- Reason: four database reads in a row made each request of a large dev
  server wait about 0.4 seconds, and over 1 second under load.
- Risk: a viewer who signs out, leaves or is removed from the org, or is
  suspended can still load preview data for up to 1 second, plus the time
  of one read.
- A revocation by the workspace object ends access at once, also inside the
  window: a closed preview, a stopped workspace, and an expired preview.
- A check that refuses a viewer ends each open stream of that viewer at
  once.
- A request joins the connections of its viewer before its access read, so a
  revocation during that read also ends it.
- A relay lookup that calls the provider ends the window, and the request
  reads again. Reason: that call can outlast a change of the sandbox.
- A check with no wait for the window was rejected, because it kept the
  preview of a large dev server slow.
- A revoked or an unknown hostname gets no answer from any sandbox.
- The preview relay is the app's own service in the sandbox, as
  [Sandbox software](../architecture/sandbox-software.md) says. Each preview
  request goes through it to the previewed server, the server on the port
  of the preview.
- An answer that does not come from the preview relay never reaches the browser.
- The Worker refuses previews with 409 `preview_relay_unavailable` without
  a running relay, because the app is not live and the Worker keeps one route.
  Decision 219 rejects a direct fallback, installation at preview open,
  startup by the Worker, and a software install that each workspace start
  waits for. A sandbox without the relay gets it with an update of its
  software, as [Updates](sandbox-software.md#updates) says.
- Through the relay, each request reaches the previewed server with
  `Host: localhost:<port>`, as a browser in the sandbox would send it
  (decision 218).
- Reason: by default, dev servers such as Vite, webpack, and `mokly serve`
  refuse a `Host` that is not local. The relay makes each such server work
  with no change to its repository, as a forwarded local port does.
- These ways to give the server a local `Host` were rejected:
  - a relay that each user starts by hand, because each user must then
    start it in each sandbox
  - a Mokly setting that allows more hostnames, because Vite and webpack
    projects still need their own setting
  - a relay option at Boat, because the wait for Boat is unknown
- Through the relay, a request from the preview's own origin reaches the
  previewed server with `Origin: http://localhost:<port>` (decision 218).
  A request from another origin keeps its `Origin`. A request without an
  `Origin` gets none.
- Reason: some servers, such as `mokly serve`, refuse a request whose
  `Origin` does not match its `Host`.
- The preview proxy adds Boat's `_port_auth` cookie on the server side. It
  drops any `_port_auth` cookie that the browser sends.
- The preview proxy forwards the cookies of the previewed app. It never
  sends a credential cookie to a sandbox. It drops each credential cookie
  that a sandbox response sets.
- A redirect to the local address of the previewed server, with `http` or
  `https`, reaches the browser as a redirect to the preview hostname. The
  local address is `localhost`, `127.0.0.1`, or `[::1]`, with the port of
  the preview.
- Each response on the preview domain carries `Referrer-Policy:
  no-referrer`. Reason: other sites have no need for the preview address.
- Each preview reply that passes every check carries a `Server-Timing`
  header (preview timing decision 1). It gives the duration of each step of
  the Worker: the hostname lookup, the trip to the workspace object, the
  access read, the relay lookup, the access check before the call, the call
  to the sandbox, and the access check after it. A step that the cache or the
  access window covers shows a duration of 0. Preview timing decisions
  are the decisions of the change that added this rule.
- Reason: a preview of a large dev server took 10 seconds or more, and
  only these durations show where a request waits.
- The header holds fixed step names and whole milliseconds, and no ID,
  address, or secret. A refused request gets no such header, so a refusal
  does not show which check failed.
- Risk: the previewed page can read the durations of its own requests.
- The access checks of the body come after the headers, so the header
  cannot give them.
- The header of the previewed server never reaches the browser, as the
  response header allowlist drops it.
- A reply of the previewed server keeps its cache rules, and only the
  viewer's browser may keep it. A reply that gives the browser no
  lifetime must be checked again before each reuse.
- Reason: dev servers mark their package files as unchanging, so a reload
  skips them. A page load still passes the access check, because dev
  servers mark their pages for a check before each use. A ban on all
  browser caching was rejected, because each reload then fetched every
  file again through the access checks.
- Risk: a revoked viewer's browser keeps the files that it already
  received.
- These approaches were rejected:
  - previews behind Cloudflare Access, because Access cannot sign in
    inside a frame
  - previews under the app's own domain, because preview code would then
    be same-site with the app
  - Boat `_token` URLs in the browser, because such a token cannot rotate
    without a public gap

## Proxies and ports

- The proxies of the Worker forward only an allowlist of headers and
  cookies. They never forward the app's session cookie to a sandbox.
- A private port of a sandbox never answers on its public address without
  its token.
- A preview request reaches only the port of its own preview, whatever the
  browser sends.
- The preview relay answers only a request that reaches it through the
  private address of its own port. It takes no connection from another
  machine. It refuses each request whose `Host` names another address.
- Reason: a dev server checks `Host` to stop DNS rebinding. It often
  listens only on a loopback address. The relay must not open a way past
  either protection.
- The relay forwards a request only to a port of its own sandbox. Reason:
  each process in the sandbox can reach these ports already.
- A request through the relay reaches the previewed server without Boat's
  `_port_auth` cookie. Reason: with that cookie, a request can reach each
  port of the sandbox through the relay, with no check by the Worker.
- A request through the relay reaches the previewed server with no
  `Forwarded` or `X-Forwarded-*` header. Reason: the server must see one
  consistent local request. For example, Next.js compares `Origin` with
  `X-Forwarded-Host`.

## Desktop

- The Worker asks Boat for a new desktop URL on each page load. The URL
  works for 10 minutes and carries its token in the fragment.
- An open desktop stream does not pass through the Worker. So it can keep
  playing after its user loses access, until the sandbox stops. This is
  the one exception to the 30-second rule of decision 70 (decision 117).
