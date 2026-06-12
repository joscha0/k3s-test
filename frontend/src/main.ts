import './style.css'

type User = { username: string, role: 'user' | 'admin' }
type Session = { accessToken: string, user: User }
type Resources = {
  cpuUsageMillicores?: number
  cpuRequestMillicores: number
  cpuLimitMillicores: number
  memoryUsageMiB?: number
  memoryRequestMiB: number
  memoryLimitMiB: number
}
type Pod = Resources & {
  name: string
  app: 'frontend' | 'backend' | 'mongodb'
  phase: string
  ready: boolean
  restarts: number
  terminating: boolean
}
type Trace = {
  id: string
  method: string
  route: string
  status: number
  startedAt: string
  durationMs: number
  backendPod: string
  accessedMongoDB: boolean
}
type Snapshot = {
  generatedAt: string
  pods: Pod[]
  totals: Resources
  components: Record<string, boolean>
  traces: Trace[]
  errors: Array<{ component: string, message: string }>
}

const app = document.querySelector<HTMLElement>('#app')!
let accessToken: string | undefined
let currentUser: User | undefined
let selectedTrace: string | undefined
let streamAbort: AbortController | undefined

function escapeHtml (value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]!)
}

async function request (path: string, options: RequestInit = {}, retry = true): Promise<Response> {
  const headers = new Headers(options.headers)
  if (accessToken !== undefined) headers.set('authorization', `Bearer ${accessToken}`)
  if (options.body !== undefined) headers.set('content-type', 'application/json')
  const response = await fetch(path, { ...options, headers, credentials: 'same-origin' })
  if (response.status === 401 && retry && path !== '/api/auth/refresh') {
    if (await refresh()) return await request(path, options, false)
  }
  return response
}

async function refresh (): Promise<boolean> {
  const response = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
  if (!response.ok) {
    accessToken = undefined
    currentUser = undefined
    return false
  }
  const session = await response.json() as Session
  accessToken = session.accessToken
  currentUser = session.user
  return true
}

