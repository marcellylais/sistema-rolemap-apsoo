import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/infrastructure/database/connection.js';
import { PlaceService } from '../src/application/services/PlaceService.js';
import { PlaceRepository } from '../src/infrastructure/repositories/PlaceRepository.js';
import { Place } from '../src/domain/entities/Place.js';
import { PermissionError, ValidationError } from '../src/domain/errors/DomainError.js';

function setup() {
  const database = openDatabase({ databasePath: ':memory:' });
  const insertUser = database.prepare('INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)');
  insertUser.run('u1', 'Ana', 'ana@example.com', 'hash', 'user');
  insertUser.run('u2', 'Bia', 'bia@example.com', 'hash', 'user');
  insertUser.run('admin', 'Admin', 'admin@example.com', 'hash', 'admin');
  const repository = new PlaceRepository(database);
  return { database, repository, service: new PlaceService(repository) };
}

const authenticatedUser = (id, role = 'user') => ({ id, role });

const placeData = (overrides = {}) => ({
  title: 'Parque',
  description: 'Área verde',
  category: 'natureza',
  latitude: -23.5,
  longitude: -46.6,
  ...overrides,
});

test('cadastra lugar com UUID e usa a identidade autenticada como autor', () => {
  const { database, service } = setup();
  try {
    const place = service.create({ ...placeData(), authorId: 'u2', id: 'forged-id' }, authenticatedUser('u1'));
    assert.ok(place instanceof Place);
    assert.match(place.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    assert.equal(place.authorId, 'u1');
    const row = database.prepare('SELECT id, author_id FROM places WHERE id = ?').get(place.id);
    assert.equal(row.author_id, 'u1');
  } finally { database.close(); }
});

test('rejeita cadastro sem dados obrigatórios ou com coordenadas inválidas', () => {
  const { database, service } = setup();
  try {
    assert.throws(() => service.create(placeData({ title: '' }), authenticatedUser('u1')), ValidationError);
    assert.throws(() => service.create(placeData({ category: undefined }), authenticatedUser('u1')), ValidationError);
    assert.throws(() => service.create(placeData({ latitude: 91 }), authenticatedUser('u1')), ValidationError);
    assert.throws(() => service.create(placeData({ longitude: -181 }), authenticatedUser('u1')), ValidationError);
    assert.throws(() => service.create(placeData(), null), ValidationError);
  } finally { database.close(); }
});

test('delegates busca por id, listagem e categoria ao repositório', () => {
  const { database, service } = setup();
  try {
    const created = service.create(placeData(), authenticatedUser('u1'));
    service.create(placeData({ title: 'Museu', category: 'cultura' }), authenticatedUser('u2'));
    assert.equal(service.findById(created.id)?.id, created.id);
    assert.equal(service.findById('missing'), null);
    assert.equal(service.findAll().length, 2);
    assert.deepEqual(service.findByCategory('cultura').map(({ title }) => title), ['Museu']);
  } finally { database.close(); }
});

test('autor consegue atualizar somente os campos descritivos', () => {
  const { database, service } = setup();
  try {
    const created = service.create(placeData(), authenticatedUser('u1'));
    const changed = service.update(created.id, {
      title: 'Praça', description: 'Reformada', category: 'lazer',
      authorId: 'u2', latitude: 0, longitude: 0,
    }, authenticatedUser('u1'));
    assert.equal(changed, true);
    const row = database.prepare('SELECT title, description, category, latitude, longitude, author_id FROM places WHERE id = ?').get(created.id);
    assert.deepEqual(row, {
      title: 'Praça', description: 'Reformada', category: 'lazer',
      latitude: -23.5, longitude: -46.6, author_id: 'u1',
    });
  } finally { database.close(); }
});

test('administrador consegue atualizar lugar de outro usuário', () => {
  const { database, service } = setup();
  try {
    const created = service.create(placeData(), authenticatedUser('u1'));
    assert.equal(service.update(created.id, { title: 'Editado pelo admin' }, authenticatedUser('admin', 'admin')), true);
    assert.equal(service.findById(created.id).title, 'Editado pelo admin');
  } finally { database.close(); }
});

test('usuário comum não pode editar lugar de outra pessoa', () => {
  const { database, service } = setup();
  try {
    const created = service.create(placeData(), authenticatedUser('u1'));
    assert.throws(() => service.update(created.id, { title: 'Alteração indevida' }, authenticatedUser('u2')), PermissionError);
    assert.equal(service.findById(created.id).title, 'Parque');
  } finally { database.close(); }
});

test('não atualiza lugar inexistente', () => {
  const { database, service } = setup();
  try { assert.equal(service.update('missing', { title: 'Lugar' }, authenticatedUser('u1')), false); }
  finally { database.close(); }
});

test('autor consegue excluir o próprio lugar', () => {
  const { database, service } = setup();
  try {
    const created = service.create(placeData(), authenticatedUser('u1'));
    assert.equal(service.delete(created.id, authenticatedUser('u1')), true);
    assert.equal(service.findById(created.id), null);
  } finally { database.close(); }
});

test('administrador consegue excluir lugar de outro usuário', () => {
  const { database, service } = setup();
  try {
    const created = service.create(placeData(), authenticatedUser('u1'));
    assert.equal(service.delete(created.id, authenticatedUser('admin', 'admin')), true);
    assert.equal(service.findById(created.id), null);
  } finally { database.close(); }
});

test('usuário comum não pode excluir lugar de outra pessoa e o registro permanece', () => {
  const { database, service } = setup();
  try {
    const created = service.create(placeData(), authenticatedUser('u1'));
    assert.throws(() => service.delete(created.id, authenticatedUser('u2')), PermissionError);
    assert.equal(service.findById(created.id)?.id, created.id);
  } finally { database.close(); }
});

test('excluir lugar inexistente retorna false', () => {
  const { database, service } = setup();
  try { assert.equal(service.delete('missing', authenticatedUser('u1')), false); }
  finally { database.close(); }
});
