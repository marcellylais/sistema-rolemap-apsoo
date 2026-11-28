import test from 'node:test';
import assert from 'node:assert/strict';
import { FeedService } from '../src/application/services/FeedService.js';
import { ValidationError } from '../src/domain/errors/DomainError.js';

function setup() {
  const posts = [
    {
      id: 'p1',
      content: 'Minha primeira postagem',
      userId: 'u1',
      authorName: 'Ana',
      createdAt: '2025-01-01T10:00:00.000Z',
    },
    {
      id: 'p2',
      content: 'Outra postagem',
      userId: 'u2',
      authorName: 'Bia',
      createdAt: '2025-01-03T10:00:00.000Z',
    },
  ];

  const reviews = [
    {
      id: 'r1',
      rating: 5,
      comment: 'Lugar incrível',
      userId: 'u1',
      placeId: 'place-1',
      createdAt: new Date('2025-01-02T10:00:00.000Z'),
    },
  ];

  const postRepository = {
    findRecent(limit) {
      return posts.slice(0, limit);
    },
  };

  const reviewRepository = {
    findRecentPublic(limit) {
      return reviews.slice(0, limit);
    },
  };

  return new FeedService(postRepository, reviewRepository);
}

test('combina postagens e avaliações no feed', () => {
  const service = setup();

  const feed = service.findRecent();

  assert.equal(feed.length, 3);
  assert.equal(feed.filter((item) => item.type === 'post').length, 2);
  assert.equal(feed.filter((item) => item.type === 'review').length, 1);
});

test('ordena os conteúdos do mais recente para o mais antigo', () => {
  const service = setup();

  const feed = service.findRecent();

  assert.deepEqual(
    feed.map((item) => item.id),
    ['p2', 'r1', 'p1'],
  );
});

test('retorna somente a quantidade solicitada', () => {
  const service = setup();

  const feed = service.findRecent(2);

  assert.equal(feed.length, 2);
});

test('rejeita limites inválidos', () => {
  const service = setup();

  assert.throws(() => service.findRecent(0), ValidationError);
  assert.throws(() => service.findRecent(101), ValidationError);
  assert.throws(() => service.findRecent(1.5), ValidationError);
});

test('retorna lista vazia quando não existem conteúdos', () => {
  const service = new FeedService(
    { findRecent: () => [] },
    { findRecentPublic: () => [] },
  );

  assert.deepEqual(service.findRecent(), []);
});

test('exige os repositórios necessários', () => {
  assert.throws(
    () => new FeedService(null, null),
    TypeError,
  );

  assert.throws(
    () => new FeedService({ findRecent() {} }, null),
    TypeError,
  );
});


test('encaminha o limite solicitado aos dois repositórios', () => {
  let postLimit;
  let reviewLimit;

  const service = new FeedService(
    {
      findRecent(limit) {
        postLimit = limit;
        return [];
      },
    },
    {
      findRecentPublic(limit) {
        reviewLimit = limit;
        return [];
      },
    },
  );

  service.findRecent(10);

  assert.equal(postLimit, 10);
  assert.equal(reviewLimit, 10);
});

test('aceita o limite máximo de 100 itens', () => {
  let receivedPostLimit;
  let receivedReviewLimit;

  const service = new FeedService(
    {
      findRecent(limit) {
        receivedPostLimit = limit;
        return [];
      },
    },
    {
      findRecentPublic(limit) {
        receivedReviewLimit = limit;
        return [];
      },
    },
  );

  const feed = service.findRecent(100);

  assert.deepEqual(feed, []);
  assert.equal(receivedPostLimit, 100);
  assert.equal(receivedReviewLimit, 100);
});
