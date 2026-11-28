import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import express from 'express';
import jwt from 'jsonwebtoken';
import { TokenService } from '../src/application/services/TokenService.js';
import { authenticateToken } from '../src/application/middleware/authenticateToken.js';

const TEST_SECRET = 'rolemap-auth-middleware-test-secret';
const tokenService = new TokenService(TEST_SECRET);

async function withProtectedServer(runRequest) {
  const app = express();
  app.use(express.json());
  app.get('/protected', authenticateToken(tokenService), (req, res) => {
    res.json({ user: req.user });
  });
  app.post('/protected', authenticateToken(tokenService), (req, res) => {
    res.json({ user: req.user, receivedUserId: req.body.userId });
  });

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

function signPayload(payload, expiresIn = '1h') {
  return jwt.sign(payload, TEST_SECRET, { algorithm: 'HS256', expiresIn });
}

test('token válido permite acesso e req.user recebe sub e role assinados', async () => {
  const token = tokenService.generateToken({ id: 'u-authenticated', role: 'admin' });
  await withProtectedServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/protected`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { user: { id: 'u-authenticated', role: 'admin' } });
  });
});

test('token ausente, Authorization vazio ou sem Bearer retorna 401 genérico', async () => {
  await withProtectedServer(async (baseUrl) => {
    for (const headers of [{}, { Authorization: '' }, { Authorization: 'token-only' }, { Authorization: 'Basic abc' }]) {
      const response = await fetch(`${baseUrl}/protected`, { headers });
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: 'Unauthorized' });
    }
  });
});

test('token inválido ou malformado retorna 401 sem detalhes internos', async () => {
  const validToken = tokenService.generateToken({ id: 'u1', role: 'user' });
  const tamperedToken = `${validToken.slice(0, -1)}x`;
  await withProtectedServer(async (baseUrl) => {
    for (const token of ['not-a-jwt', tamperedToken]) {
      const response = await fetch(`${baseUrl}/protected`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: 'Unauthorized' });
    }
  });
});

test('token expirado retorna 401', async () => {
  const expiredToken = signPayload({ sub: 'u1', role: 'user' }, -1);
  await withProtectedServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/protected`, {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Unauthorized' });
  });
});

test('payload sem sub ou com role inválido retorna 401', async () => {
  const invalidTokens = [
    signPayload({ role: 'user' }),
    signPayload({ sub: 'u1' }),
    signPayload({ sub: '', role: 'user' }),
    signPayload({ sub: 1, role: 'user' }),
    signPayload({ sub: 'u1', role: 'superuser' }),
  ];
  await withProtectedServer(async (baseUrl) => {
    for (const token of invalidTokens) {
      const response = await fetch(`${baseUrl}/protected`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: 'Unauthorized' });
    }
  });
});

test('userId do corpo não substitui a identidade extraída do token', async () => {
  const token = tokenService.generateToken({ id: 'u-authenticated', role: 'user' });
  await withProtectedServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/protected`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId: 'attacker' }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.user, { id: 'u-authenticated', role: 'user' });
    assert.equal(body.receivedUserId, 'attacker');
  });
});
