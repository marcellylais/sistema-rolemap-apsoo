import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/infrastructure/database/connection.js';
import { ItineraryRepository } from '../src/infrastructure/repositories/ItineraryRepository.js';
import { Itinerary } from '../src/domain/entities/Itinerary.js';
import { DuplicatePlaceError, PermissionError } from '../src/domain/errors/DomainError.js';

function setup() {
  const database = openDatabase({ databasePath: ':memory:' });
  for (const [id, email] of [['u1', 'ana@example.com'], ['u2', 'bia@example.com']]) {
    database.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
      .run(id, id, email, 'hash');
  }
  for (const id of ['p1', 'p2', 'p3']) {
    database.prepare(`
      INSERT INTO places (id, title, category, latitude, longitude, author_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, id, 'categoria', 0, 0, 'u1');
  }
  return { database, repository: new ItineraryRepository(database) };
}

const makeItinerary = (id = 'i1', overrides = {}) => new Itinerary({
  id,
  title: 'Passeio',
  description: 'Roteiro de fim de semana',
  ownerId: 'u1',
  placeIds: ['p2', 'p1'],
  ...overrides,
});

test('cria roteiro e guarda seus lugares na ordem informada', () => {
  const { database, repository } = setup();
  try {
    const itinerary = makeItinerary();
    assert.ok(repository.create(itinerary, 'u1') instanceof Itinerary);
    assert.deepEqual(repository.findById('i1').placeIds, ['p2', 'p1']);
    assert.deepEqual(database.prepare('SELECT place_id, position FROM itinerary_places WHERE itinerary_id = ? ORDER BY position').all('i1'), [
      { place_id: 'p2', position: 0 },
      { place_id: 'p1', position: 1 },
    ]);
  } finally { database.close(); }
});

test('recupera roteiro por proprietário como instância de Itinerary', () => {
  const { database, repository } = setup();
  try {
    repository.create(makeItinerary('i1'), 'u1');
    repository.create(makeItinerary('i2', { title: 'Outro', placeIds: ['p3'] }), 'u1');
    repository.create(makeItinerary('i3', { ownerId: 'u1', placeIds: [] }), 'u2');
    const results = repository.findByOwnerId('u1');
    assert.ok(results.every((itinerary) => itinerary instanceof Itinerary));
    assert.deepEqual(results.map(({ id }) => id), ['i1', 'i2']);
    assert.deepEqual(results[1].placeIds, ['p3']);
    assert.deepEqual(repository.findByOwnerId('missing'), []);
    assert.deepEqual(repository.findByOwnerId('u2').map(({ id }) => id), ['i3']);
  } finally { database.close(); }
});

test('impede lugar duplicado e garante rollback se uma associação for inválida', () => {
  const { database, repository } = setup();
  try {
    assert.throws(() => makeItinerary('duplicate', { placeIds: ['p1', 'p1'] }), DuplicatePlaceError);
    assert.throws(
      () => repository.create(makeItinerary('invalid-place', { placeIds: ['p1', 'missing'] }), 'u1'),
      /FOREIGN KEY constraint failed/,
    );
    assert.equal(repository.findById('invalid-place'), null);
  } finally { database.close(); }
});

test('adiciona e remove lugares preservando a ordem restante', () => {
  const { database, repository } = setup();
  try {
    repository.create(makeItinerary(), 'u1');
    assert.equal(repository.addPlace('i1', 'p3', 'u1'), true);
    assert.deepEqual(repository.findById('i1').placeIds, ['p2', 'p1', 'p3']);
    assert.throws(() => repository.addPlace('i1', 'p1', 'u1'), DuplicatePlaceError);
    assert.equal(repository.removePlace('i1', 'p1', 'u1'), true);
    assert.deepEqual(repository.findById('i1').placeIds, ['p2', 'p3']);
    assert.equal(repository.removePlace('i1', 'missing', 'u1'), false);
  } finally { database.close(); }
});

test('atualiza dados principais e a lista ordenada em uma operação', () => {
  const { database, repository } = setup();
  try {
    repository.create(makeItinerary(), 'u1');
    const updated = makeItinerary('i1', {
      title: 'Passeio atualizado',
      description: 'Nova descrição',
      ownerId: 'u2',
      placeIds: ['p3', 'p1'],
    });
    assert.equal(repository.update(updated, 'u1'), true);
    const found = repository.findById('i1');
    assert.equal(found.title, 'Passeio atualizado');
    assert.equal(found.description, 'Nova descrição');
    assert.equal(found.ownerId, 'u1');
    assert.deepEqual(found.placeIds, ['p3', 'p1']);
    assert.equal(repository.update(makeItinerary('missing'), 'u1'), false);
  } finally { database.close(); }
});

test('proprietário pode atualizar, adicionar, remover e excluir o roteiro', () => {
  const { database, repository } = setup();
  try {
    repository.create(makeItinerary(), 'u1');
    assert.equal(repository.update(makeItinerary('i1', { title: 'Editado' }), 'u1'), true);
    assert.equal(repository.addPlace('i1', 'p3', 'u1'), true);
    assert.equal(repository.removePlace('i1', 'p2', 'u1'), true);
    assert.deepEqual(repository.findById('i1').placeIds, ['p1', 'p3']);
    assert.equal(repository.delete('i1', 'u1'), true);
  } finally { database.close(); }
});

test('usuário diferente não pode atualizar, adicionar, remover ou excluir; recusas não alteram dados', () => {
  const { database, repository } = setup();
  try {
    repository.create(makeItinerary(), 'u1');
    const snapshot = () => ({
      itinerary: database.prepare('SELECT id, title, description, owner_id FROM itineraries WHERE id = ?').get('i1'),
      places: database.prepare('SELECT place_id, position FROM itinerary_places WHERE itinerary_id = ? ORDER BY position').all('i1'),
    });
    const original = snapshot();

    assert.throws(
      () => repository.update(makeItinerary('i1', { title: 'Intrusão', ownerId: 'u2', placeIds: ['p3'] }), 'u2'),
      PermissionError,
    );
    assert.deepEqual(snapshot(), original);
    assert.throws(() => repository.addPlace('i1', 'p3', 'u2'), PermissionError);
    assert.deepEqual(snapshot(), original);
    assert.throws(() => repository.removePlace('i1', 'p1', 'u2'), PermissionError);
    assert.deepEqual(snapshot(), original);
    assert.throws(() => repository.delete('i1', 'u2'), PermissionError);
    assert.deepEqual(snapshot(), original);
  } finally { database.close(); }
});

test('exclui roteiro e suas associações e trata registros inexistentes', () => {
  const { database, repository } = setup();
  try {
    repository.create(makeItinerary(), 'u1');
    assert.equal(repository.delete('i1', 'u1'), true);
    assert.equal(repository.findById('i1'), null);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM itinerary_places WHERE itinerary_id = ?').get('i1').count, 0);
    assert.equal(repository.delete('i1', 'u1'), false);
    assert.equal(repository.removePlace('missing', 'p1', 'u1'), false);
    assert.equal(repository.addPlace('missing', 'p1', 'u1'), false);
  } finally { database.close(); }
});
