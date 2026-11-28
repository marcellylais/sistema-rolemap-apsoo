import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/infrastructure/database/connection.js';
import { UserRepository } from '../src/infrastructure/repositories/UserRepository.js';
import { User } from '../src/domain/entities/User.js';
import { DuplicateEmailError } from '../src/domain/errors/DomainError.js';

function setup() {
  const database = openDatabase({ databasePath: ':memory:' });
  return { database, repository: new UserRepository(database) };
}

function seedUserAndPlace(database, userId = 'u1', placeId = 'p1', authorId = userId) {
  database.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
    .run(userId, userId, `${userId}@example.com`, 'hash');
  if (authorId !== userId) {
    database.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
      .run(authorId, authorId, `${authorId}@example.com`, 'hash');
  }
  database.prepare(`
    INSERT INTO places (id, title, category, latitude, longitude, author_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(placeId, placeId, 'categoria', 0, 0, authorId);
}

const user = (id, email, options = {}) => new User({
  id,
  name: options.name ?? 'Ana',
  email,
  passwordHash: options.passwordHash ?? 'password-hash',
  role: options.role ?? 'user',
});

test('cadastra usuário e converte as buscas em entidade User', () => {
  const { database, repository } = setup();
  try {
    const created = user('u1', ' ANA@example.com ');
    assert.equal(repository.create(created), created);

    const byId = repository.findById('u1');
    assert.ok(byId instanceof User);
    assert.equal(byId.email, 'ana@example.com');
    assert.equal(byId.passwordHash, 'password-hash');
    assert.equal(repository.findByEmail('  ANA@EXAMPLE.COM ' )?.id, 'u1');
    assert.equal(repository.findById('missing'), null);
    assert.equal(repository.findByEmail('missing@example.com'), null);
  } finally { database.close(); }
});

test('atualiza nome, e-mail e papel sem alterar o hash da senha', () => {
  const { database, repository } = setup();
  try {
    repository.create(user('u1', 'ana@example.com'));
    const changedUser = user('u1', '  ANA.NOVA@example.com ', { name: 'Ana Nova', role: 'admin', passwordHash: 'other-hash' });
    assert.equal(repository.update(changedUser), true);
    const updated = repository.findById('u1');
    assert.equal(updated.name, 'Ana Nova');
    assert.equal(updated.email, 'ana.nova@example.com');
    assert.equal(updated.role, 'admin');
    assert.equal(updated.passwordHash, 'password-hash');
    assert.equal(repository.update(user('missing', 'missing@example.com')), false);
  } finally { database.close(); }
});

test('exclui usuário e informa se algum registro foi removido', () => {
  const { database, repository } = setup();
  try {
    repository.create(user('u1', 'ana@example.com'));
    assert.equal(repository.delete('u1'), true);
    assert.equal(repository.findById('u1'), null);
    assert.equal(repository.delete('u1'), false);
  } finally { database.close(); }
});

test('traduz somente conflito de e-mail duplicado em erro de domínio', () => {
  const { database, repository } = setup();
  try {
    repository.create(user('u1', 'ana@example.com'));
    assert.throws(() => repository.create(user('u2', 'ANA@example.com')), DuplicateEmailError);
    repository.create(user('u3', 'outra@example.com'));
    assert.throws(
      () => repository.update(user('u3', 'ana@example.com')),
      DuplicateEmailError,
    );
  } finally { database.close(); }
});

test('adiciona favorito e retorna false sem duplicar vínculo existente', () => {
  const { database, repository } = setup();
  try {
    seedUserAndPlace(database);
    assert.equal(repository.addFavorite('u1', 'p1'), true);
    assert.equal(repository.addFavorite('u1', 'p1'), false);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM favorites WHERE user_id = ? AND place_id = ?').get('u1', 'p1').count, 1);
  } finally { database.close(); }
});

test('remove favorito retorna se removeu um vínculo', () => {
  const { database, repository } = setup();
  try {
    seedUserAndPlace(database);
    repository.addFavorite('u1', 'p1');
    assert.equal(repository.removeFavorite('u1', 'p1'), true);
    assert.equal(repository.removeFavorite('u1', 'p1'), false);
  } finally { database.close(); }
});

test('lista favoritos em ordem determinística e consulta vínculos existentes', () => {
  const { database, repository } = setup();
  try {
    seedUserAndPlace(database, 'u1', 'p1');
    database.prepare('INSERT INTO places (id, title, category, latitude, longitude, author_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run('p2', 'p2', 'categoria', 0, 0, 'u1');
    database.prepare('INSERT INTO places (id, title, category, latitude, longitude, author_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run('p3', 'p3', 'categoria', 0, 0, 'u1');
    repository.addFavorite('u1', 'p3');
    repository.addFavorite('u1', 'p1');
    repository.addFavorite('u1', 'p2');

    assert.deepEqual(repository.findFavoritePlaceIds('u1'), ['p1', 'p2', 'p3']);
    assert.equal(repository.hasFavorite('u1', 'p2'), true);
    assert.equal(repository.hasFavorite('u1', 'missing'), false);
  } finally { database.close(); }
});

test('usuário sem favoritos recebe lista vazia e hasFavorite false', () => {
  const { database, repository } = setup();
  try {
    repository.create(user('u1', 'ana@example.com'));
    assert.deepEqual(repository.findFavoritePlaceIds('u1'), []);
    assert.equal(repository.hasFavorite('u1', 'p1'), false);
  } finally { database.close(); }
});

test('favorito com usuário ou lugar inexistente propaga erro de chave estrangeira', () => {
  const { database, repository } = setup();
  try {
    seedUserAndPlace(database);
    assert.throws(() => repository.addFavorite('missing-user', 'p1'), /FOREIGN KEY constraint failed/);
    assert.throws(() => repository.addFavorite('u1', 'missing-place'), /FOREIGN KEY constraint failed/);
  } finally { database.close(); }
});

test('excluir usuário ou lugar remove vínculos de favoritos por cascade', () => {
  const { database, repository } = setup();
  try {
    seedUserAndPlace(database, 'u1', 'p1', 'u2');
    database.prepare('INSERT INTO places (id, title, category, latitude, longitude, author_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run('p2', 'p2', 'categoria', 0, 0, 'u2');
    repository.addFavorite('u1', 'p1');
    repository.addFavorite('u1', 'p2');

    assert.equal(repository.delete('u1'), true);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM favorites WHERE user_id = ?').get('u1').count, 0);

    repository.create(user('u3', 'carol@example.com'));
    repository.addFavorite('u3', 'p2');
    database.prepare('DELETE FROM places WHERE id = ?').run('p2');
    assert.equal(repository.hasFavorite('u3', 'p2'), false);
  } finally { database.close(); }
});
