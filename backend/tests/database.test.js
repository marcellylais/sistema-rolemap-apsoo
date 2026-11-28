import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, initializeSchema } from '../src/infrastructure/database/connection.js';

function setup() {
  const database = openDatabase({ databasePath: ':memory:' });
  database.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
    .run('u1', 'Ana', 'ana@example.com', 'hash');
  database.prepare('INSERT INTO places (id, title, category, latitude, longitude, author_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run('p1', 'Parque', 'natureza', -23.5, -46.6, 'u1');
  database.prepare('INSERT INTO places (id, title, category, latitude, longitude, author_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run('p2', 'Museu', 'cultura', 0, 0, 'u1');
  return database;
}

test('cria schema idempotentemente e habilita foreign keys em cada conexão', () => {
  const first = openDatabase({ databasePath: ':memory:' });
  try {
    assert.equal(first.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(initializeSchema(first), first);
    assert.deepEqual(first.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(({ name }) => name), [
      'favorites', 'itineraries', 'itinerary_places', 'places','posts',
      'review_content_moderation', 'review_reports', 'reviews', 'users',
    ]);
  } finally { first.close(); }

  const second = openDatabase({ databasePath: ':memory:' });
  try { assert.equal(second.pragma('foreign_keys', { simple: true }), 1); }
  finally { second.close(); }
});

test('banco rejeita e-mails duplicados e e-mails não normalizados', () => {
  const database = setup();
  try {
    const insert = database.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)');
    assert.throws(() => insert.run('u2', 'Outra', 'ana@example.com', 'hash'), /UNIQUE constraint failed/);
    assert.throws(() => insert.run('u2', 'Outra', 'ANA@example.com', 'hash'), /CHECK constraint failed/);
  } finally { database.close(); }
});

test('banco valida coordenadas e notas de avaliação', () => {
  const database = setup();
  try {
    const addPlace = database.prepare('INSERT INTO places (id, title, category, latitude, longitude, author_id) VALUES (?, ?, ?, ?, ?, ?)');
    assert.throws(() => addPlace.run('p2', 'x', 'x', 90.01, 0, 'u1'), /CHECK constraint failed/);
    assert.throws(() => addPlace.run('p3', 'x', 'x', 0, -180.01, 'u1'), /CHECK constraint failed/);
    const addReview = database.prepare('INSERT INTO reviews (id, rating, user_id, place_id) VALUES (?, ?, ?, ?)');
    assert.throws(() => addReview.run('r0', 0, 'u1', 'p1'), /CHECK constraint failed/);
    assert.throws(() => addReview.run('r6', 6, 'u1', 'p1'), /CHECK constraint failed/);
  } finally { database.close(); }
});

test('banco garante avaliação única por usuário e lugar', () => {
  const database = setup();
  try {
    const addReview = database.prepare('INSERT INTO reviews (id, rating, user_id, place_id) VALUES (?, ?, ?, ?)');
    addReview.run('r1', 4, 'u1', 'p1');
    assert.throws(() => addReview.run('r2', 5, 'u1', 'p1'), /UNIQUE constraint failed/);
  } finally { database.close(); }
});

test('banco garante unicidade de lugar e posição no roteiro, além de favoritos', () => {
  const database = setup();
  try {
    database.prepare('INSERT INTO itineraries (id, title, owner_id) VALUES (?, ?, ?)').run('i1', 'Roteiro', 'u1');
    const addPlace = database.prepare('INSERT INTO itinerary_places (itinerary_id, place_id, position) VALUES (?, ?, ?)');
    addPlace.run('i1', 'p1', 0);
    assert.throws(() => addPlace.run('i1', 'p1', 1), /UNIQUE constraint failed/);
    assert.throws(() => addPlace.run('i1', 'p2', 0), /UNIQUE constraint failed/);
    database.prepare('INSERT INTO favorites (user_id, place_id) VALUES (?, ?)').run('u1', 'p1');
    assert.throws(() => database.prepare('INSERT INTO favorites (user_id, place_id) VALUES (?, ?)').run('u1', 'p1'), /UNIQUE constraint failed/);
  } finally { database.close(); }
});

test('banco rejeita referências estrangeiras inexistentes', () => {
  const database = openDatabase({ databasePath: ':memory:' });
  try {
    assert.throws(() => database.prepare('INSERT INTO places (id, title, category, latitude, longitude, author_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run('p1', 'x', 'x', 0, 0, 'missing'), /FOREIGN KEY constraint failed/);
  } finally { database.close(); }
});
