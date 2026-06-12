import { readFile } from 'node:fs/promises'
import { request as httpsRequest } from 'node:https'
import '@fastify/sensible'
import fp from 'fastify-plugin'
import './config'
import './database'

const SERVICE_ACCOUNT = '/var/run/secrets/kubernetes.io/serviceaccount'
const ALLOWED_APPS = new Set(['frontend', 'backend', 'mongodb'])

interface KubernetesList<T> { items: T[] }
interface ContainerResources { requests?: Record<string, string>, limits?: Record<string, string> }
interface ContainerSpec { name: string, resources?: ContainerResources }
interface Pod {
  metadata: { name: string, labels?: Record<string, string>, deletionTimestamp?: string }
  spec: { containers?: ContainerSpec[] }
  status?: {
    phase?: string
    containerStatuses?: Array<{ ready?: boolean, restartCount?: number }>
  }
}
interface PodMetric {
  metadata: { name: string }
  timestamp?: string
  containers?: Array<{ usage?: Record<string, string> }>
}
interface KubernetesObject { metadata: { name: string } }

export interface ResourceValues {
  cpuUsageMillicores?: number
  cpuRequestMillicores: number
  cpuLimitMillicores: number
  memoryUsageMiB?: number
  memoryRequestMiB: number
  memoryLimitMiB: number
}

export interface DashboardPod extends ResourceValues {
  name: string
  app: string
  phase: string
  ready: boolean
  restarts: number
  terminating: boolean
}

export interface DashboardSnapshot {
  generatedAt: string
  pods: DashboardPod[]
  totals: ResourceValues
  components: Record<string, boolean>
  traces: Array<{
    id: string
    method: string
    route: string
    status: number
    startedAt: string
    durationMs: number
    backendPod: string
    accessedMongoDB: boolean
  }>
  errors: Array<{ component: string, message: string }>
}

export function parseCpuMillicores (quantity?: string): number {
  if (quantity === undefined) return 0
  if (quantity.endsWith('n')) return Number(quantity.slice(0, -1)) / 1_000_000
  if (quantity.endsWith('u')) return Number(quantity.slice(0, -1)) / 1_000
  if (quantity.endsWith('m')) return Number(quantity.slice(0, -1))
  return Number(quantity) * 1000
}

export function parseMemoryMiB (quantity?: string): number {
  if (quantity === undefined) return 0
  const match = quantity.match(/^([0-9.]+)([EPTGMK]i?|)$/)
  if (match === null) return 0
  const value = Number(match[1])
  const unit = match[2]
  const powers: Record<string, number> = {
    Ki: 1 / 1024, Mi: 1, Gi: 1024, Ti: 1024 ** 2,
    K: 1000 / 1024 ** 2, M: 1000 ** 2 / 1024 ** 2, G: 1000 ** 3 / 1024 ** 2
  }
  return value * (powers[unit] ?? 1 / 1024 ** 2)
}

function sumResources (containers: ContainerSpec[] = []): Omit<ResourceValues, 'cpuUsageMillicores' | 'memoryUsageMiB'> {
  return containers.reduce((total, container) => ({
    cpuRequestMillicores: total.cpuRequestMillicores + parseCpuMillicores(container.resources?.requests?.cpu),
    cpuLimitMillicores: total.cpuLimitMillicores + parseCpuMillicores(container.resources?.limits?.cpu),
    memoryRequestMiB: total.memoryRequestMiB + parseMemoryMiB(container.resources?.requests?.memory),
    memoryLimitMiB: total.memoryLimitMiB + parseMemoryMiB(container.resources?.limits?.memory)
  }), { cpuRequestMillicores: 0, cpuLimitMillicores: 0, memoryRequestMiB: 0, memoryLimitMiB: 0 })
}

