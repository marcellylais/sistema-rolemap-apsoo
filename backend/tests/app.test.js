
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { swaggerSpec } from '../src/docs/openapi.js';

const CONTROLLER_METHODS = {
  userController: ['register', 'login'],
  placeController: [
    'create',
    'findById',
    'findAll',
    'findByCategory',
    'search',
    'update',
    'delete',
  ],
  reviewController: [
    'createOrUpdate',
    'findById',
    'findByPlaceId',
    'findByUserId',
    'delete',
    'report',
    'listPendingReports',
    'moderateReport',
  ],
  itineraryController: [
    'create',
    'findAll',
    'findById',
    'update',
    'addPlace',
    'removePlace',
    'delete',
  ],
  favoriteController: ['add', 'remove', 'findAll', 'check'],
  postController: ['create', 'findRecent', 'delete'],
  feedController: ['findRecent'],
};

function makeControllers(calls = []) {
  const controllers = {};

  for (const [family, methods] of Object.entries(CONTROLLER_METHODS)) {
    const controller = {};

    for (const method of methods) {
      controller[method] = function handler(req, res) {
        assert.equal(
          this,
          controller,
          `${family}.${method} should retain controller context`,
        );

        calls.push({
          family,
          method,
          path: req.path,
          params: { ...req.params },
          body: req.body,
          user: req.user,
        });

        return res.status(200).json({
          family,
          method,
          path: req.path,
          params: req.params,
          body: req.body,
          user: req.user,
        });
      };
    }

    controllers[family] = controller;
  }

  return controllers;
}

function makeAuthMiddleware(events = []) {
  return (req, res, next) => {
    events.push(req.path);

    if (req.get('Authorization') !== 'Bearer valid') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    req.user = { id: 'u1', role: 'user' };
    return next();
  };
}

async function withApp(app, runRequests) {
  const server = createServer(app).listen(0, '127.0.0.1');
  await once(server, 'listening');

  const { port } = server.address();

  try {
    await runRequests(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('createApp configura Express e encaminha os seis grupos de rotas', async () => {
  const calls = [];
  const authEvents = [];
  const controllers = makeControllers(calls);

  const app = createApp({
    ...controllers,
    authenticateToken: makeAuthMiddleware(authEvents),
  });

  assert.equal(typeof app.listen, 'function');

  await withApp(app, async (baseUrl) => {
    const registerBody = {
      name: 'Ana',
      email: 'ana@example.com',
      password: 'secret',
    };

    const registerResponse = await fetch(`${baseUrl}/api/users/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registerBody),
    });

    assert.equal(registerResponse.status, 200);
    assert.deepEqual((await registerResponse.json()).body, registerBody);

    await fetch(`${baseUrl}/api/users/login`, { method: 'POST' });
    await fetch(`${baseUrl}/api/places`);
    await fetch(`${baseUrl}/api/places/search?category=natureza`);
    await fetch(`${baseUrl}/api/reviews/places/p1`);
    await fetch(`${baseUrl}/api/feed`);
    await fetch(`${baseUrl}/api/itineraries`, {
      headers: { Authorization: 'Bearer valid' },
    });
    await fetch(`${baseUrl}/api/favorites`, {
      headers: { Authorization: 'Bearer valid' },
    });
    await fetch(`${baseUrl}/api/places`, {
      method: 'POST',
      headers: { Authorization: 'Bearer valid' },
    });
    await fetch(`${baseUrl}/api/reviews/places/p1`, {
      method: 'POST',
      headers: { Authorization: 'Bearer valid' },
    });

    assert.deepEqual(
      calls.map(({ family, method }) => `${family}.${method}`),
      [
        'userController.register',
        'userController.login',
        'placeController.findAll',
        'placeController.search',
        'reviewController.findByPlaceId',
        'feedController.findRecent',
        'itineraryController.findAll',
        'favoriteController.findAll',
        'placeController.create',
        'reviewController.createOrUpdate',
      ],
    );

    assert.deepEqual(calls[0].body, registerBody);

    assert.deepEqual(
      calls.find(
        ({ family, method }) =>
          family === 'itineraryController' && method === 'findAll',
      ).user,
      { id: 'u1', role: 'user' },
    );

    assert.deepEqual(
      calls.find(
        ({ family, method }) =>
          family === 'favoriteController' && method === 'findAll',
      ).user,
      { id: 'u1', role: 'user' },
    );

    assert.equal(authEvents.length, 4);
  });
});

test('aplica CORS com as opções injetadas', async () => {
  const controllers = makeControllers();

  const app = createApp({
    ...controllers,
    authenticateToken: makeAuthMiddleware(),
    corsOptions: { origin: 'https://rolemap.example' },
  });

  await withApp(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/places`, {
      headers: { Origin: 'https://rolemap.example' },
    });

    assert.equal(
      response.headers.get('access-control-allow-origin'),
      'https://rolemap.example',
    );

    const preflight = await fetch(`${baseUrl}/api/favorites`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://rolemap.example',
        'Access-Control-Request-Method': 'POST',
      },
    });

    assert.equal(
      preflight.headers.get('access-control-allow-origin'),
      'https://rolemap.example',
    );

    assert.match(
      preflight.headers.get('access-control-allow-methods'),
      /POST/,
    );
  });
});

test('mantém públicas as consultas de lugares, avaliações e feed', async () => {
  const calls = [];
  const authEvents = [];
  const controllers = makeControllers(calls);

  const app = createApp({
    ...controllers,
    authenticateToken: makeAuthMiddleware(authEvents),
  });

  await withApp(app, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/places`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/reviews/places/p1`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/feed`)).status, 200);

    assert.equal((await fetch(`${baseUrl}/api/itineraries`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/favorites`)).status, 401);

    assert.deepEqual(
      calls.map(({ family }) => family),
      ['placeController', 'reviewController', 'feedController'],
    );

    assert.equal(authEvents.length, 2);
  });
});

