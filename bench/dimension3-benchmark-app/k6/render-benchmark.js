import http from 'k6/http'
import { check, sleep } from 'k6'
import { Trend, Rate } from 'k6/metrics'

const route = __ENV.ROUTE || '/ssr'
const baseUrl = __ENV.BASE_URL || 'http://localhost:3000'

export const routeLatency = new Trend('route_latency')
export const routeSuccess = new Rate('route_success')

export const options = {
  stages: [
    { duration: '20s', target: 1 },
    { duration: '30s', target: 10 },
    { duration: '30s', target: 25 },
    { duration: '30s', target: 50 },
    { duration: '20s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    route_success: ['rate>0.99'],
    http_req_duration: ['p(95)<3000', 'p(99)<5000'],
  },
}

export default function () {
  const res = http.get(`${baseUrl}${route}`)

  const ok = check(res, {
    'status is 200': (r) => r.status === 200,
    'response body is not empty': (r) => r.body && r.body.length > 0,
  })

  routeSuccess.add(ok)
  routeLatency.add(res.timings.duration)

  sleep(1)
}