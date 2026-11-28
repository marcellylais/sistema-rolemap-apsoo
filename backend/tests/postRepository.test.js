
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/infrastructure/database/connection.js';
import { PostRepository } from '../src/infrastructure/repositories/PostRepository.js';
import { Post } from '../src/domain/entities/Post.js';
import { PermissionError, ValidationError } from '../src/domain/errors/DomainError.js';

function setup() {
  const database = openDatabase({ databasePath: ':memory:' });

  database.prepare(`
    INSERT INTO users (id, name, email, password_hash, role)
    VALUES (?, ?, ?, ?, ?)
  `).run('u1', 'Ana', 'ana@example.com', 'hash', 'user');

  database.prepare(`
    INSERT INTO users (id, name, email, password_hash, role)
    VALUES (?, ?, ?, ?, ?)
  `).run('u2', 'Bia', 'bia@example.com', 'hash', 'user');

  database.prepare(`
    INSERT INTO users (id, name, email, password_hash, role)
    VALUES (?, ?, ?, ?, ?)
  `).run('admin', 'Administrador', 'admin@example.com', 'hash', 'admin');

  return { database, repository: new PostRepository(database) };
}

const makePost = (id = 'post1', overrides = {}) => new Post({
  id,
  content: 'Minha primeira publicação',
  userId: 'u1',
  ...overrides,
});

test('cria postagem e identifica o autor autenticado', () => {
  const { database, repository } = setup();

  try {
    const post = repository.create(makePost('post1', { userId: 'u2' }), 'u1');

    assert.equal(post.id, 'post1');
    assert.equal(post.content, 'Minha primeira publicação');
    assert.equal(post.userId, 'u1');
    assert.equal(post.authorName, 'Ana');
    assert.ok(post.createdAt);
  } finally {
    database.close();
  }
});

test('impede criação sem usuário autenticado', () => {
  const { database, repository } = setup();

  try {
    assert.throws(
      () => repository.create(makePost(), ''),
      ValidationError,
    );
  } finally {
    database.close();
  }
});

test('busca postagem pelo identificador', () => {
  const { database, repository } = setup();

  try {
    repository.create(makePost(), 'u1');

    assert.equal(repository.findById('post1').content, 'Minha primeira publicação');
    assert.equal(repository.findById('inexistente'), null);
  } finally {
    database.close();
  }
});

test('lista postagens recentes com nome do autor', () => {
  const { database, repository } = setup();

  try {
    repository.create(makePost('post1'), 'u1');
    repository.create(makePost('post2', { content: 'Outra publicação' }), 'u2');

    const posts = repository.findRecent();

    assert.equal(posts.length, 2);
    assert.deepEqual(posts.map(({ id }) => id), ['post2', 'post1']);
    assert.equal(posts[0].authorName, 'Bia');
  } finally {
    database.close();
  }
});

test('valida o limite de postagens consultadas', () => {
  const { database, repository } = setup();

  try {
    assert.throws(() => repository.findRecent(0), ValidationError);
    assert.throws(() => repository.findRecent(101), ValidationError);
  } finally {
    database.close();
  }
});

test('autor pode excluir sua própria postagem', () => {
  const { database, repository } = setup();

  try {
    repository.create(makePost(), 'u1');

    assert.equal(repository.delete('post1', 'u1'), true);
    assert.equal(repository.findById('post1'), null);
  } finally {
    database.close();
  }
});

test('administrador pode excluir postagem de outro usuário', () => {
  const { database, repository } = setup();

  try {
    repository.create(makePost(), 'u1');

    assert.equal(repository.delete('post1', 'admin'), true);
    assert.equal(repository.findById('post1'), null);
  } finally {
    database.close();
  }
});

test('usuário diferente não pode excluir postagem alheia', () => {
  const { database, repository } = setup();

  try {
    repository.create(makePost(), 'u1');

    assert.throws(
      () => repository.delete('post1', 'u2'),
      PermissionError,
    );

    assert.ok(repository.findById('post1'));
  } finally {
    database.close();
  }
});

test('retorna falso ao excluir postagem inexistente', () => {
  const { database, repository } = setup();

  try {
    assert.equal(repository.delete('inexistente', 'u1'), false);
  } finally {
    database.close();
  }
});
