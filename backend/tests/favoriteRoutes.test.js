import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import express from 'express';
import { createFavoriteRouter } from '../src/routes/favoriteRoutes.js';

async function withFavoriteRoutes(controller, authenticateToken, runRequest) {
  const app = express();
  app.use(express.json());
  app.use('/api/favorites', createFavoriteRouter(controller, authenticateToken));

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
  const methods = ['add', 'remove', 'findAll', 'check'];
  const controller = {};
  for (const method of methods) {
    controller[method] = function handler(req, res) {
      assert.equal(this, controller, `${method} should retain controller context`);
      events.push({
        type: 'controller',
        method,
        path: req.path,
        params: { ...req.params },
        body: req.body,
        user: req.user,
      });
      if (method === 'remove') return res.status(204).end();
      return res.status(method === 'add' ? 201 : 200).json({
        method,
        params: req.params,
        body: req.body,
        user: req.user,
      });
    };
  }
  return controller;
}

function authenticatedMiddleware(events = []) {
  return (req, res, next) => {
    events.push({ type: 'middleware', path: req.path, params: { ...req.params } });
    if (req.get('Authorization') !== 'Bearer valid') {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = { id: 'u-authenticated', role: 'user' };
    return next();
  };
}

test('cria router e encaminha as quatro rotas aos handlers corretos', async () => {
  const events = [];
  await withFavoriteRoutes(makeController(events), authenticatedMiddleware(events), async (baseUrl) => {
    const requests = [
      { method: 'POST', path: '/api/favorites', expected: 'add', body: { placeId: 'p1' } },
      { method: 'GET', path: '/api/favorites', expected: 'findAll' },
      { method: 'GET', path: '/api/favorites/p2/check', expected: 'check', placeId: 'p2' },
      { method: 'DELETE', path: '/api/favorites/p3', expected: 'remove', placeId: 'p3' },
    ];

    for (const request of requests) {
      const response = await fetch(`${baseUrl}${request.path}`, {
        method: request.method,
        headers: {
          Authorization: 'Bearer valid',
          ...(request.body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      });
      assert.equal(response.status, request.expected === 'add' ? 201 : request.expected === 'remove' ? 204 : 200);

      const controllerEvent = events.at(-1);
      assert.equal(controllerEvent.type, 'controller');
      assert.equal(controllerEvent.method, request.expected);
      if (request.expected === 'add') {
        assert.deepEqual(controllerEvent.params, {});
        assert.deepEqual(events.at(-2).params, {});
      } else {
        assert.equal(controllerEvent.params.placeId, request.placeId);
      }
      assert.deepEqual(controllerEvent.user, { id: 'u-authenticated', role: 'user' });
      assert.equal(events.at(-2).type, 'middleware');

      if (request.expected === 'remove') continue;
      const result = await response.json();
      assert.equal(result.method, request.expected);
      if (request.body) assert.deepEqual(result.body, request.body);
      assert.deepEqual(result.user, { id: 'u-authenticated', role: 'user' });
    }
  });
});

test('todas as rotas executam a autenticação e bloqueiam requisições sem token válido', async () => {
  const events = [];
  await withFavoriteRoutes(makeController(events), authenticatedMiddleware(events), async (baseUrl) => {
    const requests = [
      ['POST', '/api/favorites', { placeId: 'p1' }],
      ['GET', '/api/favorites'],
      ['GET', '/api/favorites/p1/check'],
      ['DELETE', '/api/favorites/p1'],
    ];
    for (const [method, path, body] of requests) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      });
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: 'Unauthorized' });
    }
    assert.deepEqual(events.map(({ type }) => type), requests.map(() => 'middleware'));
  });
});

test('caminhos e métodos não registrados retornam 404', async () => {
  await withFavoriteRoutes(makeController(), authenticatedMiddleware(), async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/favorites`, { method: 'PUT' })).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/favorites/p1/check`, { method: 'DELETE' })).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/favorites/p1`, { method: 'GET' })).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/favorites/p1/check/extra`)).status, 404);
  });
});

test('rejeita controller inválido ou incompleto e middleware inválido', () => {
  const validMiddleware = () => {};
  for (const controller of [
    null,
    {},
    { add() {}, remove() {}, findAll() {} },
  ]) {
    assert.throws(() => createFavoriteRouter(controller, validMiddleware), /FavoriteController with favorite operation methods/);
  }

  const controller = makeController();
  for (const middleware of [undefined, null, {}]) {
    assert.throws(() => createFavoriteRouter(controller, middleware), /authenticateToken middleware function/);
  }
});