function sumUsage (metric?: PodMetric): Pick<ResourceValues, 'cpuUsageMillicores' | 'memoryUsageMiB'> {
  if (metric === undefined) return {}
  return (metric.containers ?? []).reduce((total, container) => ({
    cpuUsageMillicores: (total.cpuUsageMillicores ?? 0) + parseCpuMillicores(container.usage?.cpu),
    memoryUsageMiB: (total.memoryUsageMiB ?? 0) + parseMemoryMiB(container.usage?.memory)
  }), { cpuUsageMillicores: 0, memoryUsageMiB: 0 })
}

class KubernetesClient {
  private token?: string
  private ca?: Buffer
  private readonly host = process.env.KUBERNETES_SERVICE_HOST
  private readonly port = process.env.KUBERNETES_SERVICE_PORT_HTTPS ?? '443'

  private async loadCredentials (): Promise<void> {
    if (this.host === undefined) throw new Error('Kubernetes API is not available outside the cluster')
    this.token ??= (await readFile(`${SERVICE_ACCOUNT}/token`, 'utf8')).trim()
    this.ca ??= await readFile(`${SERVICE_ACCOUNT}/ca.crt`)
  }

  async request<T> (path: string, method = 'GET'): Promise<T> {
    await this.loadCredentials()
    return await new Promise<T>((resolve, reject) => {
      const request = httpsRequest({
        hostname: this.host,
        port: this.port,
        path,
        method,
        ca: this.ca,
        headers: { authorization: `Bearer ${this.token}`, accept: 'application/json' }
      }, response => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', chunk => { body += chunk })
        response.on('end', () => {
          if ((response.statusCode ?? 500) >= 300) {
            reject(new Error(`Kubernetes API returned ${response.statusCode}: ${body}`))
            return
          }
          resolve(body.length === 0 ? {} as T : JSON.parse(body) as T)
        })
      })
      request.on('error', reject)
      request.end()
    })
  }
}

