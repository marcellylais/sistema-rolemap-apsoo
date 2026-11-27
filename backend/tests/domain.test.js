import test from 'node:test';
import assert from 'node:assert/strict';
import { User } from '../src/domain/entities/User.js';
import { Place } from '../src/domain/entities/Place.js';
import { Review } from '../src/domain/entities/Review.js';
import { Itinerary } from '../src/domain/entities/Itinerary.js';
import { ValidationError, PermissionError, DuplicatePlaceError } from '../src/domain/errors/DomainError.js';

const makeUser = (id = 'u1', role = 'user') => new User({ id, name: ' Ana ', email: 'ANA@example.com', passwordHash: 'hash', role });
const makePlace = (id = 'p1') => new Place({ id, title: ' Parque ', category: ' natureza ', latitude: -23.5, longitude: -46.6, authorId: 'author' });
const makeReview = (id, userId, rating, comment = '') => new Review({ id, userId, placeId: 'p1', rating, comment });

test('cria usuário válido, normaliza e gerencia favoritos', () => {
  const user = makeUser();
  assert.equal(user.name, 'Ana');
  assert.equal(user.email, 'ana@example.com');
  user.addFavorite('p1'); user.addFavorite('p1');
  assert.deepEqual(user.favoritePlaceIds, ['p1']);
  assert.equal(user.removeFavorite('p1'), true);
  assert.throws(() => new User({ id: 'u', name: '', email: 'a', passwordHash: 'h' }), ValidationError);
});

test('valida limites e tipos das coordenadas', () => {
  assert.doesNotThrow(() => new Place({ id: 'p', title: 'x', category: 'x', authorId: 'u', latitude: 90, longitude: -180 }));
  for (const [latitude, longitude] of [[90.1, 0], [0, -180.1], ['1', 0], [NaN, 0], [0, Infinity]]) {
    assert.throws(() => new Place({ id: 'p', title: 'x', category: 'x', authorId: 'u', latitude, longitude }), ValidationError);
  }
});

test('calcula média de avaliações e indica ausência de avaliações', () => {
  const place = makePlace();
  assert.equal(place.averageRating, null);
  place.addOrUpdateReview(makeReview('r1', 'u1', 4));
  place.addOrUpdateReview(makeReview('r2', 'u2', 2));
  assert.equal(place.averageRating, 3);
});

test('uma avaliação por usuário e lugar: segunda avaliação atualiza a existente', () => {
  const place = makePlace();
  const first = place.addOrUpdateReview(makeReview('r1', 'u1', 2, 'antes'));
  const updated = place.addOrUpdateReview(makeReview('r2', 'u1', 5, 'depois'));
  assert.equal(updated, first);
  assert.equal(place.reviews.length, 1);
  assert.equal(place.reviews[0].rating, 5);
  assert.equal(place.reviews[0].comment, 'depois');
  assert.throws(() => place.addOrUpdateReview(new Review({ id: 'r3', userId: 'u2', placeId: 'outro', rating: 3 })), ValidationError);
});

test('rejeita nota fora de 1 a 5', () => {
  for (const rating of [0, 6, 2.5, '5']) assert.throws(() => makeReview('r', 'u', rating), ValidationError);
});

test('roteiro mantém ordem, remove lugares e impede duplicatas', () => {
  const itinerary = new Itinerary({ id: 'i1', title: 'Fim de semana', ownerId: 'u1', placeIds: ['p1', 'p2'] });
  assert.deepEqual(itinerary.placeIds, ['p1', 'p2']);
  assert.throws(() => itinerary.addPlace('p1'), DuplicatePlaceError);
  assert.equal(itinerary.removePlace('p1'), true);
  assert.deepEqual(itinerary.placeIds, ['p2']);
  assert.equal(itinerary.removePlace('ausente'), false);
});

test('autor e administrador podem editar informações descritivas', () => {
  const place = makePlace();
  assert.equal(place.canBeEditedBy(makeUser('author')), true);
  assert.equal(place.canBeEditedBy(makeUser('admin', 'admin')), true);
  place.updateDescription({ title: 'Novo nome' }, makeUser('author'));
  assert.equal(place.title, 'Novo nome');
});

test('atualiza e normaliza a categoria ao editar o lugar', () => {
  const place = makePlace();
  place.updateDescription({ category: '  cultura  ' }, makeUser('author'));
  assert.equal(place.category, 'cultura');
});

test('erros específicos mantêm seus nomes de classe', () => {
  assert.equal(new ValidationError('inválido').name, 'ValidationError');
  assert.equal(new PermissionError('proibido').name, 'PermissionError');
  assert.equal(new DuplicatePlaceError('duplicado').name, 'DuplicatePlaceError');
});

test('usuário sem permissão não pode editar lugar', () => {
  const place = makePlace();
  assert.equal(place.canBeEditedBy(makeUser('other')), false);
  assert.throws(() => place.updateDescription({ title: 'Invadido' }, makeUser('other')), PermissionError);
});
