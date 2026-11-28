import test from 'node:test';
import assert from 'node:assert/strict';
import { ReviewController } from '../src/application/controllers/ReviewController.js';
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

const createdAt = new Date('2025-01-01T00:00:00.000Z');
const updatedAt = new Date('2025-01-02T00:00:00.000Z');
const reviewResult = (overrides = {}) => ({
  id: 'r1', rating: 5, comment: 'Ótimo', userId: 'u1', placeId: 'p1', createdAt, updatedAt: createdAt,
  ...overrides,
});

function makeController(overrides = {}) {
  const calls = [];
  const methods = {
    createOrUpdate: (placeId, data, user) => ({
      review: reviewResult({ placeId, ...data, userId: user.id }),
      created: true,
    }),
    findById: (id) => reviewResult({ id }),
    findByPlaceId: (placeId) => [reviewResult({ placeId })],
    findByUserId: (userId) => [reviewResult({ userId })],
    delete: () => true,
    report: (reviewId, targetType, user) => ({
      report: { id: 'report-1', reviewId, targetType, status: 'pending', createdAt },
      activeReportCount: 1,
      visibilityState: 'visible',
      reporterId: user.id,
    }),
    listPendingReports: () => [],
    moderateReport: (reportId, data, user) => ({
      report: { id: reportId, status: data.decision === 'approve' ? 'approved' : 'rejected', moderatedBy: user.id, moderatedAt: updatedAt },
      activeReportCount: 0,
      visibilityState: 'visible',
    }),
  };
  const service = Object.fromEntries(Object.entries(methods).map(([method, fallback]) => [
    method,
    (...args) => {
      calls.push({ method, args });
      if (overrides[`${method}Error`]) throw overrides[`${method}Error`];
      return Object.hasOwn(overrides, `${method}Result`) ? overrides[`${method}Result`] : fallback(...args);
    },
  ]));
  return { controller: new ReviewController(service), calls };
}

test('cria avaliação com req.user e somente rating e comment do corpo', async () => {
  const response = createResponse();
  const user = { id: 'u1', role: 'user' };
  const expectedReview = reviewResult({ comment: 'Ótimo' });
  const { controller: resultController, calls: resultCalls } = makeController({
    createOrUpdateResult: { review: expectedReview, created: true },
  });
  await resultController.createOrUpdate({
    params: { placeId: 'p1' },
    user,
    body: { rating: 5, comment: 'Ótimo', userId: 'u2', authorId: 'u2', id: 'forged', passwordHash: 'secret' },
  }, response);

  assert.equal(response.statusCode, 201);
  assert.deepEqual(resultCalls[0], { method: 'createOrUpdate', args: ['p1', { rating: 5, comment: 'Ótimo' }, user] });
  assert.deepEqual(response.body, expectedReview);
  assert.equal(response.body.userId, 'u1');
  assert.equal(response.body.id, 'r1');
  assert.equal(Object.hasOwn(response.body, 'created'), false);
  assert.equal(JSON.stringify(response.body).includes('secret'), false);
});

test('atualizar avaliação existente retorna HTTP 200 mesmo com createdAt e updatedAt iguais', async () => {
  const updatedReview = reviewResult({ rating: 3, createdAt, updatedAt: createdAt });
  const { controller, calls } = makeController({
    createOrUpdateResult: { review: updatedReview, created: false },
  });
  const response = createResponse();
  const user = { id: 'u1', role: 'user' };
  await controller.createOrUpdate({ params: { placeId: 'p1' }, user, body: { rating: 3 } }, response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, updatedReview);
  assert.equal(Object.hasOwn(response.body, 'created'), false);
  assert.deepEqual(calls[0].args, ['p1', { rating: 3 }, user]);
});

test('busca por ID retorna 200 e avaliação inexistente retorna 404', async () => {
  const { controller } = makeController({ findByIdResult: null });
  const response = createResponse();
  await controller.findById({ params: { id: 'missing' } }, response);
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, { error: 'Review not found.' });

  const found = makeController();
  const foundResponse = createResponse();
  await found.controller.findById({ params: { id: 'r1' } }, foundResponse);
  assert.equal(foundResponse.statusCode, 200);
  assert.equal(foundResponse.body.id, 'r1');
  assert.deepEqual(found.calls[0], { method: 'findById', args: ['r1'] });
});

test('lista avaliações por lugar e por usuário usando os parâmetros da rota, não o corpo', async () => {
  const { controller, calls } = makeController();
  const placeResponse = createResponse();
  await controller.findByPlaceId({ params: { placeId: 'p1' }, body: { placeId: 'p2' } }, placeResponse);
  assert.equal(placeResponse.statusCode, 200);
  assert.deepEqual(calls[0], { method: 'findByPlaceId', args: ['p1'] });

  const userResponse = createResponse();
  await controller.findByUserId({ params: { userId: 'u1' }, body: { userId: 'u2' } }, userResponse);
  assert.equal(userResponse.statusCode, 200);
  assert.deepEqual(calls[1], { method: 'findByUserId', args: ['u1'] });
});

test('exclui com 204, encaminha req.user e retorna 404 para avaliação inexistente', async () => {
  const user = { id: 'u1', role: 'user' };
  const success = makeController();
  const response = createResponse();
  await success.controller.delete({ params: { id: 'r1' }, user, body: { userId: 'u2' } }, response);
  assert.equal(response.statusCode, 204);
  assert.equal(response.ended, true);
  assert.deepEqual(success.calls[0], { method: 'delete', args: ['r1', user] });

  const missing = makeController({ deleteResult: false });
  const missingResponse = createResponse();
  await missing.controller.delete({ params: { id: 'missing' }, user }, missingResponse);
  assert.equal(missingResponse.statusCode, 404);
});

test('createOrUpdate e delete retornam 401 sem identidade autenticada', async () => {
  const { controller, calls } = makeController();
  for (const method of ['createOrUpdate', 'delete']) {
    const response = createResponse();
    await controller[method]({ params: { id: 'r1', placeId: 'p1' }, body: { userId: 'u1' } }, response);
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.body, { error: 'Unauthorized' });
  }
  assert.deepEqual(calls, []);
});

test('mapeia ValidationError, PermissionError, AuthenticationError e esconde erros inesperados', async () => {
  for (const [error, expectedStatus] of [
    [new ValidationError('Invalid review.'), 400],
    [new PermissionError('Forbidden.'), 403],
    [new AuthenticationError('Unauthorized.'), 401],
    [new Error('private database password hash'), 500],
  ]) {
    const { controller } = makeController({ deleteError: error });
    const response = createResponse();
    await controller.delete({ params: { id: 'r1' }, user: { id: 'u1' } }, response);
    assert.equal(response.statusCode, expectedStatus);
    if (expectedStatus === 500) {
      assert.deepEqual(response.body, { error: 'Internal server error.' });
      assert.equal(JSON.stringify(response.body).includes('private database'), false);
      assert.equal(JSON.stringify(response.body).includes('password hash'), false);
    }
  }
});

test('rejeita ReviewService ausente ou sem qualquer método necessário', () => {
  for (const service of [null, {}, { createOrUpdate() {}, findById() {}, findByPlaceId() {}, findByUserId() {} }]) {
    assert.throws(() => new ReviewController(service), /ReviewService with review operations/);
  }
});