export default fp(async (fastify) => {
  const client = new KubernetesClient()
  const namespace = encodeURIComponent(fastify.config.kubernetesNamespace)

  async function snapshot (): Promise<DashboardSnapshot> {
    const errors: DashboardSnapshot['errors'] = []
    let pods: Pod[] = []
    let metrics: PodMetric[] = []
    const components: Record<string, boolean> = {}

    try {
      const result = await client.request<KubernetesList<Pod>>(`/api/v1/namespaces/${namespace}/pods?labelSelector=app`)
      pods = result.items.filter(pod => ALLOWED_APPS.has(pod.metadata.labels?.app ?? ''))
    } catch (error) {
      errors.push({ component: 'kubernetes', message: (error as Error).message })
    }
    try {
      const result = await client.request<KubernetesList<PodMetric>>(`/apis/metrics.k8s.io/v1beta1/namespaces/${namespace}/pods`)
      metrics = result.items
    } catch (error) {
      errors.push({ component: 'metrics', message: (error as Error).message })
    }
    try {
      const [services, ingresses, deployments, statefulSets] = await Promise.all([
        client.request<KubernetesList<KubernetesObject>>(`/api/v1/namespaces/${namespace}/services`),
        client.request<KubernetesList<KubernetesObject>>(`/apis/networking.k8s.io/v1/namespaces/${namespace}/ingresses`),
        client.request<KubernetesList<KubernetesObject>>(`/apis/apps/v1/namespaces/${namespace}/deployments`),
        client.request<KubernetesList<KubernetesObject>>(`/apis/apps/v1/namespaces/${namespace}/statefulsets`)
      ])
      for (const name of ['frontend', 'backend', 'mongodb']) components[`${name}-service`] = services.items.some(item => item.metadata.name === name)
      components.ingress = ingresses.items.some(item => item.metadata.name === 'app')
      for (const name of ['frontend', 'backend']) components[`${name}-workload`] = deployments.items.some(item => item.metadata.name === name)
      components['mongodb-workload'] = statefulSets.items.some(item => item.metadata.name === 'mongodb')
    } catch (error) {
      errors.push({ component: 'topology', message: (error as Error).message })
    }

    const metricByPod = new Map(metrics
      .filter(metric => metric.timestamp === undefined || Date.now() - new Date(metric.timestamp).getTime() < 2 * 60 * 1000)
      .map(metric => [metric.metadata.name, metric]))
    const dashboardPods: DashboardPod[] = pods.map(pod => ({
      name: pod.metadata.name,
      app: pod.metadata.labels?.app ?? 'unknown',
      phase: pod.status?.phase ?? 'Unknown',
      ready: (pod.status?.containerStatuses ?? []).every(status => status.ready === true),
      restarts: (pod.status?.containerStatuses ?? []).reduce((sum, status) => sum + (status.restartCount ?? 0), 0),
      terminating: pod.metadata.deletionTimestamp !== undefined,
      ...sumResources(pod.spec.containers),
      ...sumUsage(metricByPod.get(pod.metadata.name))
    }))

    const totals = dashboardPods.reduce<ResourceValues>((total, pod) => ({
      cpuUsageMillicores: pod.cpuUsageMillicores === undefined ? total.cpuUsageMillicores : (total.cpuUsageMillicores ?? 0) + pod.cpuUsageMillicores,
      cpuRequestMillicores: total.cpuRequestMillicores + pod.cpuRequestMillicores,
      cpuLimitMillicores: total.cpuLimitMillicores + pod.cpuLimitMillicores,
      memoryUsageMiB: pod.memoryUsageMiB === undefined ? total.memoryUsageMiB : (total.memoryUsageMiB ?? 0) + pod.memoryUsageMiB,
      memoryRequestMiB: total.memoryRequestMiB + pod.memoryRequestMiB,
      memoryLimitMiB: total.memoryLimitMiB + pod.memoryLimitMiB
    }), { cpuRequestMillicores: 0, cpuLimitMillicores: 0, memoryRequestMiB: 0, memoryLimitMiB: 0 })
    if (dashboardPods.some(pod => pod.cpuUsageMillicores === undefined)) totals.cpuUsageMillicores = undefined
    if (dashboardPods.some(pod => pod.memoryUsageMiB === undefined)) totals.memoryUsageMiB = undefined

    let traces: DashboardSnapshot['traces'] = []
    try {
      traces = (await fastify.collections.requestTraces.find().sort({ startedAt: -1 }).limit(100).toArray()).map(trace => ({
        id: trace._id?.toHexString() ?? '',
        method: trace.method,
        route: trace.route,
        status: trace.status,
        startedAt: trace.startedAt.toISOString(),
        durationMs: trace.durationMs,
        backendPod: trace.backendPod,
        accessedMongoDB: trace.accessedMongoDB
      }))
    } catch (error) {
      errors.push({ component: 'request-history', message: (error as Error).message })
    }

    return { generatedAt: new Date().toISOString(), pods: dashboardPods, totals, components, traces, errors }
  }

  async function deletePod (name: string): Promise<void> {
    const pod = await client.request<Pod>(`/api/v1/namespaces/${namespace}/pods/${encodeURIComponent(name)}`)
    const app = pod.metadata.labels?.app ?? ''
    if (!ALLOWED_APPS.has(app)) throw fastify.httpErrors.forbidden('Pod is not an allowed application pod')
    if (pod.metadata.deletionTimestamp !== undefined) throw fastify.httpErrors.conflict('Pod is already terminating')
    await client.request(`/api/v1/namespaces/${namespace}/pods/${encodeURIComponent(name)}`, 'DELETE')
  }

  fastify.decorate('dashboardSnapshot', snapshot)
  fastify.decorate('deleteDashboardPod', deletePod)
}, { name: 'kubernetes', dependencies: ['config', 'database', 'sensible'] })

declare module 'fastify' {
  interface FastifyInstance {
    dashboardSnapshot: () => Promise<DashboardSnapshot>
    deleteDashboardPod: (name: string) => Promise<void>
  }
}
