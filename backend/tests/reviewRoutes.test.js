import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import express from 'express';
import { createReviewRouter } from '../src/routes/reviewRoutes.js';

async function withReviewRoutes(controller, authenticateToken, runRequest) {
  const app = express();
  app.use(express.json());
  app.use('/api/reviews', createReviewRouter(controller, authenticateToken));

  const server = createServer(app).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try {
    await runRequest(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

function makeController(events = []) {
  const methods = [
    'createOrUpdate', 'findByPlaceId', 'findByUserId', 'findById', 'delete',
    'report', 'listPendingReports', 'moderateReport',
  ];
  const controller = {};
  for (const method of methods) {
    controller[method] = function handler(req, res) {
      assert.equal(this, controller, `${method} should retain controller context`);
      events.push({
        type: 'controller',
        method,
        path: req.path,
        params: { ...req.params },
        user: req.user,
      });
      if (method === 'delete') return res.status(204).end();
      if (method === 'report') return res.status(201).json({ method, params: req.params, user: req.user, body: req.body });
      return res.status(method === 'createOrUpdate' ? 201 : 200).json({
        method,
        params: req.params,
        user: req.user,
        body: req.body,
      });
    };
  }
  return controller;
}

function authenticatedMiddleware(events = []) {
  return (req, res, next) => {
    events.push({ type: 'middleware', path: req.path });
    if (req.get('Authorization') !== 'Bearer valid') {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = { id: 'u-authenticated', role: 'user' };
    return next();
  };
}

test('registra POST, GET e DELETE nos caminhos de avaliações com parâmetros corretos', async () => {
  const events = [];
  const controller = makeController(events);
  await withReviewRoutes(controller, authenticatedMiddleware(events), async (baseUrl) => {
    const auth = { Authorization: 'Bearer valid' };
    const requests = [
      { method: 'POST', path: '/api/reviews/r1/reports', expected: 'report', params: { id: 'r1' }, headers: auth, body: { targetType: 'comment' } },
      { method: 'GET', path: '/api/reviews/moderation/reports', expected: 'listPendingReports', params: {}, headers: auth },
      { method: 'PATCH', path: '/api/reviews/moderation/reports/report-1', expected: 'moderateReport', params: { reportId: 'report-1' }, headers: auth, body: { decision: 'reject' } },
      { method: 'POST', path: '/api/reviews/places/p1', expected: 'createOrUpdate', params: { placeId: 'p1' }, headers: auth, body: { rating: 5 } },
      { method: 'GET', path: '/api/reviews/places/p1', expected: 'findByPlaceId', params: { placeId: 'p1' } },
      { method: 'GET', path: '/api/reviews/users/u1', expected: 'findByUserId', params: { userId: 'u1' } },
      { method: 'GET', path: '/api/reviews/r1', expected: 'findById', params: { id: 'r1' } },
      { method: 'DELETE', path: '/api/reviews/r1', expected: 'delete', params: { id: 'r1' }, headers: auth },
    ];

    for (const [index, request] of requests.entries()) {
      const response = await fetch(`${baseUrl}${request.path}`, {
        method: request.method,
        headers: { ...(request.body ? { 'Content-Type': 'application/json' } : {}), ...request.headers },
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      });
      assert.equal(response.status, ['createOrUpdate', 'report'].includes(request.expected) ? 201 : request.expected === 'delete' ? 204 : 200);

      const controllerEvent = events.at(-1);
      assert.equal(controllerEvent.type, 'controller');
      assert.equal(controllerEvent.method, request.expected);
      assert.deepEqual(controllerEvent.params, request.params);
      if (request.headers) {
        assert.equal(events.at(-2).type, 'middleware');
        assert.deepEqual(controllerEvent.user, { id: 'u-authenticated', role: 'user' });
      } else {
        assert.equal(controllerEvent.user, undefined);
      }
      if (['createOrUpdate', 'report'].includes(request.expected)) {
        assert.deepEqual((await response.json()).body, request.body);
      } else if (request.expected !== 'delete') {
        const result = await response.json();
        assert.equal(result.method, request.expected);
        assert.deepEqual(result.params, request.params);
      }
      assert.equal(events.filter(({ type }) => type === 'controller').length, index + 1);
    }
  });
});

test('rotas públicas não executam autenticação e protegidas são bloqueadas antes do controller', async () => {
  const events = [];
  await withReviewRoutes(makeController(events), authenticatedMiddleware(events), async (baseUrl) => {
    for (const [method, path] of [
      ['GET', '/api/reviews/places/p1'],
      ['GET', '/api/reviews/users/u1'],
      ['GET', '/api/reviews/r1'],
    ]) {
      assert.equal((await fetch(`${baseUrl}${path}`, { method })).status, 200);
    }
    assert.equal(events.filter(({ type }) => type === 'middleware').length, 0);

    const controllerCount = events.filter(({ type }) => type === 'controller').length;
    for (const [method, path, body] of [
      ['POST', '/api/reviews/places/p1', { rating: 4 }],
      ['DELETE', '/api/reviews/r1'],
      ['POST', '/api/reviews/r1/reports', { targetType: 'rating' }],
      ['GET', '/api/reviews/moderation/reports'],
      ['PATCH', '/api/reviews/moderation/reports/report-1', { decision: 'approve' }],
    ]) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      });
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: 'Unauthorized' });
    }
    assert.equal(events.filter(({ type }) => type === 'middleware').length, 5);
    assert.equal(events.filter(({ type }) => type === 'controller').length, controllerCount);
  });
});

test('caminhos e métodos inexistentes retornam 404', async () => {
  await withReviewRoutes(makeController(), authenticatedMiddleware(), async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/reviews/places/p1`, { method: 'PUT' })).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/reviews/users/u1`, { method: 'POST' })).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/reviews/places/p1/extra`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/reviews/unknown/path`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/reviews/r1/reports`)).status, 404);
  });
});

test('rejeita controller sem métodos necessários ou middleware inválido', () => {
  const validMiddleware = () => {};
  for (const controller of [
    null,
    {},
    { createOrUpdate() {}, findByPlaceId() {}, findByUserId() {}, findById() {} },
  ]) {
    assert.throws(() => createReviewRouter(controller, validMiddleware), /ReviewController with review operation methods/);
  }

  const controller = makeController();
  for (const middleware of [undefined, null, {}]) {
    assert.throws(() => createReviewRouter(controller, middleware), /authenticateToken middleware function/);
  }
});
