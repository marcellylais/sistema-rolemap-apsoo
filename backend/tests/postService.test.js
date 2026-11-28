
import test from 'node:test';
import assert from 'node:assert/strict';
import { PostService } from '../src/application/services/PostService.js';
import { ValidationError } from '../src/domain/errors/DomainError.js';

function setup() {
  const posts = [];

  const repository = {
    create(post, authenticatedUserId) {
      const saved = {
        ...post,
        userId: authenticatedUserId,
        authorName: 'Ana',
        createdAt: '2026-11-28 10:00:00',
      };

      posts.push(saved);
      return saved;
    },

    findById(id) {
      return posts.find((post) => post.id === id) ?? null;
    },

    findRecent(limit = 20) {
      return posts.slice(-limit).reverse();
    },

    delete(id, authenticatedUserId) {
      const index = posts.findIndex((post) => post.id === id);

      if (index === -1) return false;

      if (posts[index].userId !== authenticatedUserId) {
        throw new Error('Permission denied.');
      }

      posts.splice(index, 1);
      return true;
    },
  };

  return {
    service: new PostService(repository),
    posts,
  };
}

test('cria postagem para o usuário autenticado', () => {
  const { service } = setup();

  const post = service.create(
    { content: 'Minha publicação' },
    { id: 'u1' },
  );

  assert.equal(post.content, 'Minha publicação');
  assert.equal(post.userId, 'u1');
  assert.ok(post.id);
});

test('não permite criar postagem sem autenticação', () => {
  const { service } = setup();

  assert.throws(
    () => service.create({ content: 'Minha publicação' }, null),
    ValidationError,
  );
});

test('não permite criar postagem sem dados válidos', () => {
  const { service } = setup();

  assert.throws(
    () => service.create(null, { id: 'u1' }),
    ValidationError,
  );
});

test('lista as postagens recentes', () => {
  const { service } = setup();

  service.create({ content: 'Primeira' }, { id: 'u1' });
  service.create({ content: 'Segunda' }, { id: 'u1' });

  const posts = service.findRecent();

  assert.equal(posts.length, 2);
  assert.equal(posts[0].content, 'Segunda');
});

test('busca uma postagem pelo identificador', () => {
  const { service } = setup();

  const created = service.create(
    { content: 'Publicação para buscar' },
    { id: 'u1' },
  );

  assert.equal(service.findById(created.id).content, 'Publicação para buscar');
  assert.equal(service.findById('inexistente'), null);
});

test('exclui uma postagem do usuário autenticado', () => {
  const { service } = setup();

  const post = service.create(
    { content: 'Publicação para excluir' },
    { id: 'u1' },
  );

  assert.equal(service.delete(post.id, { id: 'u1' }), true);
  assert.equal(service.findById(post.id), null);
});

test('retorna falso ao tentar excluir postagem inexistente', () => {
  const { service } = setup();

  assert.equal(service.delete('inexistente', { id: 'u1' }), false);
});
