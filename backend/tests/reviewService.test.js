import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/infrastructure/database/connection.js';
import { ReviewService } from '../src/application/services/ReviewService.js';
import { ReviewRepository } from '../src/infrastructure/repositories/ReviewRepository.js';
import { PlaceRepository } from '../src/infrastructure/repositories/PlaceRepository.js';
import { UserRepository } from '../src/infrastructure/repositories/UserRepository.js';
import { Review } from '../src/domain/entities/Review.js';
import { PermissionError, ValidationError } from '../src/domain/errors/DomainError.js';

function setup() {
  const database = openDatabase({ databasePath: ':memory:' });
  const insertUser = database.prepare('INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)');
  insertUser.run('u1', 'Ana', 'ana@example.com', 'hash', 'user');
  insertUser.run('u2', 'Bia', 'bia@example.com', 'hash', 'user');
  insertUser.run('admin', 'Admin', 'admin@example.com', 'hash', 'admin');
  const insertPlace = database.prepare(`
    INSERT INTO places (id, title, category, latitude, longitude, author_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertPlace.run('p1', 'Parque', 'natureza', 0, 0, 'u1');
  insertPlace.run('p2', 'Museu', 'cultura', 0, 0, 'u1');
  const reviewRepository = new ReviewRepository(database);
  const placeRepository = new PlaceRepository(database);
  const userRepository = new UserRepository(database);
  return {
    database,
    reviewRepository,
    placeRepository,
    userRepository,
    service: new ReviewService(reviewRepository, placeRepository, userRepository),
  };
}

const user = (id, role = 'user') => ({ id, role });

test('cria avaliação com UUID e usa a identidade autenticada, ignorando userId enviado', () => {
  const { database, service } = setup();
  try {
    const { review, created } = service.createOrUpdate('p1', { rating: 5, comment: 'Excelente', userId: 'u2' }, user('u1'));
    assert.equal(created, true);
    assert.match(review.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    assert.equal(review.userId, 'u1');
    assert.equal(database.prepare('SELECT user_id FROM reviews WHERE id = ?').get(review.id).user_id, 'u1');
  } finally { database.close(); }
});

test('rejeita lugar inexistente e notas abaixo, acima ou fora do intervalo inteiro', () => {
  const { database, service } = setup();
  try {
    assert.throws(() => service.createOrUpdate('missing', { rating: 4 }, user('u1')), ValidationError);
    for (const rating of [0, 6, 2.5, '5']) {
      assert.throws(() => service.createOrUpdate('p1', { rating }, user('u1')), ValidationError);
    }
  } finally { database.close(); }
});

test('createOrUpdate e delete rejeitam identidades autenticadas inválidas', () => {
  const { database, service } = setup();
  try {
    const { review: existing, created } = service.createOrUpdate('p1', { rating: 4 }, user('u1'));
    assert.equal(created, true);
    const invalidIdentities = [null, {}, { id: '' }, { id: 42 }];

    for (const identity of invalidIdentities) {
      assert.throws(
        () => service.createOrUpdate('p1', { rating: 3 }, identity),
        ValidationError,
      );
      assert.throws(() => service.delete(existing.id, identity), ValidationError);
    }
  } finally { database.close(); }
});

test('preserva o comentário existente ao atualizar somente a nota', () => {
  const { database, service } = setup();
  try {
    const createdResult = service.createOrUpdate('p1', { rating: 3, comment: 'Comentário original' }, user('u1'));
    const updatedResult = service.createOrUpdate('p1', { rating: 5 }, user('u1'));
    const { review: created } = createdResult;
    const { review: updated, created: wasCreated } = updatedResult;

    assert.equal(createdResult.created, true);
    assert.equal(wasCreated, false);
    assert.equal(updated.id, created.id);
    assert.equal(updated.rating, 5);
    assert.equal(updated.comment, 'Comentário original');
    assert.equal(service.findByPlaceId('p1').length, 1);
  } finally { database.close(); }
});

test('RN01 atualiza avaliação existente preservando id e createdAt e alterando updatedAt', () => {
  const { database, reviewRepository, service } = setup();
  try {
    const oldCreatedAt = new Date('2024-01-01T10:00:00.000Z');
    reviewRepository.create(new Review({
      id: 'original-review',
      rating: 1,
      comment: 'Inicial',
      userId: 'u1',
      placeId: 'p1',
      createdAt: oldCreatedAt,
      updatedAt: oldCreatedAt,
    }));

    const { review: updated, created } = service.createOrUpdate('p1', { rating: 5, comment: 'Atualizada' }, user('u1'));
    assert.equal(created, false);
    assert.equal(updated.id, 'original-review');
    assert.equal(updated.rating, 5);
    assert.equal(updated.comment, 'Atualizada');
    assert.equal(updated.createdAt.toISOString(), oldCreatedAt.toISOString());
    assert.ok(updated.updatedAt > oldCreatedAt);
    assert.equal(service.findByPlaceId('p1').length, 1);
    const row = database.prepare('SELECT id, created_at, updated_at FROM reviews WHERE user_id = ? AND place_id = ?').get('u1', 'p1');
    assert.equal(row.id, 'original-review');
    assert.equal(row.created_at, oldCreatedAt.toISOString());
    assert.equal(row.updated_at, updated.updatedAt.toISOString());
  } finally { database.close(); }
});

test('consulta avaliação por id, lugar e usuário', () => {
  const { database, service } = setup();
  try {
    const { review: first } = service.createOrUpdate('p1', { rating: 4 }, user('u1'));
    const { review: second } = service.createOrUpdate('p1', { rating: 2 }, user('u2'));
    assert.equal(service.findById(first.id)?.id, first.id);
    assert.deepEqual(service.findByPlaceId('p1').map(({ id }) => id).sort(), [first.id, second.id].sort());
    assert.deepEqual(service.findByUserId('u1').map(({ id }) => id), [first.id]);
    assert.equal(service.findById('missing'), null);
    assert.deepEqual(service.findByPlaceId('missing'), []);
    assert.deepEqual(service.findByUserId('missing'), []);
  } finally { database.close(); }
});

test('autor ou administrador pode excluir; outro usuário é recusado sem alterar a avaliação', () => {
  const { database, service } = setup();
  try {
    const { review: authorReview } = service.createOrUpdate('p1', { rating: 4 }, user('u1'));
    const { review: otherReview } = service.createOrUpdate('p2', { rating: 3 }, user('u1'));
    assert.throws(() => service.delete(authorReview.id, user('u2')), PermissionError);
    assert.ok(service.findById(authorReview.id));
    assert.equal(service.delete(authorReview.id, user('u1')), true);
    assert.equal(service.findById(authorReview.id), null);
    assert.equal(service.delete(otherReview.id, user('admin', 'admin')), true);
    assert.equal(service.delete(otherReview.id, user('u1')), false);
  } finally { database.close(); }
});

test('média do lugar acompanha criação, atualização e exclusão de avaliações', () => {
  const { database, service } = setup();
  try {
    assert.equal(service.findPlaceById('p1').averageRating, null);
    const { review: first } = service.createOrUpdate('p1', { rating: 4 }, user('u1'));
    service.createOrUpdate('p1', { rating: 2 }, user('u2'));
    assert.equal(service.findPlaceById('p1').averageRating, 3);

    const { review: updated } = service.createOrUpdate('p1', { rating: 5 }, user('u1'));
    assert.equal(updated.id, first.id);
    assert.equal(service.findPlaceById('p1').averageRating, 3.5);
    service.delete(updated.id, user('u1'));
    assert.equal(service.findPlaceById('p1').averageRating, 2);
  } finally { database.close(); }
});
