/** Optional development HTTP API. The extension uses native-host.js instead. */
import { createLogger } from './src/logger.js';
import { createEngine, config } from './src/engine.js';
import { createJobStore } from './src/jobs/jobStore.js';
import { createApiServer } from './src/api/routes.js';

const logger = createLogger('server');
const engine = createEngine();
const jobStore = createJobStore({ config, logger: createLogger('jobs') });

if (!['127.0.0.1', 'localhost', '::1'].includes(config.host)) {
  throw new Error('The optional development API is restricted to loopback. The extension uses Native Messaging and does not need a network listener.');
}

function jobRunner(job, { progress, finishSuccess, finishError }) {
  return engine.recover(job.url, {
    onProgress: (event) => progress(event.phase, event.detail),
  }).then(finishSuccess).catch((error) => {
    finishError(error?.code ?? 'INTERNAL_SERVER_ERROR', error?.message ?? 'Recovery failed.');
  });
}

const server = createApiServer({
  jobStore,
  jobRunner,
  verifyUrl: engine.verify,
  search: engine.search,
  config,
  logger,
});

server.listen(config.port, config.host, () => {
  logger.info('LinkResurrector development API listening', {
    host: config.host,
    port: config.port,
    searchCoverage: engine.coverage,
    maxDepth: config.maxDepth,
    timeBudgetMs: config.timeBudgetMs,
  });
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    logger.info('shutting down', { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
