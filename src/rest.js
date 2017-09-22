import { Errors, Module } from '@complycloud/brane';
import { json } from 'body-parser';
import cors from 'cors';
import createDebug from 'debug';
import express from 'express';
import http from 'http';
import { kebabCase, pick } from 'lodash';
import { v4 as uuid } from 'uuid';

const debug = createDebug('complycloud:brane:rest');

function handleError({ err }) {
  const status = err.statusCode || 500;
  const payload = {
    success: false,
    message: status < 500 ? err.message : err.safeMessage || 'unexpected server error',
  };
  this.log[status < 500 ? 'warn' : 'error'](err);
  this.status(status).json(payload);
}

function createBodyParserSyntaxErrorInterceptMiddleware() {
  return function bodyParserSyntaxErrorInterceptMiddleware(err, req, res, next) {
    if (err.status === 400) {
      handleError.call(res, { err: new Errors.BadRequest(err.message) });
    } else {
      next();
    }
  };
}

function createPreHandlerMiddleware({ log }) {
  return function preHandler(req, res, next) {
    req.id = uuid();
    req.log = log.child({ requestId: req.id });
    res.log = req.log;
    req.log.info(pick(req, ['ip', 'ips', 'originalUrl', 'method', 'headers']), 'handling request');
    req.start = new Date();
    res.on('finish', function postHandler() { // eslint-disable-line prefer-arrow-callback
      res.end = new Date();
      const durationMs = res.end.getTime() - req.start.getTime();
      res.log.info({ durationMs, statusCode: res.statusCode }, 'request completed');
    });
    next();
  };
}

function createHealthCheckRouter() {
  const router = express.Router();
  router.get('/health', function healthCheckHandler(req, res) { // eslint-disable-line prefer-arrow-callback
    const { log } = req;
    const healthy = true; // TODO implement a real health check
    const status = healthy ? 200 : 503;
    log[healthy ? 'info' : 'warn']({ healthy }, 'health check completed');
    res.status(status).json({ healthy });
  });
  return router;
}

function createActionsRouter({ events, processEvent }) {
  const router = express.Router();
  Object.keys(events).forEach((eventName) => {
    const Event = events[eventName];
    if (!Event.action) {
      debug('event %s has no action defined, will not be exposed', eventName);
      return;
    }
    const { name: actionName, path: definedPath } = Event.action;
    const path = `/${definedPath || kebabCase(actionName)}`;
    const method = 'post';
    debug('exposing action %s for event %s at %s %s', actionName, eventName, method.toUpperCase(), path);
    router[method](path, async (req, res) => {
      const payload = req.body;
      try {
        const event = new Event(payload);
        req.log.info({ eventId: event.id, event: Event.name }, 'created event');
        const result = await processEvent(event);
        res.status(200).json({
          success: true,
          result,
        });
      } catch (err) {
        handleError.call(res, { err });
      }
    });
  });
  return router;
}

function createApp({ events, log, processEvent }) {
  log.trace('creating rest interface app');
  const app = express();
  app.use(createPreHandlerMiddleware({ log }));
  app.use(cors());
  app.use(json());
  app.use(createBodyParserSyntaxErrorInterceptMiddleware());
  app.use(createHealthCheckRouter());
  app.use(createActionsRouter({ events, processEvent }));
  return app;
}

export default class RESTInterface extends Module {
  get name() { return 'rest'; }
  get dependencies() { return ['config', 'events', 'log', 'processEvent']; }

  async start({
    config, events, log, processEvent,
  }) {
    const {
      rest: { port },
    } = config;
    log.info('rest interface starting');
    const app = createApp({ events, log, processEvent });
    const server = http.createServer(app);
    server.listen(port);
    log.info({ port }, 'rest interface started');
  }
}
