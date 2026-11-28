import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import express from 'express';
import { createItineraryRouter } from '../src/routes/itineraryRoutes.js';

async function withItineraryRoutes(controller, authenticateToken, runRequest) {
  const app = express();
  app.use(express.json());
  app.use('/api/itineraries', createItineraryRouter(controller, authenticateToken));

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
  const methods = ['create', 'findAll', 'findByOwner', 'findById', 'update', 'addPlace', 'removePlace', 'delete'];
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
      if (method === 'delete' || method === 'removePlace') return res.status(204).end();
      return res.status(method === 'create' ? 201 : 200).json({
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
    events.push({ type: 'middleware', path: req.path });
    if (req.get('Authorization') !== 'Bearer valid') {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = { id: 'u-authenticated', role: 'user' };
    return next();
  };
}

test('registra todos os endpoints e encaminha parâmetros e corpo corretamente', async () => {
  const events = [];
  const controller = makeController(events);
  await withItineraryRoutes(controller, authenticatedMiddleware(events), async (baseUrl) => {
    const auth = { Authorization: 'Bearer valid' };
    const requests = [
      { method: 'POST', path: '/api/itineraries', expected: 'create', params: {}, body: { title: 'Passeio' }, status: 201 },
      { method: 'GET', path: '/api/itineraries', expected: 'findAll', params: {}, status: 200 },
      { method: 'GET', path: '/api/itineraries/i1', expected: 'findById', params: { id: 'i1' }, status: 200 },
      { method: 'PUT', path: '/api/itineraries/i1', expected: 'update', params: { id: 'i1' }, body: { title: 'Atualizado' }, status: 200 },
      { method: 'POST', path: '/api/itineraries/i1/places', expected: 'addPlace', params: { id: 'i1' }, body: { placeId: 'p1' }, status: 200 },
      { method: 'DELETE', path: '/api/itineraries/i1/places/p1', expected: 'removePlace', params: { id: 'i1', placeId: 'p1' }, status: 204 },
      { method: 'DELETE', path: '/api/itineraries/i1', expected: 'delete', params: { id: 'i1' }, status: 204 },
    ];

    for (const [index, request] of requests.entries()) {
      const response = await fetch(`${baseUrl}${request.path}`, {
        method: request.method,
        headers: {
          Authorization: 'Bearer valid',
          ...(request.body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      });
      assert.equal(response.status, request.status, `${request.method} ${request.path}`);

      const controllerEvent = events.at(-1);
      assert.equal(controllerEvent.type, 'controller');
      assert.equal(controllerEvent.method, request.expected);
      assert.deepEqual(controllerEvent.params, request.params);
      assert.deepEqual(controllerEvent.body, request.body);
      assert.deepEqual(controllerEvent.user, { id: 'u-authenticated', role: 'user' });
      assert.equal(events.at(-2).type, 'middleware');

      if (request.status !== 204) {
        const result = await response.json();
        assert.equal(result.method, request.expected);
        assert.deepEqual(result.params, request.params);
        assert.deepEqual(result.body, request.body);
      }
      assert.equal(events.filter(({ type }) => type === 'controller').length, index + 1);
    }
  });
});

test('middleware bloqueia todos os endpoints antes de executar o controller', async () => {
  const events = [];
  await withItineraryRoutes(makeController(events), authenticatedMiddleware(events), async (baseUrl) => {
    const requests = [
      ['POST', '/api/itineraries'],
      ['GET', '/api/itineraries'],
      ['GET', '/api/itineraries/i1'],
      ['PUT', '/api/itineraries/i1'],
      ['POST', '/api/itineraries/i1/places'],
      ['DELETE', '/api/itineraries/i1/places/p1'],
      ['DELETE', '/api/itineraries/i1'],
    ];
    for (const [method, path] of requests) {
      const response = await fetch(`${baseUrl}${path}`, { method });
      assert.equal(response.status, 401, `${method} ${path}`);
      assert.deepEqual(await response.json(), { error: 'Unauthorized' });
    }
    assert.equal(events.filter(({ type }) => type === 'middleware').length, requests.length);
    assert.equal(events.filter(({ type }) => type === 'controller').length, 0);
  });
});

test('caminhos e métodos inexistentes retornam 404', async () => {
  await withItineraryRoutes(makeController(), authenticatedMiddleware(), async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/itineraries/i1`, { method: 'POST' })).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/itineraries/user/u1`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/itineraries/i1`, { method: 'POST' })).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/itineraries/i1/places/p1/extra`, { method: 'DELETE' })).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/unknown`)).status, 404);
  });
});

test('rejeita controller inválido ou incompleto e middleware inválido', () => {
  const validMiddleware = () => {};
  for (const controller of [
    null,
    {},
    { create() {}, findAll() {}, findByOwner() {}, findById() {}, update() {}, addPlace() {}, removePlace() {} },
  ]) {
    assert.throws(() => createItineraryRouter(controller, validMiddleware), /ItineraryController with itinerary operation methods/);
  }

  const controller = makeController();
  for (const middleware of [undefined, null, {}]) {
    assert.throws(() => createItineraryRouter(controller, middleware), /authenticateToken middleware function/);
  }
});