async function submitCredentials (event: SubmitEvent): Promise<void> {
  event.preventDefault()
  const form = event.currentTarget as HTMLFormElement
  const data = new FormData(form)
  const submitter = event.submitter as HTMLButtonElement
  const response = await fetch(`/api/auth/${submitter.value}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: data.get('username'), password: data.get('password') })
  })
  const body = await response.json()
  if (!response.ok) {
    document.querySelector<HTMLElement>('#auth-error')!.textContent = `${response.status}: ${body.message ?? body.error}`
    return
  }
  accessToken = body.accessToken
  currentUser = body.user
  render()
}

function authForm (message = '', required = false): string {
  return `<section class="auth-card">
    <p>${required ? 'Authentication required' : 'Optional authentication'}</p>
    <h2>Sign in to the cluster lab</h2>
    <p>${required ? 'Sign in with an admin account to continue.' : 'Sign in or sign up to access the protected endpoints.'}</p>
    <form id="credentials">
      <label>Username <input name="username" required minlength="3" maxlength="32"></label>
      <label>Password <input name="password" type="password" required minlength="8" maxlength="128"></label>
      <div class="actions"><button name="action" value="signin">Sign in</button><button class="secondary" name="action" value="signup">Sign up</button></div>
    </form>
    <p id="auth-error" class="error">${escapeHtml(message)}</p>
  </section>`
}

function sessionControls (): string {
  if (currentUser === undefined) return ''
  return `<p>Signed in as <strong>${escapeHtml(currentUser.username)}</strong> (${currentUser.role}) <button id="signout">Sign out</button></p>`
}

function bindCommon (): void {
  document.querySelector('#signout')?.addEventListener('click', async () => {
    streamAbort?.abort()
    await fetch('/api/auth/signout', { method: 'POST', credentials: 'same-origin' })
    accessToken = undefined
    currentUser = undefined
    render()
  })
  document.querySelector<HTMLFormElement>('#credentials')?.addEventListener('submit', submitCredentials)
}

function renderDemo (): void {
  app.innerHTML = `<main class="demo">
    <h1>K3s Auth Demo</h1>
    <p><a href="/dashboard">Open dashboard</a></p>
    ${currentUser === undefined ? authForm() : sessionControls()}
    <section class="demo-panel"><h2>Hello endpoints</h2><div id="tabs" class="actions"></div><pre id="output">Loading public endpoint...</pre></section>
  </main>`
  bindCommon()
  const routes = [['Hello World', '/api/hello/world'], ['Hello User', '/api/hello/user'], ['Hello Admins', '/api/hello/admin']]
  for (const [label, path] of routes) {
    const button = document.createElement('button')
    button.textContent = label
    button.addEventListener('click', async () => await showResult(path))
    document.querySelector('#tabs')!.append(button)
  }
  void showResult('/api/hello/world')
}

async function showResult (path: string): Promise<void> {
  const output = document.querySelector<HTMLElement>('#output')
  if (output === null) return
  output.textContent = 'Loading...'
  const response = await request(path)
  const body = await response.json()
  output.textContent = response.ok ? body.message : `${response.status}: ${body.message ?? body.error}`
}

function formatCpu (value?: number): string { return value === undefined ? 'n/a' : `${Math.round(value)}m` }
function formatMemory (value?: number): string { return value === undefined ? 'n/a' : `${Math.round(value)} MiB` }
function ratio (usage: number | undefined, limit: number): number { return usage === undefined || limit === 0 ? 0 : Math.min(100, usage / limit * 100) }

function summaryCard (label: string, usage: number | undefined, requestValue: number, limit: number, formatter: (value?: number) => string): string {
  return `<article class="summary-card"><span>${label}</span><strong>${formatter(usage)}</strong>
    <div class="meter"><i style="width:${ratio(usage, limit)}%"></i></div>
    <small>${formatter(requestValue)} allocated · ${formatter(limit)} limit</small></article>`
}

function node (id: string, x: number, y: number, title: string, subtitle: string, kind = '', available = true): string {
  return `<g id="node-${id}" class="node ${kind}${available ? '' : ' unavailable'}" transform="translate(${x} ${y})"><rect width="156" height="66" rx="12"/><text x="16" y="28">${escapeHtml(title)}</text><text class="muted" x="16" y="48">${available ? escapeHtml(subtitle) : 'Unavailable'}</text></g>`
}

function edge (id: string, x1: number, y1: number, x2: number, y2: number, kind = ''): string {
  return `<path id="edge-${id}" class="edge ${kind}" d="M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}"${kind === 'config' ? '' : ' marker-end="url(#arrow)"'}/>`
}

function podNode (pod: Pod, x: number, y: number): string {
  const cpu = ratio(pod.cpuUsageMillicores, pod.cpuLimitMillicores)
  const memory = ratio(pod.memoryUsageMiB, pod.memoryLimitMiB)
  const cpuRequest = ratio(pod.cpuRequestMillicores, pod.cpuLimitMillicores)
  const memoryRequest = ratio(pod.memoryRequestMiB, pod.memoryLimitMiB)
  const warning = cpu > 80 || memory > 80 || (pod.cpuUsageMillicores ?? 0) > pod.cpuRequestMillicores || (pod.memoryUsageMiB ?? 0) > pod.memoryRequestMiB ? ' warning' : ''
  return `<g id="node-pod-${escapeHtml(pod.name)}" class="node pod${warning}${pod.terminating ? ' terminating' : ''}" transform="translate(${x} ${y})">
    <rect width="250" height="128" rx="12"/><circle class="${pod.ready ? 'ready' : 'not-ready'}" cx="18" cy="20" r="5"/>
    <text x="30" y="24">${escapeHtml(pod.name)}</text><text class="muted" x="14" y="44">${pod.phase} · ${pod.restarts} restarts</text>
    <text class="metric" x="14" y="67">CPU ${formatCpu(pod.cpuUsageMillicores)} / ${formatCpu(pod.cpuRequestMillicores)} / ${formatCpu(pod.cpuLimitMillicores)}</text>
    <rect class="meter-bg" x="14" y="75" width="222" height="5" rx="3"/><rect class="meter-fill" x="14" y="75" width="${222 * cpu / 100}" height="5" rx="3"/><rect class="request-marker" x="${14 + 222 * cpuRequest / 100}" y="72" width="2" height="11"/>
    <text class="metric" x="14" y="99">MEM ${formatMemory(pod.memoryUsageMiB)} / ${formatMemory(pod.memoryRequestMiB)} / ${formatMemory(pod.memoryLimitMiB)}</text>
    <rect class="meter-bg" x="14" y="107" width="156" height="5" rx="3"/><rect class="meter-fill memory" x="14" y="107" width="${156 * memory / 100}" height="5" rx="3"/><rect class="request-marker" x="${14 + 156 * memoryRequest / 100}" y="104" width="2" height="11"/>
    <g class="kill" data-kill="${escapeHtml(pod.name)}" data-app="${pod.app}" transform="translate(181 96)"><rect width="55" height="24" rx="6"/><text x="12" y="17">Kill</text></g>
  </g>`
}

function topology (snapshot: Snapshot, selected?: Trace): string {
  const grouped = {
    frontend: snapshot.pods.filter(pod => pod.app === 'frontend'),
    backend: snapshot.pods.filter(pod => pod.app === 'backend'),
    mongodb: snapshot.pods.filter(pod => pod.app === 'mongodb')
  }
  const maxReplicas = Math.max(grouped.frontend.length, grouped.backend.length, grouped.mongodb.length, 1)
  const width = Math.max(1360, 1040 + maxReplicas * 270)
  const height = 720
  let svg = `<svg id="topology" viewBox="0 0 ${width} ${height}" style="min-width:${width}px" role="img" aria-label="Live Kubernetes architecture"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z"/></marker></defs>`
  svg += edge('browser-lb', 196, 103, 260, 103) + edge('lb-traefik', 416, 103, 500, 103)
  svg += edge('traefik-frontend', 656, 103, 800, 215) + edge('traefik-backend', 656, 103, 800, 400) + edge('backend-mongodb', 956, 400, 800, 585)
  svg += edge('ingress-configures-traefik', 578, 256, 578, 136, 'config')
  svg += node('browser', 40, 70, 'Browser', 'Request source', 'infra') + node('lb', 260, 70, 'k3d load balancer', ':8080 → :80', 'infra')
  svg += node('traefik', 500, 70, 'Traefik', 'Routes live traffic', 'infra') + node('ingress', 500, 256, 'Ingress', 'Configures / and /api', 'config', snapshot.components.ingress !== false)
  svg += node('frontend-service', 800, 182, 'Frontend Service', 'port 8080', 'service', snapshot.components['frontend-service'] !== false) + node('backend-service', 800, 367, 'Backend Service', 'port 3000', 'service', snapshot.components['backend-service'] !== false) + node('mongodb-service', 800, 552, 'MongoDB Service', 'port 27017', 'service', snapshot.components['mongodb-service'] !== false)
  const groups: Array<[keyof typeof grouped, number, string]> = [['frontend', 170, 'frontend'], ['backend', 355, 'backend'], ['mongodb', 540, 'mongodb']]
  for (const [appName, startY] of groups) {
    grouped[appName].forEach((pod, index) => {
      const x = 1040 + index * 270
      svg += edge(`${appName}-pod-${pod.name}`, 956, startY + 45, x, startY + 64)
      svg += podNode(pod, x, startY)
    })
  }
  svg += '</svg>'
  queueMicrotask(() => highlightFlow(selected))
  return svg
}

function highlightFlow (trace?: Trace): void {
  document.querySelectorAll('.active-flow').forEach(element => element.classList.remove('active-flow'))
  if (trace === undefined) return
  const ids = ['node-browser', 'node-lb', 'node-traefik', 'node-backend-service', `node-pod-${trace.backendPod}`, 'edge-browser-lb', 'edge-lb-traefik', 'edge-traefik-backend', `edge-backend-pod-${trace.backendPod}`]
  if (trace.accessedMongoDB) ids.push('node-mongodb-service', 'edge-backend-mongodb')
  ids.forEach(id => document.getElementById(id)?.classList.add('active-flow'))
}

function renderSnapshot (snapshot: Snapshot): void {
  const selected = snapshot.traces.find(trace => trace.id === selectedTrace)
  document.querySelector<HTMLElement>('#summaries')!.innerHTML =
    summaryCard('Application CPU', snapshot.totals.cpuUsageMillicores, snapshot.totals.cpuRequestMillicores, snapshot.totals.cpuLimitMillicores, formatCpu) +
    summaryCard('Application memory', snapshot.totals.memoryUsageMiB, snapshot.totals.memoryRequestMiB, snapshot.totals.memoryLimitMiB, formatMemory)
  document.querySelector<HTMLElement>('#architecture')!.innerHTML = topology(snapshot, selected)
  document.querySelector<HTMLElement>('#errors')!.innerHTML = snapshot.errors.map(error => `<span>${escapeHtml(error.component)} unavailable</span>`).join('')
  document.querySelector<HTMLElement>('#updated')!.textContent = `Updated ${new Date(snapshot.generatedAt).toLocaleTimeString()}`
  document.querySelector<HTMLElement>('#requests')!.innerHTML = snapshot.traces.map(trace => `<button class="trace ${trace.id === selectedTrace ? 'selected' : ''}" data-trace="${trace.id}">
    <span class="status s${Math.floor(trace.status / 100)}">${trace.status}</span><strong>${trace.method} ${escapeHtml(trace.route)}</strong>
    <small>${new Date(trace.startedAt).toLocaleTimeString()} · ${trace.durationMs}ms · ${escapeHtml(trace.backendPod)}</small></button>`).join('') || '<p class="empty">No requests recorded yet.</p>'
  document.querySelectorAll<HTMLElement>('[data-trace]').forEach(element => element.addEventListener('click', () => {
    selectedTrace = element.dataset.trace
    renderSnapshot(snapshot)
  }))
  document.querySelectorAll<HTMLElement>('[data-kill]').forEach(element => element.addEventListener('click', async () => {
    const name = element.dataset.kill!
    const warning = element.dataset.app === 'mongodb' ? '\n\nThis will temporarily interrupt authentication and request history.' : ''
    if (!window.confirm(`Delete pod ${name}? Kubernetes will recreate it.${warning}`)) return
    element.classList.add('busy')
    const response = await request(`/api/dashboard/pods/${encodeURIComponent(name)}`, { method: 'DELETE' })
    if (!response.ok) window.alert(`Could not delete pod: ${response.status}`)
  }))
}

async function streamSnapshots (): Promise<void> {
  streamAbort?.abort()
  streamAbort = new AbortController()
  const status = document.querySelector<HTMLElement>('#connection')!
  while (!streamAbort.signal.aborted) {
    try {
      status.textContent = 'Connecting'
      status.className = 'connection'
      let response = await request('/api/dashboard/events', { signal: streamAbort.signal })
      if (response.status === 401 && await refresh()) response = await request('/api/dashboard/events', { signal: streamAbort.signal })
      if (!response.ok || response.body === null) throw new Error(`Stream returned ${response.status}`)
      status.textContent = 'Live'
      status.className = 'connection live'
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
      let buffer = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += value
        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''
        for (const event of events) {
          const data = event.split('\n').find(line => line.startsWith('data: '))
          if (data !== undefined) renderSnapshot(JSON.parse(data.slice(6)) as Snapshot)
        }
      }
    } catch (error) {
      if (streamAbort.signal.aborted) return
      status.textContent = 'Reconnecting'
      status.className = 'connection reconnecting'
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
  }
}

function renderDashboard (): void {
  if (currentUser === undefined) {
    app.innerHTML = `<main><p><a href="/">Back to demo</a></p>${authForm('Sign in with an admin account to open the dashboard.', true)}</main>`
    bindCommon()
    return
  }
  if (currentUser.role !== 'admin') {
    app.innerHTML = `<main><p><a href="/">Back to demo</a></p>${sessionControls()}<section><h1>Admin role required</h1><p>This dashboard can inspect and delete application pods.</p></section></main>`
    bindCommon()
    return
  }
  app.innerHTML = `<main class="dashboard">
    <p><a href="/">Back to demo</a></p>
    ${sessionControls()}
    <section class="dashboard-title"><h1>Live architecture</h1><div class="live-state"><span id="errors"></span><span id="updated"></span><span id="connection" class="connection">Connecting</span></div></section>
    <section id="summaries" class="summaries">${summaryCard('Application CPU', undefined, 0, 0, formatCpu)}${summaryCard('Application memory', undefined, 0, 0, formatMemory)}</section>
    <div class="dashboard-grid"><section class="panel architecture-panel"><div class="panel-heading"><h2>Architecture</h2><span>Usage / allocated / limit</span></div><div id="architecture" class="architecture"><p class="empty">Loading cluster topology…</p></div></section>
    <aside class="panel requests-panel"><div class="panel-heading"><h2>Recent requests</h2><span>Click to trace flow</span></div><div id="requests" class="requests"><p class="empty">Waiting for requests…</p></div></aside></div>
  </main>`
  bindCommon()
  void streamSnapshots()
}

function render (): void {
  streamAbort?.abort()
  if (window.location.pathname === '/dashboard') renderDashboard()
  else renderDemo()
}

void refresh().finally(render)
