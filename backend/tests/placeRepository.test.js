import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/infrastructure/database/connection.js';
import { PlaceRepository } from '../src/infrastructure/repositories/PlaceRepository.js';
import { Place } from '../src/domain/entities/Place.js';
import { User } from '../src/domain/entities/User.js';
import { Review } from '../src/domain/entities/Review.js';
import { PermissionError, ValidationError } from '../src/domain/errors/DomainError.js';

function setup() {
  const database = openDatabase({ databasePath: ':memory:' });
  database.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
    .run('author', 'Autora', 'autora@example.com', 'hash');
  database.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
    .run('reviewer', 'Avaliadora', 'avaliadora@example.com', 'hash');
  return { database, repository: new PlaceRepository(database) };
}

const makePlace = (id = 'p1', overrides = {}) => new Place({
  id,
  title: 'Parque',
  description: 'Área verde',
  category: 'natureza',
  latitude: -23.5,
  longitude: -46.6,
  authorId: 'author',
  ...overrides,
});

const makeUser = (id = 'author', role = 'user') => new User({
  id,
  name: 'Usuária',
  email: `${id}@example.com`,
  passwordHash: 'hash',
  role,
});

test('cadastra lugar e reconstrói avaliações e média ao buscar', () => {
  const { database, repository } = setup();
  try {
    repository.create(makePlace());
    database.prepare(`
      INSERT INTO reviews (id, rating, comment, user_id, place_id)
      VALUES (?, ?, ?, ?, ?)
    `).run('r1', 4, 'Muito bom', 'reviewer', 'p1');

    const found = repository.findById('p1');
    assert.ok(found instanceof Place);
    assert.equal(found.title, 'Parque');
    assert.equal(found.reviews.length, 1);
    assert.ok(found.reviews[0] instanceof Review);
    assert.equal(found.averageRating, 4);
  } finally { database.close(); }
});

test('busca por id retorna null quando o lugar não existe', () => {
  const { database, repository } = setup();
  try { assert.equal(repository.findById('missing'), null); }
  finally { database.close(); }
});

test('lista lugares e carrega todas as avaliações em lote', () => {
  const { database, repository } = setup();
  try {
    repository.create(makePlace('p1'));
    repository.create(makePlace('p2', { title: 'Museu', category: 'cultura' }));
    database.prepare('INSERT INTO reviews (id, rating, user_id, place_id) VALUES (?, ?, ?, ?)')
      .run('r1', 3, 'reviewer', 'p1');
    assert.deepEqual(repository.findAll().map(({ id }) => id), ['p1', 'p2']);
    assert.equal(repository.findAll()[0].averageRating, 3);
  } finally { database.close(); }
});

test('filtra lugares por categoria', () => {
  const { database, repository } = setup();
  try {
    repository.create(makePlace('p1'));
    repository.create(makePlace('p2', { title: 'Museu', category: 'cultura' }));
    assert.deepEqual(repository.findByCategory('cultura').map(({ id }) => id), ['p2']);
    assert.deepEqual(repository.findByCategory('ausente'), []);
  } finally { database.close(); }
});

test('busca por título e categoria, filtra por raio e ordena por distância sem perder avaliações', () => {
  const { database, repository } = setup();
  try {
    repository.create(makePlace('center', { title: 'Parque Central', latitude: 0, longitude: 0 }));
    repository.create(makePlace('near', { title: 'Parque do Lago', latitude: 0, longitude: 0.03 }));
    repository.create(makePlace('wrong-category', { title: 'Parque da Cidade', category: 'lazer', latitude: 0.01, longitude: 0 }));
    repository.create(makePlace('far', { title: 'Parque Distante', latitude: 0, longitude: 0.1 }));
    database.prepare('INSERT INTO reviews (id, rating, user_id, place_id) VALUES (?, ?, ?, ?)')
      .run('r-center', 5, 'reviewer', 'center');

    const results = repository.search({
      name: 'PARQUE', category: 'natureza', latitude: 0, longitude: 0, radiusKm: 4,
    });
    assert.deepEqual(results.map(({ id }) => id), ['center', 'near']);
    assert.equal(results[0].averageRating, 5);
    assert.deepEqual(repository.search({ name: 'parque', category: 'lazer' }).map(({ id }) => id), ['wrong-category']);
  } finally { database.close(); }
});

test('busca interpreta curingas do nome como texto literal e lida com proximidade no antimeridiano', () => {
  const { database, repository } = setup();
  try {
    repository.create(makePlace('literal', { title: '100% Parque', latitude: 0, longitude: 179.9 }));
    repository.create(makePlace('across-date-line', { title: 'Museu', category: 'cultura', latitude: 0, longitude: -179.9 }));
    repository.create(makePlace('too-far', { title: 'Parque', latitude: 0, longitude: -179.5 }));

    assert.deepEqual(repository.search({ name: '100%' }).map(({ id }) => id), ['literal']);
    assert.deepEqual(repository.search({ latitude: 0, longitude: 179.9, radiusKm: 30 }).map(({ id }) => id), [
      'literal', 'across-date-line',
    ]);
  } finally { database.close(); }
});

test('inclui um lugar exatamente no limite do raio', () => {
  const { database, repository } = setup();
  try {
    repository.create(makePlace('boundary', { latitude: 0, longitude: 0.01 }));
    const oneHundredthDegreeAtEquatorKm = 6371.0088 * (Math.PI / 180) * 0.01;
    assert.deepEqual(repository.search({
      latitude: 0, longitude: 0, radiusKm: oneHundredthDegreeAtEquatorKm,
    }).map(({ id }) => id), ['boundary']);
  } finally { database.close(); }
});

test('atualiza campos descritivos para autor ou administrador sem tocar em coordenadas ou autor', () => {
  const { database, repository } = setup();
  try {
    repository.create(makePlace());
    const editedPlace = makePlace('p1', {
      title: 'Praça central', description: 'Reformada', category: 'lazer',
      latitude: 0, longitude: 0, authorId: 'forged-author',
    });
    assert.equal(repository.update(editedPlace, makeUser('author')), true);
    const result = database.prepare('SELECT title, description, category, latitude, longitude, author_id FROM places WHERE id = ?').get('p1');
    assert.deepEqual(result, {
      title: 'Praça central', description: 'Reformada', category: 'lazer',
      latitude: -23.5, longitude: -46.6, author_id: 'author',
    });

    assert.equal(repository.update(makePlace('p1', { title: 'Atualizado pelo admin' }), makeUser('admin', 'admin')), true);
  } finally { database.close(); }
});

test('rejeita edição não autorizada e valida valores pela entidade', () => {
  const { database, repository } = setup();
  try {
    repository.create(makePlace());
    assert.throws(
      () => repository.update(makePlace('p1', { title: 'Não autorizado' }), makeUser('other')),
      PermissionError,
    );
    assert.throws(
      () => repository.update(makePlace('p1', { title: '', category: 'lazer' }), makeUser('author')),
      ValidationError,
    );
    assert.equal(repository.update(makePlace('missing'), makeUser('author')), false);
  } finally { database.close(); }
});

test('criação rejeita coordenadas inválidas e exclusão retorna se removeu registro', () => {
  const { database, repository } = setup();
  try {
    assert.throws(() => repository.create(makePlace('bad', { latitude: 91 })), ValidationError);
    repository.create(makePlace());
    assert.equal(repository.delete('p1'), true);
    assert.equal(repository.findById('p1'), null);
    assert.equal(repository.delete('p1'), false);
  } finally { database.close(); }
});
