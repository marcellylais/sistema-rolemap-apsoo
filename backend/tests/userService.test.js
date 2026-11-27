import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { UserService } from '../src/application/services/UserService.js';
import { TokenService } from '../src/application/services/TokenService.js';
import { User } from '../src/domain/entities/User.js';
import { AuthenticationError, DuplicateEmailError, ValidationError } from '../src/domain/errors/DomainError.js';

function makeRepository() {
  const usersByEmail = new Map();
  return {
    usersByEmail,
    findByEmail(email) { return usersByEmail.get(email) ?? null; },
    create(user) {
      if (usersByEmail.has(user.email)) throw new DuplicateEmailError('A user with this email already exists.');
      usersByEmail.set(user.email, user);
      return user;
    },
  };
}

const TEST_SECRET = 'rolemap-user-service-test-secret';

function makeService(repository = makeRepository(), passwordHasher = bcrypt, tokenService = new TokenService(TEST_SECRET)) {
  return { repository, service: new UserService(repository, passwordHasher, tokenService) };
}

test('cadastra usuário com e-mail normalizado, hash BCrypt e papel comum', async () => {
  const { repository, service } = makeService();
  const result = await service.register({
    name: '  Ana Rita ',
    email: ' ANA@EXAMPLE.COM ',
    password: 'minha-senha-secreta',
    role: 'admin',
  });

  assert.equal(result.name, 'Ana Rita');
  assert.equal(result.email, 'ana@example.com');
  assert.equal(result.role, 'user');
  assert.equal(Object.hasOwn(result, 'passwordHash'), false);
  assert.equal(Object.hasOwn(result, 'password'), false);
  assert.equal(Object.hasOwn(result, 'token'), false);

  const storedUser = repository.findByEmail('ana@example.com');
  assert.ok(storedUser instanceof User);
  assert.match(storedUser.passwordHash, /^\$2[aby]\$10\$/);
  assert.notEqual(storedUser.passwordHash, 'minha-senha-secreta');
  assert.equal(await bcrypt.compare('minha-senha-secreta', storedUser.passwordHash), true);
});

test('rejeita campos obrigatórios ausentes ou inválidos no cadastro', async () => {
  const { service } = makeService();
  for (const input of [
    {},
    { name: '', email: 'ana@example.com', password: 'senha' },
    { name: 'Ana', email: 'email-inválido', password: 'senha' },
    { name: 'Ana', email: 'ana@example.com', password: '' },
  ]) {
    await assert.rejects(service.register(input), ValidationError);
  }
});

test('rejeita e-mail já cadastrado', async () => {
  const { service } = makeService();
  await service.register({ name: 'Ana', email: 'ana@example.com', password: 'senha' });
  await assert.rejects(
    service.register({ name: 'Outra Ana', email: ' ANA@EXAMPLE.COM ', password: 'outra-senha' }),
    DuplicateEmailError,
  );
});

test('autentica credenciais válidas e retorna usuário público com JWT', async () => {
  const { service } = makeService();
  await service.register({ name: 'Ana', email: 'ana@example.com', password: 'senha-segura' });
  const result = await service.authenticate({ email: ' ANA@EXAMPLE.COM ', password: 'senha-segura' });
  assert.deepEqual(Object.keys(result).sort(), ['token', 'user']);
  assert.deepEqual(Object.keys(result.user).sort(), ['email', 'id', 'name', 'role']);
  assert.equal(result.user.email, 'ana@example.com');
  assert.equal(Object.hasOwn(result.user, 'passwordHash'), false);
  assert.equal(Object.hasOwn(result.user, 'password'), false);
  const claims = new TokenService(TEST_SECRET).verifyToken(result.token);
  assert.equal(claims.sub, result.user.id);
  assert.equal(claims.role, result.user.role);
});

test('credenciais inválidas e e-mail inexistente não geram token', async () => {
  let tokenGenerationCount = 0;
  const tokenService = {
    generateToken(user) {
      tokenGenerationCount += 1;
      return new TokenService(TEST_SECRET).generateToken(user);
    },
  };
  const { service } = makeService(makeRepository(), bcrypt, tokenService);
  await service.register({ name: 'Ana', email: 'ana@example.com', password: 'senha-certa' });

  const invalidPassword = await service.authenticate({ email: 'ana@example.com', password: 'senha-errada' })
    .then(() => null, (error) => error);
  const missingEmail = await service.authenticate({ email: 'inexistente@example.com', password: 'senha-qualquer' })
    .then(() => null, (error) => error);
  assert.ok(invalidPassword instanceof AuthenticationError);
  assert.ok(missingEmail instanceof AuthenticationError);
  assert.equal(invalidPassword.message, 'Invalid email or password.');
  assert.equal(missingEmail.message, invalidPassword.message);
  assert.equal(tokenGenerationCount, 0);
});

test('construtor rejeita TokenService sem generateToken', () => {
  assert.throws(
    () => new UserService(makeRepository(), bcrypt, {}),
    /TokenService with a generateToken method/,
  );
});