test('valida dependências obrigatórias e suas interfaces', () => {
  const dependencies = {
    ...makeControllers(),
    authenticateToken: makeAuthMiddleware(),
  };

  for (const dependency of [
    ...Object.keys(CONTROLLER_METHODS),
    'authenticateToken',
  ]) {
    const incomplete = { ...dependencies };
    delete incomplete[dependency];

    assert.throws(() => createApp(incomplete), TypeError);
  }

  assert.throws(
    () => createApp({
      ...dependencies,
      authenticateToken: {},
    }),
    /authenticateToken to be a middleware function/,
  );

  assert.throws(
    () => createApp({
      ...dependencies,
      placeController: {},
    }),
    /PlaceController with place operation methods/,
  );

  assert.throws(
    () => createApp({
      ...dependencies,
      feedController: {},
    }),
    /FeedController with feed operation methods/,
  );

  assert.throws(
    () => createApp(null),
    /dependency object/,
  );
});

test('disponibiliza Swagger UI e documenta todas as famílias de rotas', async () => {
  const app = createApp({
    ...makeControllers(),
    authenticateToken: makeAuthMiddleware(),
  });

  await withApp(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api-docs/`);

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(await response.text(), /swagger-ui/);
  });

  const methods = Object.entries(swaggerSpec.paths).flatMap(
    ([path, operations]) =>
      Object.keys(operations).map(
        (method) => `${method.toUpperCase()} ${path}`,
      ),
  );

  assert.equal(methods.length, 32);

  for (const prefix of [
    '/api/users',
    '/api/places',
    '/api/reviews',
    '/api/itineraries',
    '/api/favorites',
    '/api/posts',
    '/api/feed',
  ]) {
    assert.ok(
      methods.some(
        (entry) => entry.endsWith(prefix) || entry.includes(`${prefix}/`),
      ),
      `${prefix} documented`,
    );
  }

  assert.deepEqual(
    swaggerSpec.components.securitySchemes.bearerAuth,
    {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    },
  );

  assert.deepEqual(
    swaggerSpec.paths['/api/places'].get.security,
    undefined,
  );

  assert.deepEqual(
    swaggerSpec.paths['/api/places'].post.security,
    [{ bearerAuth: [] }],
  );

  assert.deepEqual(
    swaggerSpec.paths['/api/feed'].get.security,
    undefined,
  );

  assert.equal(
    swaggerSpec.paths['/api/places/search'].get.parameters.length,
    6,
  );

  assert.equal(
    JSON.stringify(swaggerSpec).includes('JWT_SECRET'),
    false,
  );
});
