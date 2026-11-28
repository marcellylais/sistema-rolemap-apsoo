import test from 'node:test';
import assert from 'node:assert/strict';
import { ItineraryController } from '../src/application/controllers/ItineraryController.js';
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
    create: (data, user) => ({ id: 'i1', ...data, ownerId: user.id }),
    findById: (id) => ({ id, title: 'Passeio', ownerId: 'u1' }),
    findByOwner: (user) => [{ id: 'i1', ownerId: user.id }],
    update: () => true,
    addPlace: () => true,
    removePlace: () => true,
    delete: () => true,
  };
  const service = Object.fromEntries(Object.entries(defaults).map(([method, fallback]) => [
    method,
    (...args) => {
      calls.push({ method, args });
      if (overrides[`${method}Error`]) throw overrides[`${method}Error`];
      return Object.hasOwn(overrides, `${method}Result`) ? overrides[`${method}Result`] : fallback(...args);
    },
  ]));
  return { controller: new ItineraryController(service), calls };
}

const user = { id: 'u1', role: 'user' };

test('cria roteiro com usuário autenticado e ignora identidade e campos internos do corpo', async () => {
  const { controller, calls } = makeController();
  const response = createResponse();
  await controller.create({
    user,
    body: {
      title: 'Passeio', description: 'Centro', placeIds: ['p1'],
      ownerId: 'u2', userId: 'u2', id: 'forged', createdAt: 'forged',
    },
  }, response);

  assert.equal(response.statusCode, 201);
  assert.deepEqual(calls[0], {
    method: 'create',
    args: [{ title: 'Passeio', description: 'Centro', placeIds: ['p1'] }, user],
  });
  assert.equal(response.body.ownerId, 'u1');
});

test('GET / lista somente os roteiros do usuário autenticado', async () => {
  const { controller, calls } = makeController();
  const response = createResponse();
  await controller.findAll({ user, params: { userId: 'u2' }, body: { ownerId: 'u2' } }, response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, [{ id: 'i1', ownerId: 'u1' }]);
  assert.deepEqual(calls[0], { method: 'findByOwner', args: [user] });
});

test('findByOwner usa req.user e ignora userId de rota ou corpo', async () => {
  const { controller, calls } = makeController();
  const response = createResponse();
  await controller.findByOwner({ user, params: { userId: 'u2' }, body: { userId: 'u2' } }, response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls[0], { method: 'findByOwner', args: [user] });
});

test('findById encaminha a identidade autenticada e mapeia autorizado, inexistente e proibido', async () => {
  const found = makeController();
  const foundResponse = createResponse();
  await found.controller.findById({ user, params: { id: 'i1' }, body: { userId: 'u2' } }, foundResponse);
  assert.equal(foundResponse.statusCode, 200);
  assert.equal(foundResponse.body.ownerId, 'u1');
  assert.deepEqual(found.calls[0], { method: 'findById', args: ['i1', user] });

  const missing = makeController({ findByIdResult: null });
  const missingResponse = createResponse();
  await missing.controller.findById({ user, params: { id: 'missing' } }, missingResponse);
  assert.equal(missingResponse.statusCode, 404);
  assert.deepEqual(missingResponse.body, { error: 'Itinerary not found.' });

  const forbidden = makeController({ findByIdError: new PermissionError('Only the owner may view it.') });
  const forbiddenResponse = createResponse();
  await forbidden.controller.findById({ user: { id: 'u2', role: 'user' }, params: { id: 'i1' } }, forbiddenResponse);
  assert.equal(forbiddenResponse.statusCode, 403);
  assert.deepEqual(forbidden.calls[0].args, ['i1', { id: 'u2', role: 'user' }]);
});

test('findById retorna 500 genérico sem expor detalhes inesperados', async () => {
  const { controller } = makeController({ findByIdError: new Error('private database path and details') });
  const response = createResponse();
  await controller.findById({ user, params: { id: 'i1' } }, response);
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, { error: 'Internal server error.' });
  assert.equal(JSON.stringify(response.body).includes('private database'), false);
});

test('atualiza somente título e descrição, ignorando ownerId e placeIds', async () => {
  const { controller, calls } = makeController();
  const response = createResponse();
  await controller.update({
    user,
    params: { id: 'i1' },
    body: { title: 'Novo', description: 'Nova descrição', ownerId: 'u2', placeIds: ['p2'], userId: 'u2' },
  }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, true);
  assert.deepEqual(calls[0], { method: 'update', args: ['i1', { title: 'Novo', description: 'Nova descrição' }, user] });

  const missing = makeController({ updateResult: false });
  const missingResponse = createResponse();
  await missing.controller.update({ user, params: { id: 'missing' }, body: {} }, missingResponse);
  assert.equal(missingResponse.statusCode, 404);
});

