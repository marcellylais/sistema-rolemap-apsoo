import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/infrastructure/database/connection.js';
import { ItineraryService } from '../src/application/services/ItineraryService.js';
import { ItineraryRepository } from '../src/infrastructure/repositories/ItineraryRepository.js';
import { PlaceRepository } from '../src/infrastructure/repositories/PlaceRepository.js';
import { Itinerary } from '../src/domain/entities/Itinerary.js';
import { DuplicatePlaceError, PermissionError, ValidationError } from '../src/domain/errors/DomainError.js';

function setup() {
  const database = openDatabase({ databasePath: ':memory:' });
  const insertUser = database.prepare('INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)');
  insertUser.run('u1', 'Ana', 'ana@example.com', 'hash', 'user');
  insertUser.run('u2', 'Bia', 'bia@example.com', 'hash', 'user');
  insertUser.run('admin', 'Admin', 'admin@example.com', 'hash', 'admin');
  for (const id of ['p1', 'p2', 'p3']) {
    database.prepare(`
      INSERT INTO places (id, title, category, latitude, longitude, author_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, id, 'categoria', 0, 0, 'u1');
  }
  const itineraryRepository = new ItineraryRepository(database);
  const placeRepository = new PlaceRepository(database);
  return {
    database,
    itineraryRepository,
    service: new ItineraryService(itineraryRepository, placeRepository),
  };
}

const identity = (id, role = 'user') => ({ id, role });
const itineraryData = (overrides = {}) => ({
  title: 'Passeio',
  description: 'Roteiro de fim de semana',
  placeIds: ['p2', 'p1'],
  ...overrides,
});

test('cria roteiro com UUID, proprietário autenticado e ordem de lugares', () => {
  const { database, service } = setup();
  try {
    const itinerary = service.create({ ...itineraryData(), ownerId: 'u2' }, identity('u1'));
    assert.ok(itinerary instanceof Itinerary);
    assert.match(itinerary.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    assert.equal(itinerary.ownerId, 'u1');
    assert.deepEqual(service.findById(itinerary.id, identity('u1')).placeIds, ['p2', 'p1']);
    assert.equal(database.prepare('SELECT owner_id FROM itineraries WHERE id = ?').get(itinerary.id).owner_id, 'u1');
  } finally { database.close(); }
});

test('valida título, descrição e existência dos lugares na criação', () => {
  const { database, service } = setup();
  try {
    assert.throws(() => service.create(itineraryData({ title: ' ' }), identity('u1')), ValidationError);
    assert.throws(() => service.create(itineraryData({ description: null }), identity('u1')), ValidationError);
    assert.throws(() => service.create(itineraryData({ placeIds: ['missing'] }), identity('u1')), ValidationError);
    assert.throws(() => service.create(itineraryData({ placeIds: ['p1', 'p1'] }), identity('u1')), DuplicatePlaceError);
  } finally { database.close(); }
});

test('métodos do serviço rejeitam identidades autenticadas inválidas', () => {
  const { database, service } = setup();
  try {
    const itinerary = service.create(itineraryData(), identity('u1'));
    const invalidIdentities = [null, {}, { id: '' }, { id: 123 }];

    for (const invalidIdentity of invalidIdentities) {
      assert.throws(() => service.create(itineraryData(), invalidIdentity), ValidationError);
      assert.throws(() => service.findByOwner(invalidIdentity), ValidationError);
      assert.throws(() => service.findById(itinerary.id, invalidIdentity), ValidationError);
      assert.throws(() => service.update(itinerary.id, { title: 'Novo título' }, invalidIdentity), ValidationError);
      assert.throws(() => service.addPlace(itinerary.id, 'p3', invalidIdentity), ValidationError);
      assert.throws(() => service.removePlace(itinerary.id, 'p1', invalidIdentity), ValidationError);
      assert.throws(() => service.delete(itinerary.id, invalidIdentity), ValidationError);
    }
  } finally { database.close(); }
});

test('criação rejeita placeIds que não sejam uma lista de IDs válidos', () => {
  const { database, service } = setup();
  try {
    for (const placeIds of ['p1', [null], ['']]) {
      assert.throws(
        () => service.create(itineraryData({ placeIds }), identity('u1')),
        ValidationError,
      );
    }
  } finally { database.close(); }
});

test('consulta por ID somente para o proprietário autenticado e lista roteiros do proprietário', () => {
  const { database, service } = setup();
  try {
    const first = service.create(itineraryData(), identity('u1'));
    service.create(itineraryData({ title: 'Outro', placeIds: ['p3'] }), identity('u1'));
    service.create(itineraryData({ title: 'Da Bia', placeIds: [] }), identity('u2'));
    assert.equal(service.findById(first.id, identity('u1')).id, first.id);
    assert.throws(() => service.findById(first.id, identity('u2')), PermissionError);
    assert.throws(() => service.findById(first.id, identity('admin', 'admin')), PermissionError);
    assert.equal(service.findById('missing', identity('u1')), null);
    assert.deepEqual(service.findByOwner(identity('u1')).map(({ title }) => title).sort(), ['Outro', 'Passeio']);
    assert.deepEqual(service.findByOwner(identity('missing')), []);

    const authenticatedIdentityWithUntrustedField = { ...identity('u1'), userId: 'u2', ownerId: 'u2' };
    assert.equal(service.findById(first.id, authenticatedIdentityWithUntrustedField).ownerId, 'u1');
  } finally { database.close(); }
});

test('atualiza título e descrição sem alterar proprietário, lugares ou ordem', () => {
  const { database, service } = setup();
  try {
    const created = service.create(itineraryData(), identity('u1'));
    assert.equal(service.update(created.id, {
      title: 'Atualizado',
      description: 'Nova descrição',
      ownerId: 'u2',
      placeIds: ['p3'],
    }, identity('u1')), true);
    const updated = service.findById(created.id, identity('u1'));
    assert.equal(updated.title, 'Atualizado');
    assert.equal(updated.description, 'Nova descrição');
    assert.equal(updated.ownerId, 'u1');
    assert.deepEqual(updated.placeIds, ['p2', 'p1']);
    assert.equal(service.update('missing', { title: 'x', description: '' }, identity('u1')), false);
  } finally { database.close(); }
});

test('adiciona e remove lugares com autorização e preserva a ordem', () => {
  const { database, service } = setup();
  try {
    const created = service.create(itineraryData(), identity('u1'));
    assert.equal(service.addPlace(created.id, 'p3', identity('u1')), true);
    assert.deepEqual(service.findById(created.id, identity('u1')).placeIds, ['p2', 'p1', 'p3']);
    assert.throws(() => service.addPlace(created.id, 'p1', identity('u1')), DuplicatePlaceError);
    assert.throws(() => service.addPlace(created.id, 'missing', identity('u1')), ValidationError);
    assert.equal(service.removePlace(created.id, 'p1', identity('u1')), true);
    assert.deepEqual(service.findById(created.id, identity('u1')).placeIds, ['p2', 'p3']);
    assert.equal(service.removePlace(created.id, 'missing', identity('u1')), false);
    assert.equal(service.addPlace('missing', 'p3', identity('u1')), false);
  } finally { database.close(); }
});

test('somente o proprietário pode atualizar, adicionar, remover ou excluir', () => {
  const { database, service } = setup();
  try {
    const created = service.create(itineraryData(), identity('u1'));
    const snapshot = () => ({
      itinerary: database.prepare('SELECT id, title, description, owner_id FROM itineraries WHERE id = ?').get(created.id),
      places: database.prepare('SELECT place_id, position FROM itinerary_places WHERE itinerary_id = ? ORDER BY position').all(created.id),
    });
    const original = snapshot();
    const outsider = identity('u2');

    assert.throws(() => service.update(created.id, { title: 'Intruso' }, outsider), PermissionError);
    assert.deepEqual(snapshot(), original);
    assert.throws(() => service.addPlace(created.id, 'p3', outsider), PermissionError);
    assert.deepEqual(snapshot(), original);
    assert.throws(() => service.removePlace(created.id, 'p1', outsider), PermissionError);
    assert.deepEqual(snapshot(), original);
    assert.throws(() => service.delete(created.id, outsider), PermissionError);
    assert.deepEqual(snapshot(), original);

    // An administrator is still subject to the owner-only policy for another user's itinerary.
    assert.throws(() => service.delete(created.id, identity('admin', 'admin')), PermissionError);
    assert.deepEqual(snapshot(), original);
  } finally { database.close(); }
});

test('proprietário pode excluir; roteiro inexistente é tratado sem alterações', () => {
  const { database, service } = setup();
  try {
    const created = service.create(itineraryData(), identity('u1'));
    assert.equal(service.delete('missing', identity('u1')), false);
    assert.equal(service.delete(created.id, identity('u1')), true);
    assert.equal(service.findById(created.id, identity('u1')), null);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM itinerary_places WHERE itinerary_id = ?').get(created.id).count, 0);
    assert.equal(service.delete(created.id, identity('u1')), false);
  } finally { database.close(); }
});
