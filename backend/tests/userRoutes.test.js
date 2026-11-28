import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import express from 'express';
import { createUserRouter } from '../src/routes/userRoutes.js';

async function withUserRoutes(controller, runRequest) {
  const app = express();
  app.use(express.json());
  app.use('/api/users', createUserRouter(controller));

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

test('POST /register e POST /login encaminham req e res aos métodos injetados', async () => {
  const calls = [];
  const controller = {
    register(req, res) {
      calls.push({ method: 'register', req, body: req.body });
      return res.status(201).json({ route: 'register' });
    },
    login(req, res) {
      calls.push({ method: 'login', req, body: req.body });
      return res.status(200).json({ route: 'login' });
    },
  };

  await withUserRoutes(controller, async (baseUrl) => {
    const registerBody = { name: 'Ana', email: 'ana@example.com', password: 'secret' };
    const registerResponse = await fetch(`${baseUrl}/api/users/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registerBody),
    });
    assert.equal(registerResponse.status, 201);
    assert.deepEqual(await registerResponse.json(), { route: 'register' });

    const loginBody = { email: 'ana@example.com', password: 'secret' };
    const loginResponse = await fetch(`${baseUrl}/api/users/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loginBody),
    });
    assert.equal(loginResponse.status, 200);
    assert.deepEqual(await loginResponse.json(), { route: 'login' });

    assert.deepEqual(calls.map(({ method, body }) => ({ method, body })), [
      { method: 'register', body: registerBody },
      { method: 'login', body: loginBody },
    ]);
    assert.equal(calls[0].req.method, 'POST');
    assert.equal(calls[0].req.path, '/register');
    assert.equal(calls[1].req.method, 'POST');
    assert.equal(calls[1].req.path, '/login');
    assert.equal(typeof calls[0].req.get, 'function');
  });
});

test('rotas usam somente POST nos caminhos configurados e caminhos inexistentes retornam 404', async () => {
  const controller = {
    register(_req, res) { return res.sendStatus(204); },
    login(_req, res) { return res.sendStatus(204); },
  };
  await withUserRoutes(controller, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/users/register`, { method: 'POST' })).status, 204);
    assert.equal((await fetch(`${baseUrl}/api/users/login`, { method: 'POST' })).status, 204);
    assert.equal((await fetch(`${baseUrl}/api/users/register`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/users/unknown`, { method: 'POST' })).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/register`, { method: 'POST' })).status, 404);
  });
});

test('rejeita controller ausente ou sem os métodos esperados', () => {
  for (const controller of [null, {}, { register() {} }, { login() {} }]) {
    assert.throws(() => createUserRouter(controller), /UserController with register and login methods/);
  }
});