test('adiciona lugar usando itineraryId da rota e placeId do corpo', async () => {
  const { controller, calls } = makeController();
  const response = createResponse();
  await controller.addPlace({
    user,
    params: { id: 'i1' },
    body: { placeId: 'p1', itineraryId: 'forged', userId: 'u2' },
  }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, true);
  assert.deepEqual(calls[0], { method: 'addPlace', args: ['i1', 'p1', user] });

  const missing = makeController({ addPlaceResult: false });
  const missingResponse = createResponse();
  await missing.controller.addPlace({ user, params: { id: 'missing' }, body: { placeId: 'p1' } }, missingResponse);
  assert.equal(missingResponse.statusCode, 404);
});

test('removePlace usa IDs da rota e retorna 204 ou 404 conforme resultado', async () => {
  const { controller, calls } = makeController();
  const response = createResponse();
  await controller.removePlace({ user, params: { id: 'i1', placeId: 'p1' } }, response);
  assert.equal(response.statusCode, 204);
  assert.equal(response.ended, true);
  assert.deepEqual(calls[0], { method: 'removePlace', args: ['i1', 'p1', user] });

  const missing = makeController({ removePlaceResult: false });
  const missingResponse = createResponse();
  await missing.controller.removePlace({ user, params: { id: 'i1', placeId: 'missing' } }, missingResponse);
  assert.equal(missingResponse.statusCode, 404);
});

test('exclui roteiro com HTTP 204 e retorna 404 quando inexistente', async () => {
  const { controller, calls } = makeController();
  const response = createResponse();
  await controller.delete({ user, params: { id: 'i1' } }, response);
  assert.equal(response.statusCode, 204);
  assert.equal(response.ended, true);
  assert.deepEqual(calls[0], { method: 'delete', args: ['i1', user] });

  const missing = makeController({ deleteResult: false });
  const missingResponse = createResponse();
  await missing.controller.delete({ user, params: { id: 'missing' } }, missingResponse);
  assert.equal(missingResponse.statusCode, 404);
});

test('todos os handlers exigem req.user e ignoram ownerId/userId no corpo', async () => {
  const { controller, calls } = makeController();
  const requests = [
    ['create', { body: { ownerId: 'u1' } }],
    ['findAll', { body: { userId: 'u1' } }],
    ['findByOwner', { params: { userId: 'u1' } }],
    ['findById', { params: { id: 'i1' } }],
    ['update', { params: { id: 'i1' }, body: { ownerId: 'u1' } }],
    ['addPlace', { params: { id: 'i1' }, body: { placeId: 'p1' } }],
    ['removePlace', { params: { id: 'i1', placeId: 'p1' } }],
    ['delete', { params: { id: 'i1' } }],
  ];
  for (const [method, req] of requests) {
    const response = createResponse();
    await controller[method](req, response);
    assert.equal(response.statusCode, 401, method);
    assert.deepEqual(response.body, { error: 'Unauthorized' });
  }
  assert.deepEqual(calls, []);
});

test('mapeia ValidationError, PermissionError, AuthenticationError e esconde erros inesperados', async () => {
  for (const [error, expectedStatus] of [
    [new ValidationError('Invalid itinerary.'), 400],
    [new PermissionError('Forbidden.'), 403],
    [new AuthenticationError('Unauthorized.'), 401],
    [new Error('private database details'), 500],
  ]) {
    const { controller } = makeController({ deleteError: error });
    const response = createResponse();
    await controller.delete({ user, params: { id: 'i1' } }, response);
    assert.equal(response.statusCode, expectedStatus);
    if (expectedStatus === 500) {
      assert.deepEqual(response.body, { error: 'Internal server error.' });
      assert.equal(JSON.stringify(response.body).includes('private database'), false);
    }
  }
});

test('rejeita ItineraryService ausente ou sem métodos necessários', () => {
  for (const service of [
    null,
    {},
    { create() {}, findById() {}, findByOwner() {}, update() {}, addPlace() {}, removePlace() {} },
  ]) {
    assert.throws(() => new ItineraryController(service), /ItineraryService with itinerary operation methods/);
  }
});
