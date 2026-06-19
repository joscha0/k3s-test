import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'

const root = resolve('/app/dist')
const indexPath = join(root, 'index.html')
const types = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript' }

function isInsideRoot (path) {
  const relativePath = relative(root, path)
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

function resolveRequestPath (url = '/') {
  const { pathname } = new URL(url, 'http://localhost')
  const requestedPath = resolve(root, `.${decodeURIComponent(pathname)}`)
  if (!isInsideRoot(requestedPath)) return undefined
  return requestedPath
}

createServer((request, response) => {
  let requestedPath
  try {
    requestedPath = resolveRequestPath(request.url)
  } catch {
    response.writeHead(400).end('Bad request')
    return
  }
  if (requestedPath === undefined) {
    response.writeHead(403).end('Forbidden')
    return
  }
  const path = existsSync(requestedPath) && statSync(requestedPath).isFile()
    ? requestedPath
    : indexPath
  response.setHeader('content-type', types[extname(path)] ?? 'application/octet-stream')
  createReadStream(path).pipe(response)
}).listen(8080, '0.0.0.0')
