import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { TokenService } from '../src/application/services/TokenService.js';
import { AuthenticationError, ValidationError } from '../src/domain/errors/DomainError.js';

const TEST_SECRET = 'rolemap-test-secret-with-sufficient-entropy';
const service = () => new TokenService(TEST_SECRET);

test('gera JWT com sub, role, expiração de uma hora e sem dados sensíveis', () => {
  const token = service().generateToken({
    id: 'user-123',
    role: 'user',
    password: 'plaintext-password',
    passwordHash: 'secret-hash',
    email: 'user@example.com',
  });
  const payload = jwt.decode(token);

  assert.equal(payload.sub, 'user-123');
  assert.equal(payload.role, 'user');
  assert.equal(payload.exp - payload.iat, 60 * 60);
  assert.equal(Object.hasOwn(payload, 'password'), false);
  assert.equal(Object.hasOwn(payload, 'passwordHash'), false);
  assert.equal(Object.hasOwn(payload, 'email'), false);
});

test('valida token válido e retorna os dados decodificados', () => {
  const tokenService = service();
  const verified = tokenService.verifyToken(tokenService.generateToken({ id: 'user-123', role: 'admin' }));
  assert.equal(verified.sub, 'user-123');
  assert.equal(verified.role, 'admin');
  assert.ok(verified.iat);
  assert.ok(verified.exp);
});

test('rejeita token inválido e malformado', () => {
  const tokenService = service();
  for (const token of ['not-a-jwt', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.invalid']) {
    assert.throws(() => tokenService.verifyToken(token), AuthenticationError);
  }
});

test('rejeita token expirado', () => {
  const tokenService = service();
  const expiredToken = jwt.sign(
    { sub: 'user-123', role: 'user' },
    TEST_SECRET,
    { algorithm: 'HS256', expiresIn: -1 },
  );
  assert.throws(() => tokenService.verifyToken(expiredToken), AuthenticationError);
});

test('rejeita segredo ausente ou vazio, sem fallback fixo', () => {
  const previousSecret = process.env.JWT_SECRET;
  try {
    delete process.env.JWT_SECRET;
    assert.throws(() => new TokenService(), /JWT_SECRET must be configured/);
    assert.throws(() => new TokenService(''), /JWT_SECRET must be configured/);
    assert.throws(() => new TokenService('   '), /JWT_SECRET must be configured/);
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test('rejeita usuário sem id ou role ao gerar token', () => {
  const tokenService = service();
  for (const user of [null, {}, { id: 'u1' }, { role: 'user' }, { id: '', role: 'user' }, { id: 'u1', role: '' }]) {
    assert.throws(() => tokenService.generateToken(user), ValidationError);
  }
});
