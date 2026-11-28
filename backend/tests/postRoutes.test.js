
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createPostRouter } from '../src/routes/postRoutes.js';

function setup(authenticateTokenOverride) {
  const app = express();
  app.use(express.json());

  const calls = [];

  const controller = {
    findRecent(req, res) {
      calls.push('findRecent');
      return res.status(200).json([]);
    },
    create(req, res) {
      calls.push('create');
      return res.status(201).json({ content: req.body.content });
    },
    delete(req, res) {
      calls.push('delete');
      return res.status(204).end();
    },
  };

  function defaultAuthenticateToken(req, res, next) {
    calls.push('authenticateToken');
    req.user = { id: 'u1' };
    next();
  }

  const authenticateToken = authenticateTokenOverride
    || defaultAuthenticateToken;

  app.use('/api/posts', createPostRouter(controller, authenticateToken));

  return { app, calls };
}

test('configura a consulta pública de postagens', async () => {
  const { app, calls } = setup();
  const server = app.listen(0);

  try {
    const response = await fetch(
      `http://localhost:${server.address().port}/api/posts`,
    );

    assert.equal(response.status, 200);
    assert.deepEqual(calls, ['findRecent']);
  } finally {
    server.close();
  }
});

test('exige autenticação para criar postagem', async () => {
  const { app, calls } = setup();
  const server = app.listen(0);

  try {
    const response = await fetch(
      `http://localhost:${server.address().port}/api/posts`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Nova postagem' }),
      },
    );

    assert.equal(response.status, 201);
    assert.deepEqual(calls, ['authenticateToken', 'create']);
  } finally {
    server.close();
  }
});

test('exige autenticação para excluir postagem', async () => {
  const { app, calls } = setup();
  const server = app.listen(0);

  try {
    const response = await fetch(
      `http://localhost:${server.address().port}/api/posts/post1`,
      { method: 'DELETE' },
    );

    assert.equal(response.status, 204);
    assert.deepEqual(calls, ['authenticateToken', 'delete']);
  } finally {
    server.close();
  }
});

test('impede criar postagem quando o usuário não está autenticado', async () => {
  const { app, calls } = setup((req, res) => {
    calls.push('authenticateToken');
    return res.status(401).json({ error: 'Unauthorized' });
  });

  const server = app.listen(0);

  try {
    const response = await fetch(
      `http://localhost:${server.address().port}/api/posts`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Nova postagem' }),
      },
    );

    assert.equal(response.status, 401);
    assert.deepEqual(calls, ['authenticateToken']);
  } finally {
    server.close();
  }
});

test('impede excluir postagem quando o usuário não está autenticado', async () => {
  const { app, calls } = setup((req, res) => {
    calls.push('authenticateToken');
    return res.status(401).json({ error: 'Unauthorized' });
  });

  const server = app.listen(0);

  try {
    const response = await fetch(
      `http://localhost:${server.address().port}/api/posts/post1`,
      { method: 'DELETE' },
    );

    assert.equal(response.status, 401);
    assert.deepEqual(calls, ['authenticateToken']);
  } finally {
    server.close();
  }
});

test('exige um controlador válido', () => {
  assert.throws(
    () => createPostRouter({}, () => {}),
    TypeError,
  );
});

test('exige um middleware de autenticação válido', () => {
  assert.throws(
    () => createPostRouter({
      create() {},
      findRecent() {},
      delete() {},
    }),
    TypeError,
  );
});
