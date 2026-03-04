import Prometheus from 'prom-client';

export const metrics = {
  'cpu': new Prometheus.Gauge({ name: 'nodejs_cpu_gauge', help: 'gauge for nodejs cpu' ,labelNames: ['type'] }),
  'memory_process': new Prometheus.Gauge({ name: 'nodejs_memory_process_gauge', help: 'gauge for nodejs memory_process' ,labelNames: ['type'] }),
  'memory_physical': new Prometheus.Gauge({ name: 'nodejs_memory_physical_gauge', help: 'gauge for nodejs_memory_physical' ,labelNames: ['type'] }),
  'eventloop_latency':  new Prometheus.Gauge({ name: 'nodejs_eventloop_latency_gauge' , help: 'gauge for nodejs_eventloop_latency' ,labelNames: ['type'] }),
  'gc': new Prometheus.Gauge({ name: 'nodejs_gc_gauge' , help: 'gause for nodejs_gc' ,labelNames: ['type']}),
  'gc_duration': new Prometheus.Summary({ name: 'nodejs_gc_duration' , help: 'gause for nodejs_gc_duration', percentiles: [ 0.5, 0.75, 0.95 ] }),
  'http_duration': new Prometheus.Summary({ name: 'http_duration', help: 'summary for http_duration', percentiles: [ 0.5, 0.75, 0.95 ] ,labelNames: ['url'] })
};
