import test from 'node:test';
import assert from 'node:assert/strict';
import { FeedController } from '../src/application/controllers/FeedController.js';
import { ValidationError } from '../src/domain/errors/DomainError.js';

function createResponse() {
  return {
    statusCode: null,
    body: null,

    status(code) {
      this.statusCode = code;
      return this;
    },

    json(data) {
      this.body = data;
      return this;
    },
  };
}

test('retorna o feed com status 200', async () => {
  const expectedFeed = [
    { id: 'p1', type: 'post' },
    { id: 'r1', type: 'review' },
  ];

  const feedService = {
    findRecent: () => expectedFeed,
  };

  const controller = new FeedController(feedService);
  const response = createResponse();

  await controller.findRecent(
    { query: {} },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, expectedFeed);
});

test('utiliza limite padrão de 20 conteúdos', async () => {
  let receivedLimit;

  const controller = new FeedController({
    findRecent(limit) {
      receivedLimit = limit;
      return [];
    },
  });

  await controller.findRecent(
    { query: {} },
    createResponse(),
  );

  assert.equal(receivedLimit, 20);
});

test('aceita limite informado na consulta', async () => {
  let receivedLimit;

  const controller = new FeedController({
    findRecent(limit) {
      receivedLimit = limit;
      return [];
    },
  });

  await controller.findRecent(
    { query: { limit: '10' } },
    createResponse(),
  );

  assert.equal(receivedLimit, 10);
});

test('retorna status 400 quando o limite é inválido', async () => {
  const controller = new FeedController({
    findRecent() {
      throw new ValidationError('Feed limit must be between 1 and 100.');
    },
  });

  const response = createResponse();

  await controller.findRecent(
    { query: { limit: '0' } },
    response,
  );

  assert.equal(response.statusCode, 400);
  assert.equal(
    response.body.error,
    'Feed limit must be between 1 and 100.',
  );
});

test('retorna status 500 quando ocorre erro inesperado', async () => {
  const controller = new FeedController({
    findRecent() {
      throw new Error('Database failure');
    },
  });

  const response = createResponse();

  await controller.findRecent(
    { query: {} },
    response,
  );

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, {
    error: 'Internal server error.',
  });
});

test('exige um FeedService válido', () => {
  assert.throws(
    () => new FeedController(null),
    TypeError,
  );

  assert.throws(
    () => new FeedController({}),
    TypeError,
  );
});


test('aceita o limite máximo de 100 conteúdos', async () => {
  let receivedLimit;

  const controller = new FeedController({
    findRecent(limit) {
      receivedLimit = limit;
      return [];
    },
  });

  const response = createResponse();

  await controller.findRecent(
    { query: { limit: '100' } },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.equal(receivedLimit, 100);
});
