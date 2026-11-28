import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/infrastructure/database/connection.js';
import { FavoriteService } from '../src/application/services/FavoriteService.js';
import { UserRepository } from '../src/infrastructure/repositories/UserRepository.js';
import { PlaceRepository } from '../src/infrastructure/repositories/PlaceRepository.js';
import { User } from '../src/domain/entities/User.js';
import { Place } from '../src/domain/entities/Place.js';
import { ValidationError } from '../src/domain/errors/DomainError.js';

function setup() {
  const database = openDatabase({ databasePath: ':memory:' });
  const userRepository = new UserRepository(database);
  userRepository.create(new User({ id: 'u1', name: 'Ana', email: 'ana@example.com', passwordHash: 'hash' }));
  userRepository.create(new User({ id: 'u2', name: 'Bia', email: 'bia@example.com', passwordHash: 'hash' }));
  const placeRepository = new PlaceRepository(database);
  placeRepository.create(new Place({
    id: 'p1', title: 'Parque', description: '', category: 'natureza',
    latitude: 0, longitude: 0, authorId: 'u1',
  }));
  placeRepository.create(new Place({
    id: 'p2', title: 'Museu', description: '', category: 'cultura',
    latitude: 0, longitude: 0, authorId: 'u1',
  }));
  return {
    database,
    userRepository,
    placeRepository,
    service: new FavoriteService(userRepository, placeRepository),
  };
}

const identity = (id) => ({ id });

test('adiciona favorito usando exclusivamente a identidade autenticada', () => {
  const { database, service, userRepository } = setup();
  try {
    assert.equal(service.addFavorite('p1', { id: 'u1', userId: 'u2' }), true);
    assert.equal(userRepository.hasFavorite('u1', 'p1'), true);
    assert.equal(userRepository.hasFavorite('u2', 'p1'), false);
  } finally { database.close(); }
});

test('rejeita favoritar lugar inexistente e mantém falso para favorito duplicado', () => {
  const { database, service } = setup();
  try {
    assert.throws(() => service.addFavorite('missing', identity('u1')), ValidationError);
    assert.equal(service.addFavorite('p1', identity('u1')), true);
    assert.equal(service.addFavorite('p1', identity('u1')), false);
  } finally { database.close(); }
});

test('remove favorito existente e retorna false quando não existe', () => {
  const { database, service } = setup();
  try {
    service.addFavorite('p1', identity('u1'));
    assert.equal(service.removeFavorite('p1', identity('u1')), true);
    assert.equal(service.removeFavorite('p1', identity('u1')), false);
  } finally { database.close(); }
});

test('lista e consulta favoritos do usuário autenticado', () => {
  const { database, service } = setup();
  try {
    service.addFavorite('p2', identity('u1'));
    service.addFavorite('p1', identity('u1'));
    service.addFavorite('p2', identity('u2'));
    assert.deepEqual(service.findFavorites(identity('u1')), ['p1', 'p2']);
    assert.deepEqual(service.findFavorites(identity('u2')), ['p2']);
    assert.equal(service.hasFavorite('p1', identity('u1')), true);
    assert.equal(service.hasFavorite('p2', identity('u1')), true);
    assert.equal(service.hasFavorite('p2', identity('u2')), true);
    assert.equal(service.hasFavorite('missing', identity('u1')), false);
  } finally { database.close(); }
});

test('todos os métodos autenticados rejeitam identidade ausente ou inválida', () => {
  const { database, service } = setup();
  try {
    const invalidIdentities = [null, {}, { id: '' }, { id: 1 }];
    for (const invalidIdentity of invalidIdentities) {
      assert.throws(() => service.addFavorite('p1', invalidIdentity), ValidationError);
      assert.throws(() => service.removeFavorite('p1', invalidIdentity), ValidationError);
      assert.throws(() => service.findFavorites(invalidIdentity), ValidationError);
      assert.throws(() => service.hasFavorite('p1', invalidIdentity), ValidationError);
    }
  } finally { database.close(); }
});

test('métodos com placeId rejeitam IDs inválidos', () => {
  const { database, service } = setup();
  try {
    for (const placeId of [null, '', '  ', 1]) {
      assert.throws(() => service.addFavorite(placeId, identity('u1')), ValidationError);
      assert.throws(() => service.removeFavorite(placeId, identity('u1')), ValidationError);
      assert.throws(() => service.hasFavorite(placeId, identity('u1')), ValidationError);
    }
  } finally { database.close(); }
});
