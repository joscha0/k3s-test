import './style.css'

type User = { username: string, role: 'user' | 'admin' }
type Session = { accessToken: string, user: User }

const auth = document.querySelector<HTMLElement>('#auth')!
const tabs = document.querySelector<HTMLElement>('#tabs')!
const output = document.querySelector<HTMLElement>('#output')!
let accessToken: string | undefined
let currentUser: User | undefined

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
    renderAuth()
    return false
  }
  const session = await response.json() as Session
  accessToken = session.accessToken
  currentUser = session.user
  renderAuth()
  return true
}

async function showResult (path: string): Promise<void> {
  output.textContent = 'Loading...'
  const response = await request(path)
  const body = await response.json()
  output.textContent = response.ok
    ? body.message
    : `${response.status}: ${body.message ?? body.error}`
}

async function submitCredentials (event: SubmitEvent, action: 'signup' | 'signin'): Promise<void> {
  event.preventDefault()
  const data = new FormData(event.currentTarget as HTMLFormElement)
  const response = await fetch(`/api/auth/${action}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: data.get('username'), password: data.get('password') })
  })
  const body = await response.json()
  if (!response.ok) {
    output.textContent = `${response.status}: ${body.message ?? body.error}`
    return
  }
  accessToken = body.accessToken
  currentUser = body.user
  renderAuth()
}

function renderAuth (): void {
  if (currentUser !== undefined) {
    auth.innerHTML = `<p>Signed in as <strong>${currentUser.username}</strong> (${currentUser.role}) <button id="signout">Sign out</button></p>`
    document.querySelector('#signout')?.addEventListener('click', async () => {
      await fetch('/api/auth/signout', { method: 'POST', credentials: 'same-origin' })
      accessToken = undefined
      currentUser = undefined
      renderAuth()
    })
    return
  }

  auth.innerHTML = `
    <form id="credentials">
      <label>Username <input name="username" required minlength="3" maxlength="32"></label>
      <label>Password <input name="password" type="password" required minlength="8" maxlength="128"></label>
      <button name="action" value="signin">Sign in</button>
      <button name="action" value="signup">Sign up</button>
    </form>`
  document.querySelector<HTMLFormElement>('#credentials')?.addEventListener('submit', async event => {
    const submitter = (event as SubmitEvent).submitter as HTMLButtonElement
    await submitCredentials(event, submitter.value as 'signup' | 'signin')
  })
}

const routes = [
  ['Hello World', '/api/hello/world'],
  ['Hello User', '/api/hello/user'],
  ['Hello Admins', '/api/hello/admin']
]
for (const [label, path] of routes) {
  const button = document.createElement('button')
  button.textContent = label
  button.addEventListener('click', async () => await showResult(path))
  tabs.append(button)
}

renderAuth()
void refresh().finally(async () => await showResult('/api/hello/world'))
