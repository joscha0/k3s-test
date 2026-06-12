import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'

const root = '/app/dist'
const types = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript' }

createServer((request, response) => {
  const requestedPath = join(root, request.url === '/' ? 'index.html' : request.url ?? '/')
  const path = existsSync(requestedPath) && statSync(requestedPath).isFile()
    ? requestedPath
    : join(root, 'index.html')
  response.setHeader('content-type', types[extname(path)] ?? 'application/octet-stream')
  createReadStream(path).pipe(response)
}).listen(8080, '0.0.0.0')
