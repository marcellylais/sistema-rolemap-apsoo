import test from 'node:test';
import assert from 'node:assert/strict';
import { UserController } from '../src/application/controllers/UserController.js';
import {
  AuthenticationError,
  DuplicateEmailError,
  ValidationError,
} from '../src/domain/errors/DomainError.js';

function createResponse() {
  return {
    statusCode: null,
    body: null,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function makeController(overrides = {}) {
  const calls = { register: [], authenticate: [] };
  const userService = {
    async register(input) {
      calls.register.push(input);
      if (overrides.registerError) throw overrides.registerError;
      return overrides.registerResult ?? { id: 'u1', name: 'Ana', email: 'ana@example.com', role: 'user' };
    },
    async authenticate(input) {
      calls.authenticate.push(input);
      if (overrides.authenticateError) throw overrides.authenticateError;
      return overrides.authenticateResult ?? {
        user: { id: 'u1', name: 'Ana', email: 'ana@example.com', role: 'user' },
        token: 'signed.jwt.token',
      };
    },
  };
  return { controller: new UserController(userService), calls };
}

test('cadastro retorna HTTP 201, encaminha apenas os campos do caso de uso e dados públicos', async () => {
  const { controller, calls } = makeController();
  const response = createResponse();
  await controller.register({
    body: { name: 'Ana', email: 'ana@example.com', password: 'secret', role: 'admin', passwordHash: 'hash' },
  }, response);

  assert.equal(response.statusCode, 201);
  assert.deepEqual(calls.register, [{ name: 'Ana', email: 'ana@example.com', password: 'secret' }]);
  assert.deepEqual(response.body, { id: 'u1', name: 'Ana', email: 'ana@example.com', role: 'user' });
  assert.equal(Object.hasOwn(response.body, 'password'), false);
  assert.equal(Object.hasOwn(response.body, 'passwordHash'), false);
});

test('cadastro retorna HTTP 400 para ValidationError', async () => {
  const { controller } = makeController({ registerError: new ValidationError('Invalid input.') });
  const response = createResponse();
  await controller.register({ body: {} }, response);
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { error: 'Invalid input.' });
});

test('cadastro retorna HTTP 409 para e-mail duplicado', async () => {
  const { controller } = makeController({ registerError: new DuplicateEmailError('Email already exists.') });
  const response = createResponse();
  await controller.register({ body: {} }, response);
  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.body, { error: 'Email already exists.' });
});

test('cadastro retorna HTTP 500 sem revelar detalhes de erros inesperados', async () => {
  const { controller } = makeController({ registerError: new Error('database password hash secret') });
  const response = createResponse();
  await controller.register({ body: {} }, response);
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, { error: 'Internal server error.' });
  assert.equal(JSON.stringify(response.body).includes('database password hash secret'), false);
});

test('login retorna HTTP 200 com usuário público e token', async () => {
  const { controller, calls } = makeController();
  const response = createResponse();
  await controller.login({ body: { email: 'ana@example.com', password: 'secret', userId: 'attacker' } }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls.authenticate, [{ email: 'ana@example.com', password: 'secret' }]);
  assert.deepEqual(response.body, {
    user: { id: 'u1', name: 'Ana', email: 'ana@example.com', role: 'user' },
    token: 'signed.jwt.token',
  });
  assert.equal(Object.hasOwn(response.body.user, 'password'), false);
  assert.equal(Object.hasOwn(response.body.user, 'passwordHash'), false);
  assert.equal(JSON.stringify(response.body).includes('secret'), false);
  assert.equal(JSON.stringify(response.body).includes('hash'), false);
});

test('login retorna HTTP 401 para credenciais inválidas', async () => {
  const { controller } = makeController({ authenticateError: new AuthenticationError('Invalid email or password.') });
  const response = createResponse();
  await controller.login({ body: { email: 'ana@example.com', password: 'wrong' } }, response);
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.body, { error: 'Invalid email or password.' });
});

test('login retorna HTTP 400 para ValidationError', async () => {
  const { controller } = makeController({ authenticateError: new ValidationError('Invalid login input.') });
  const response = createResponse();
  await controller.login({ body: {} }, response);
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { error: 'Invalid login input.' });
});

test('login retorna HTTP 500 sem revelar detalhes de erros inesperados', async () => {
  const { controller } = makeController({ authenticateError: new Error('private stack and secret') });
  const response = createResponse();
  await controller.login({ body: {} }, response);
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, { error: 'Internal server error.' });
  assert.equal(JSON.stringify(response.body).includes('private stack and secret'), false);
});
