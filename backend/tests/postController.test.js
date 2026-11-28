
import test from 'node:test';
import assert from 'node:assert/strict';
import { PostController } from '../src/application/controllers/PostController.js';
import { ValidationError, PermissionError } from '../src/domain/errors/DomainError.js';

function setup(serviceOverrides = {}) {
  const service = {
    create: () => ({
      id: 'post1',
      content: 'Minha publicação',
      userId: 'u1',
    }),
    findRecent: () => [],
    delete: () => true,
    ...serviceOverrides,
  };

  const controller = new PostController(service);

  function response() {
    return {
      statusCode: null,
      body: null,
      ended: false,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      },
      end() {
        this.ended = true;
        return this;
      },
    };
  }

  return { controller, response };
}

test('cria postagem e retorna status 201', async () => {
  const { controller, response } = setup();
  const res = response();

  await controller.create({
    body: { content: 'Minha publicação' },
    user: { id: 'u1' },
  }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.content, 'Minha publicação');
});

test('retorna 401 ao criar postagem sem autenticação', async () => {
  const { controller, response } = setup();
  const res = response();

  await controller.create({ body: {} }, res);

  assert.equal(res.statusCode, 401);
});

test('lista postagens e retorna status 200', async () => {
  const { controller, response } = setup({
    findRecent: () => [{ id: 'post1' }],
  });
  const res = response();

  await controller.findRecent({ query: {} }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.length, 1);
});

test('retorna 400 quando os dados são inválidos', async () => {
  const { controller, response } = setup({
    create: () => {
      throw new ValidationError('Invalid post.');
    },
  });
  const res = response();

  await controller.create({
    body: { content: '' },
    user: { id: 'u1' },
  }, res);

  assert.equal(res.statusCode, 400);
});

test('exclui postagem e retorna status 204', async () => {
  const { controller, response } = setup();
  const res = response();

  await controller.delete({
    params: { id: 'post1' },
    user: { id: 'u1' },
  }, res);

  assert.equal(res.statusCode, 204);
  assert.equal(res.ended, true);
});

test('retorna 404 quando a postagem não existe', async () => {
  const { controller, response } = setup({
    delete: () => false,
  });
  const res = response();

  await controller.delete({
    params: { id: 'inexistente' },
    user: { id: 'u1' },
  }, res);

  assert.equal(res.statusCode, 404);
});

test('retorna 401 ao excluir sem autenticação', async () => {
  const { controller, response } = setup();
  const res = response();

  await controller.delete({
    params: { id: 'post1' },
  }, res);

  assert.equal(res.statusCode, 401);
});

test('retorna 403 quando o usuário não tem permissão', async () => {
  const { controller, response } = setup({
    delete: () => {
      throw new PermissionError('Forbidden.');
    },
  });
  const res = response();

  await controller.delete({
    params: { id: 'post1' },
    user: { id: 'u2' },
  }, res);

  assert.equal(res.statusCode, 403);
});

test('retorna 500 quando ocorre um erro interno ao criar postagem', async () => {
  const { controller, response } = setup({
    create: () => {
      throw new Error('Database connection failed.');
    },
  });
  const res = response();

  await controller.create({
    body: { content: 'Minha publicação' },
    user: { id: 'u1' },
  }, res);

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, {
    error: 'Internal server error.',
  });
});

test('converte o limite da consulta para número ao listar postagens', async () => {
  let receivedLimit;

  const { controller, response } = setup({
    findRecent: (limit) => {
      receivedLimit = limit;
      return [];
    },
  });
  const res = response();

  await controller.findRecent({
    query: { limit: '10' },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(receivedLimit, 10);
});