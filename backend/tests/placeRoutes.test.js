import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import express from 'express';
import { createPlaceRouter } from '../src/routes/placeRoutes.js';

async function withPlaceRoutes(controller, authenticateToken, runRequest) {
  const app = express();
  app.use(express.json());
  app.use('/api/places', createPlaceRouter(controller, authenticateToken));

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
  const methods = ['create', 'findAll', 'findByCategory', 'search', 'findById', 'update', 'delete'];
  const controller = {};
  for (const method of methods) {
    controller[method] = function handler(req, res) {
      assert.equal(this, controller, `${method} should retain controller context`);
      events.push({ type: 'controller', method, path: req.path, id: req.params.id, category: req.params.category, query: req.query, user: req.user });
      return res.status(method === 'create' ? 201 : method === 'delete' ? 204 : 200)
        .json({ method, id: req.params.id, category: req.params.category });
    };
  }
  return controller;
}

function authenticatedMiddleware(events = []) {
  return (req, res, next) => {
    events.push({ type: 'middleware', path: req.path });
    if (req.get('Authorization') !== 'Bearer valid') return res.status(401).json({ error: 'Unauthorized' });
    req.user = { id: 'u1', role: 'user' };
    return next();
  };
}

test('encaminha os endpoints aos handlers corretos e aplica middleware antes do controller', async () => {
  const events = [];
  const controller = makeController(events);
  await withPlaceRoutes(controller, authenticatedMiddleware(events), async (baseUrl) => {
    const protectedHeaders = { Authorization: 'Bearer valid' };
    const cases = [
      { method: 'POST', path: '/api/places', expectedMethod: 'create', headers: protectedHeaders, body: { title: 'Praça' }, status: 201 },
      { method: 'GET', path: '/api/places', expectedMethod: 'findAll', status: 200 },
      { method: 'GET', path: '/api/places/category/cultura', expectedMethod: 'findByCategory', status: 200 },
      { method: 'GET', path: '/api/places/search?name=parque', expectedMethod: 'search', status: 200 },
      { method: 'GET', path: '/api/places/p1', expectedMethod: 'findById', status: 200 },
      { method: 'PUT', path: '/api/places/p1', expectedMethod: 'update', headers: protectedHeaders, body: { title: 'Atualizado' }, status: 200 },
      { method: 'DELETE', path: '/api/places/p1', expectedMethod: 'delete', headers: protectedHeaders, status: 204 },
    ];

    for (const routeCase of cases) {
      const response = await fetch(`${baseUrl}${routeCase.path}`, {
        method: routeCase.method,
        headers: { ...(routeCase.body ? { 'Content-Type': 'application/json' } : {}), ...routeCase.headers },
        ...(routeCase.body ? { body: JSON.stringify(routeCase.body) } : {}),
      });
      assert.equal(response.status, routeCase.status, `${routeCase.method} ${routeCase.path}`);
      if (routeCase.status !== 204) {
        assert.equal((await response.json()).method, routeCase.expectedMethod);
      }
      assert.equal(events.at(-1).type, 'controller');
      assert.equal(events.at(-1).method, routeCase.expectedMethod);
      if (routeCase.headers) {
        assert.equal(events.at(-2).type, 'middleware');
        assert.deepEqual(events.at(-1).user, { id: 'u1', role: 'user' });
      }
      if (routeCase.expectedMethod === 'findByCategory') assert.equal(events.at(-1).category, 'cultura');
      if (routeCase.expectedMethod === 'search') assert.equal(events.at(-1).query.name, 'parque');
      if (['findById', 'update', 'delete'].includes(routeCase.expectedMethod)) assert.equal(events.at(-1).id, 'p1');
    }
  });
});

test('consultas públicas funcionam sem autenticação e não executam o middleware', async () => {
  const events = [];
  await withPlaceRoutes(makeController(events), authenticatedMiddleware(events), async (baseUrl) => {
    for (const path of ['/api/places', '/api/places/category/natureza', '/api/places/search?category=natureza', '/api/places/p2']) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, 200);
    }
    assert.equal(events.filter(({ type }) => type === 'middleware').length, 0);
    assert.deepEqual(events.filter(({ type }) => type === 'controller').map(({ method }) => method), [
      'findAll', 'findByCategory', 'search', 'findById',
    ]);
  });
});

test('middleware bloqueia operações protegidas antes de chamar o controller', async () => {
  const events = [];
  await withPlaceRoutes(makeController(events), authenticatedMiddleware(events), async (baseUrl) => {
    for (const [method, path] of [
      ['POST', '/api/places'],
      ['PUT', '/api/places/p1'],
      ['DELETE', '/api/places/p1'],
    ]) {
      const response = await fetch(`${baseUrl}${path}`, { method });
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: 'Unauthorized' });
    }
    assert.deepEqual(events.map(({ type }) => type), ['middleware', 'middleware', 'middleware']);
  });
});

test('caminhos e métodos não registrados retornam 404', async () => {
  await withPlaceRoutes(makeController(), authenticatedMiddleware(), async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/places/p1`, { method: 'POST' })).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/places/unknown/extra`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/unknown`)).status, 404);
  });
});

test('rejeita controller ou middleware inválido ao criar o router', () => {
  const validMiddleware = () => {};
  for (const controller of [null, {}, { create() {}, findAll() {}, findByCategory() {}, findById() {}, update() {}, delete() {} }]) {
    assert.throws(() => createPlaceRouter(controller, validMiddleware), /PlaceController with place operation methods/);
  }
  const controller = makeController();
  for (const middleware of [undefined, null, {}]) {
    assert.throws(() => createPlaceRouter(controller, middleware), /authenticateToken middleware function/);
  }
});
