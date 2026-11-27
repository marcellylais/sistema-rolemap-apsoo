import test from 'node:test';
import assert from 'node:assert/strict';
import { FavoriteController } from '../src/application/controllers/FavoriteController.js';
import {
  AuthenticationError,
  PermissionError,
  ValidationError,
} from '../src/domain/errors/DomainError.js';

function createResponse() {
  return {
    statusCode: null,
    body: null,
    ended: false,
    status(statusCode) { this.statusCode = statusCode; return this; },
    json(body) { this.body = body; return this; },
    end() { this.ended = true; return this; },
  };
}

function makeController(overrides = {}) {
  const calls = [];
  const defaults = {
    addFavorite: () => true,
    removeFavorite: () => true,
    findFavorites: () => ['p1', 'p2'],
    hasFavorite: () => true,
  };
  const service = Object.fromEntries(Object.entries(defaults).map(([method, fallback]) => [
    method,
    (...args) => {
      calls.push({ method, args });
      if (overrides[`${method}Error`]) throw overrides[`${method}Error`];
      return Object.hasOwn(overrides, `${method}Result`) ? overrides[`${method}Result`] : fallback(...args);
    },
  ]));
  return { controller: new FavoriteController(service), calls };
}

const user = { id: 'u1', role: 'user' };

test('adiciona favorito com req.user e retorna 201; duplicado retorna 200 false', async () => {
  const { controller, calls } = makeController();
  const response = createResponse();
  await controller.add({
    params: { placeId: 'path-value-must-be-ignored' },
    user,
    body: { userId: 'u2', placeId: 'p1' },
    query: { userId: 'u3' },
  }, response);
  assert.equal(response.statusCode, 201);
  assert.equal(response.body, true);
  assert.deepEqual(calls[0], { method: 'addFavorite', args: ['p1', user] });

  const duplicate = makeController({ addFavoriteResult: false });
  const duplicateResponse = createResponse();
  await duplicate.controller.add({ body: { placeId: 'p1' }, user }, duplicateResponse);
  assert.equal(duplicateResponse.statusCode, 200);
  assert.equal(duplicateResponse.body, false);
});

test('add encaminha placeId ausente ao serviço, que o rejeita como dado inválido', async () => {
  const { controller, calls } = makeController({
    addFavoriteError: new ValidationError('A valid place id is required.'),
  });
  const response = createResponse();
  await controller.add({ user, body: { userId: 'u2' }, params: { placeId: 'path-value-must-not-be-used' } }, response);
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { error: 'A valid place id is required.' });
  assert.deepEqual(calls[0], { method: 'addFavorite', args: [undefined, user] });
});

test('remove apaga somente favorito do req.user e responde 204; vínculo ausente retorna 404', async () => {
  const { controller, calls } = makeController();
  const response = createResponse();
  await controller.remove({ params: { placeId: 'p1' }, user, body: { userId: 'u2' }, query: { userId: 'u3' } }, response);
  assert.equal(response.statusCode, 204);
  assert.equal(response.ended, true);
  assert.deepEqual(calls[0], { method: 'removeFavorite', args: ['p1', user] });

  const missing = makeController({ removeFavoriteResult: false });
  const missingResponse = createResponse();
  await missing.controller.remove({ params: { placeId: 'p1' }, user }, missingResponse);
  assert.equal(missingResponse.statusCode, 404);
  assert.deepEqual(missingResponse.body, { error: 'Favorite not found.' });
});

test('lista somente favoritos do usuário autenticado', async () => {
  const { controller, calls } = makeController();
  const response = createResponse();
  await controller.findAll({ user, body: { userId: 'u2' }, query: { userId: 'u3' }, params: { userId: 'u4' } }, response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, ['p1', 'p2']);
  assert.deepEqual(calls[0], { method: 'findFavorites', args: [user] });
});

test('check retorna boolean para favorito existente e inexistente usando req.user', async () => {
  const existing = makeController({ hasFavoriteResult: true });
  const existingResponse = createResponse();
  await existing.controller.check({ params: { placeId: 'p1' }, user, body: { userId: 'u2' } }, existingResponse);
  assert.equal(existingResponse.statusCode, 200);
  assert.equal(existingResponse.body, true);
  assert.deepEqual(existing.calls[0], { method: 'hasFavorite', args: ['p1', user] });

  const absent = makeController({ hasFavoriteResult: false });
  const absentResponse = createResponse();
  await absent.controller.check({ params: { placeId: 'p2' }, user }, absentResponse);
  assert.equal(absentResponse.statusCode, 200);
  assert.equal(absentResponse.body, false);
});

test('todos os handlers retornam 401 sem req.user e não chamam o serviço', async () => {
  const { controller, calls } = makeController();
  for (const method of ['add', 'remove', 'findAll', 'check']) {
    const response = createResponse();
    await controller[method]({ params: { placeId: 'p1' }, body: { userId: 'u1' }, query: { userId: 'u1' } }, response);
    assert.equal(response.statusCode, 401, method);
    assert.deepEqual(response.body, { error: 'Unauthorized' });
  }
  assert.deepEqual(calls, []);
});

test('mapeia validação para 400 e lugar inexistente para 404', async () => {
  for (const [error, expectedStatus, expectedBody] of [
    [new ValidationError('A valid place id is required.'), 400, { error: 'A valid place id is required.' }],
    [new ValidationError('Place does not exist.'), 404, { error: 'Place not found.' }],
  ]) {
    const { controller } = makeController({ addFavoriteError: error });
    const response = createResponse();
    await controller.add({ params: { placeId: 'bad' }, user }, response);
    assert.equal(response.statusCode, expectedStatus);
    assert.deepEqual(response.body, expectedBody);
  }
});

test('mapeia PermissionError para 403 e AuthenticationError para 401', async () => {
  for (const [error, expectedStatus] of [
    [new PermissionError('Forbidden.'), 403],
    [new AuthenticationError('Unauthorized.'), 401],
  ]) {
    const { controller } = makeController({ removeFavoriteError: error });
    const response = createResponse();
    await controller.remove({ params: { placeId: 'p1' }, user }, response);
    assert.equal(response.statusCode, expectedStatus);
    assert.deepEqual(response.body, { error: error.message });
  }
});

test('erros inesperados retornam 500 sem expor detalhes internos', async () => {
  const { controller } = makeController({ findFavoritesError: new Error('private database credentials and stack') });
  const response = createResponse();
  await controller.findAll({ user }, response);
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, { error: 'Internal server error.' });
  assert.equal(JSON.stringify(response.body).includes('private database'), false);
  assert.equal(JSON.stringify(response.body).includes('credentials'), false);
});

test('valida injeção do FavoriteService e os quatro métodos necessários', () => {
  for (const service of [
    null,
    {},
    { addFavorite() {}, removeFavorite() {}, findFavorites() {} },
  ]) {
    assert.throws(() => new FavoriteController(service), /FavoriteService with favorite operation methods/);
  }
});
