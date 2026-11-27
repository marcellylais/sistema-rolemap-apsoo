import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaceController } from '../src/application/controllers/PlaceController.js';
import { AuthenticationError, PermissionError, ValidationError } from '../src/domain/errors/DomainError.js';

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
    create: (data, user) => ({ id: 'p1', ...data, authorId: user.id }),
    findById: (id) => ({ id, title: 'Parque' }),
    findAll: () => [{ id: 'p1' }],
    findByCategory: (category) => [{ id: 'p1', category }],
    search: (filters) => [{ id: 'p1', ...filters }],
    update: () => true,
    delete: (id, user) => ({ id, deletedBy: user.id }),
  };
  const placeService = Object.fromEntries(Object.entries(defaults).map(([method, defaultImplementation]) => [
    method,
    (...args) => {
      calls.push({ method, args });
      if (overrides[`${method}Error`]) throw overrides[`${method}Error`];
      return Object.hasOwn(overrides, `${method}Result`)
        ? overrides[`${method}Result`]
        : defaultImplementation(...args);
    },
  ]));
  return { controller: new PlaceController(placeService), calls };
}

test('cria lugar com HTTP 201 e encaminha dados permitidos e req.user', async () => {
  const { controller, calls } = makeController();
  const response = createResponse();
  await controller.create({
    user: { id: 'u1', role: 'user' },
    body: {
      title: 'Parque', description: 'Verde', category: 'natureza', latitude: 0, longitude: 1,
      authorId: 'attacker', userId: 'attacker', id: 'forged',
    },
  }, response);
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.authorId, 'u1');
  assert.deepEqual(calls[0].args, [{ title: 'Parque', description: 'Verde', category: 'natureza', latitude: 0, longitude: 1 }, { id: 'u1', role: 'user' }]);
});

test('busca por ID, lista e filtra por categoria', async () => {
  const { controller, calls } = makeController();
  const byIdResponse = createResponse();
  await controller.findById({ params: { id: 'p1' } }, byIdResponse);
  assert.equal(byIdResponse.statusCode, 200);
  assert.deepEqual(calls[0], { method: 'findById', args: ['p1'] });

  const listResponse = createResponse();
  await controller.findAll({}, listResponse);
  assert.equal(listResponse.statusCode, 200);
  assert.deepEqual(listResponse.body, [{ id: 'p1' }]);

  const categoryResponse = createResponse();
  await controller.findByCategory({ params: { category: 'cultura' }, query: {} }, categoryResponse);
  assert.deepEqual(calls[2], { method: 'findByCategory', args: ['cultura'] });
});

test('busca encaminha os filtros de query e serializa a média', async () => {
  const { controller, calls } = makeController({
    searchResult: [{ id: 'p1', averageRating: 4.5, title: 'Parque' }],
  });
  const response = createResponse();
  const query = { name: 'parque', category: 'natureza', latitude: '-23.5', longitude: '-46.6', radiusKm: '5' };
  await controller.search({ query }, response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, [{ id: 'p1', averageRating: 4.5, title: 'Parque' }]);
  assert.deepEqual(calls[0], { method: 'search', args: [query] });
});

test('busca lugar inexistente e atualização false retornam HTTP 404', async () => {
  const { controller: notFoundController } = makeController({ findByIdResult: null, updateResult: false });
  const findResponse = createResponse();
  await notFoundController.findById({ params: { id: 'missing' } }, findResponse);
  assert.equal(findResponse.statusCode, 404);

  const updateResponse = createResponse();
  await notFoundController.update({ params: { id: 'missing' }, body: {}, user: { id: 'u1' } }, updateResponse);
  assert.equal(updateResponse.statusCode, 404);
});

test('atualiza lugar usando identidade autenticada e ignora userId, autoria e coordenadas do corpo', async () => {
  const { controller, calls } = makeController();
  const response = createResponse();
  await controller.update({
    params: { id: 'p1' },
    user: { id: 'u1', role: 'admin' },
    body: { title: 'Atualizado', description: 'Descrição', category: 'lazer', userId: 'u2', authorId: 'u2', latitude: 50 },
  }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, true);
  assert.deepEqual(calls[0].args, ['p1', { title: 'Atualizado', description: 'Descrição', category: 'lazer' }, { id: 'u1', role: 'admin' }]);
});

test('cria e atualiza retornam 401 sem req.user', async () => {
  const { controller, calls } = makeController();
  for (const operation of ['create', 'update']) {
    const response = createResponse();
    const req = { params: { id: 'p1' }, body: {} };
    await controller[operation](req, response);
    assert.equal(response.statusCode, 401);
  }
  assert.equal(calls.length, 0);
});

test('exclui com HTTP 204, encaminha req.user e ignora identidade do corpo', async () => {
  const { controller, calls } = makeController();
  const success = createResponse();
  const authenticatedUser = { id: 'u1', role: 'user' };
  await controller.delete({ params: { id: 'p1' }, user: authenticatedUser, body: { userId: 'u2' } }, success);
  assert.equal(success.statusCode, 204);
  assert.equal(success.ended, true);
  assert.equal(success.body, null);
  assert.deepEqual(calls[0], { method: 'delete', args: ['p1', authenticatedUser] });

  const { controller: missingController } = makeController({ deleteResult: false });
  const missing = createResponse();
  await missingController.delete({ params: { id: 'missing' }, user: { id: 'u1' } }, missing);
  assert.equal(missing.statusCode, 404);
});

test('exclusão sem req.user retorna HTTP 401 sem chamar o serviço', async () => {
  const { controller, calls } = makeController();
  const response = createResponse();
  await controller.delete({ params: { id: 'p1' }, body: { userId: 'u1' } }, response);
  assert.equal(response.statusCode, 401);
  assert.equal(calls.length, 0);
});

test('exclusão traduz falta de permissão em HTTP 403', async () => {
  const { controller } = makeController({ deleteError: new PermissionError('Forbidden.') });
  const response = createResponse();
  await controller.delete({ params: { id: 'p1' }, user: { id: 'u2', role: 'user' } }, response);
  assert.equal(response.statusCode, 403);
});

test('mapeia erros de validação, permissão, autenticação e falhas inesperadas', async () => {
  for (const [error, expectedStatus] of [
    [new ValidationError('Invalid place.'), 400],
    [new PermissionError('Forbidden.'), 403],
    [new AuthenticationError('Unauthorized.'), 401],
    [new Error('database secret and stack details'), 500],
  ]) {
    const { controller } = makeController({ createError: error });
    const response = createResponse();
    await controller.create({ body: {}, user: { id: 'u1' } }, response);
    assert.equal(response.statusCode, expectedStatus);
    if (expectedStatus === 500) {
      assert.deepEqual(response.body, { error: 'Internal server error.' });
      assert.equal(JSON.stringify(response.body).includes('database secret'), false);
    }
  }
});

test('rejeita PlaceService sem qualquer método requerido', () => {
  for (const service of [null, {}, { create() {}, findById() {}, findAll() {}, findByCategory() {}, search() {}, update() {} }]) {
    assert.throws(() => new PlaceController(service), /PlaceService with place operations/);
  }
});
