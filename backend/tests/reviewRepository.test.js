import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/infrastructure/database/connection.js';
import { ReviewRepository } from '../src/infrastructure/repositories/ReviewRepository.js';
import { Review } from '../src/domain/entities/Review.js';

function setup() {
  const database = openDatabase({ databasePath: ':memory:' });
  database.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
    .run('u1', 'Ana', 'ana@example.com', 'hash');
  database.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
    .run('u2', 'Bia', 'bia@example.com', 'hash');
  database.prepare('INSERT INTO places (id, title, category, latitude, longitude, author_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run('p1', 'Parque', 'natureza', 0, 0, 'u1');
  database.prepare('INSERT INTO places (id, title, category, latitude, longitude, author_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run('p2', 'Museu', 'cultura', 0, 0, 'u1');
  return { database, repository: new ReviewRepository(database) };
}

const makeReview = ({
  id = 'r1', rating = 4, comment = 'Bom lugar', userId = 'u1', placeId = 'p1',
  createdAt = new Date('2025-01-01T10:00:00.000Z'), updatedAt = createdAt,
} = {}) => new Review({ id, rating, comment, userId, placeId, createdAt, updatedAt });

test('cria avaliação e retorna uma instância de Review', () => {
  const { database, repository } = setup();
  try {
    const saved = repository.create(makeReview());
    assert.ok(saved instanceof Review);
    assert.equal(saved.id, 'r1');
    assert.equal(saved.rating, 4);
    assert.equal(saved.comment, 'Bom lugar');
    assert.equal(saved.userId, 'u1');
    assert.equal(saved.placeId, 'p1');
  } finally { database.close(); }
});

test('busca por id, lugar e usuário', () => {
  const { database, repository } = setup();
  try {
    repository.create(makeReview());
    repository.create(makeReview({ id: 'r2', userId: 'u2', placeId: 'p1', rating: 3 }));
    repository.create(makeReview({ id: 'r3', userId: 'u1', placeId: 'p2', rating: 5 }));

    assert.equal(repository.findById('r1')?.id, 'r1');
    assert.deepEqual(repository.findByPlaceId('p1').map((review) => review.id), ['r1', 'r2']);
    assert.deepEqual(repository.findByUserId('u1').map((review) => review.id), ['r1', 'r3']);
    assert.ok(repository.findByPlaceId('p1').every((review) => review instanceof Review));
  } finally { database.close(); }
});

test('atualiza avaliação existente sem criar segunda avaliação ou trocar id e created_at', () => {
  const { database, repository } = setup();
  try {
    const firstCreatedAt = new Date('2025-01-01T10:00:00.000Z');
    repository.create(makeReview({ id: 'original-id', createdAt: firstCreatedAt }));
    const nextCreatedAt = new Date('2025-03-05T12:00:00.000Z');
    const nextUpdatedAt = new Date('2025-03-05T12:30:00.000Z');

    const saved = repository.create(makeReview({
      id: 'new-id-is-ignored', rating: 2, comment: 'Atualizada',
      createdAt: nextCreatedAt, updatedAt: nextUpdatedAt,
    }));

    assert.equal(saved.id, 'original-id');
    assert.equal(saved.rating, 2);
    assert.equal(saved.comment, 'Atualizada');
    assert.equal(saved.createdAt.toISOString(), firstCreatedAt.toISOString());
    assert.equal(saved.updatedAt.toISOString(), nextUpdatedAt.toISOString());
    assert.equal(repository.findByPlaceId('p1').length, 1);

    const row = database.prepare('SELECT id, created_at, updated_at FROM reviews WHERE user_id = ? AND place_id = ?').get('u1', 'p1');
    assert.equal(row.id, 'original-id');
    assert.equal(row.created_at, firstCreatedAt.toISOString());
    assert.equal(row.updated_at, nextUpdatedAt.toISOString());
  } finally { database.close(); }
});

test('exclui avaliação e informa quando nenhum registro existe', () => {
  const { database, repository } = setup();
  try {
    repository.create(makeReview());
    assert.equal(repository.delete('r1'), true);
    assert.equal(repository.findById('r1'), null);
    assert.equal(repository.delete('r1'), false);
  } finally { database.close(); }
});

test('buscas sem resultados retornam null ou listas vazias', () => {
  const { database, repository } = setup();
  try {
    assert.equal(repository.findById('missing'), null);
    assert.deepEqual(repository.findByPlaceId('missing'), []);
    assert.deepEqual(repository.findByUserId('missing'), []);
  } finally { database.close(); }
});

test('lista avaliações públicas mais recentes primeiro', () => {
  const { database, repository } = setup();

  try {
    repository.create(makeReview({
      id: 'r1',
      createdAt: new Date('2025-01-01T10:00:00.000Z'),
    }));

    repository.create(makeReview({
      id: 'r2',
      userId: 'u2',
      createdAt: new Date('2025-03-01T10:00:00.000Z'),
    }));

    repository.create(makeReview({
      id: 'r3',
      placeId: 'p2',
      createdAt: new Date('2025-02-01T10:00:00.000Z'),
    }));

    const reviews = repository.findRecentPublic();

    assert.deepEqual(
      reviews.map((review) => review.id),
      ['r2', 'r3', 'r1'],
    );
  } finally {
    database.close();
  }
});

test('não exibe avaliações com nota ocultada pela moderação', () => {
  const { database, repository } = setup();

  try {
    repository.create(makeReview({ id: 'r1' }));
    repository.create(makeReview({
      id: 'r2',
      userId: 'u2',
      placeId: 'p2',
    }));

    database.prepare(`
      INSERT INTO review_content_moderation
        (review_id, target_type, visibility_state, updated_at)
      VALUES (?, 'rating', 'auto_hidden', CURRENT_TIMESTAMP)
    `).run('r1');

    const reviews = repository.findRecentPublic();

    assert.deepEqual(reviews.map((review) => review.id), ['r2']);
  } finally {
    database.close();
  }
});

test('mantém avaliação no feed quando somente o comentário está ocultado', () => {
  const { database, repository } = setup();

  try {
    repository.create(makeReview({
      id: 'r1',
      comment: 'Comentário denunciado',
    }));

    database.prepare(`
      INSERT INTO review_content_moderation
        (review_id, target_type, visibility_state, updated_at)
      VALUES (?, 'comment', 'auto_hidden', CURRENT_TIMESTAMP)
    `).run('r1');

    const reviews = repository.findRecentPublic();

    assert.equal(reviews.length, 1);
    assert.equal(reviews[0].id, 'r1');
    assert.equal(reviews[0].comment, null);
    assert.equal(reviews[0].commentHidden, true);
    assert.equal(reviews[0].rating, 4);
  } finally {
    database.close();
  }
});
