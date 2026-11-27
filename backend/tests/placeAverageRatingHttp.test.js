import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { openDatabase } from '../src/infrastructure/database/connection.js';
import { PlaceRepository } from '../src/infrastructure/repositories/PlaceRepository.js';
import { PlaceService } from '../src/application/services/PlaceService.js';
import { PlaceController } from '../src/application/controllers/PlaceController.js';
import { createPlaceRouter } from '../src/routes/placeRoutes.js';

test('consultas HTTP de lugares incluem averageRating ou null e preservam os campos existentes', async () => {
  const database = openDatabase({ databasePath: ':memory:' });
  database.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
    .run('author', 'Autora', 'autora@example.com', 'hash');
  database.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
    .run('reviewer1', 'Avaliadora 1', 'reviewer1@example.com', 'hash');
  database.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
    .run('reviewer2', 'Avaliadora 2', 'reviewer2@example.com', 'hash');

  const insertPlace = database.prepare(`
    INSERT INTO places (id, title, description, category, latitude, longitude, author_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertPlace.run('p1', 'Parque', 'Área verde', 'natureza', -23.5, -46.6, 'author');
  insertPlace.run('p2', 'Praça', 'Praça central', 'natureza', -23.6, -46.7, 'author');
  database.prepare(`
    INSERT INTO reviews (id, rating, comment, user_id, place_id)
    VALUES (?, ?, ?, ?, ?)
  `).run('r1', 4, 'Muito bom', 'reviewer1', 'p1');
  database.prepare(`
    INSERT INTO reviews (id, rating, comment, user_id, place_id)
    VALUES (?, ?, ?, ?, ?)
  `).run('r2', 2, 'Razoável', 'reviewer2', 'p1');

  const placeRepository = new PlaceRepository(database);
  const controller = new PlaceController(new PlaceService(placeRepository));
  const app = express();
  app.use('/api/places', createPlaceRouter(controller, (_req, _res, next) => next()));
  const server = createServer(app).listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/places`;
    const byIdResponse = await fetch(`${baseUrl}/p1`);
    assert.equal(byIdResponse.status, 200);
    const byId = await byIdResponse.json();
    assert.equal(byId.averageRating, 3);
    assert.deepEqual({
      id: byId.id,
      title: byId.title,
      description: byId.description,
      category: byId.category,
      latitude: byId.latitude,
      longitude: byId.longitude,
      authorId: byId.authorId,
    }, {
      id: 'p1',
      title: 'Parque',
      description: 'Área verde',
      category: 'natureza',
      latitude: -23.5,
      longitude: -46.6,
      authorId: 'author',
    });

    const allResponse = await fetch(baseUrl);
    assert.equal(allResponse.status, 200);
    const allPlaces = await allResponse.json();
    assert.deepEqual(allPlaces.map(({ id, averageRating }) => ({ id, averageRating })), [
      { id: 'p1', averageRating: 3 },
      { id: 'p2', averageRating: null },
    ]);

    const categoryResponse = await fetch(`${baseUrl}/category/natureza`);
    assert.equal(categoryResponse.status, 200);
    const categoryPlaces = await categoryResponse.json();
    assert.deepEqual(categoryPlaces.map(({ id, averageRating }) => ({ id, averageRating })), [
      { id: 'p1', averageRating: 3 },
      { id: 'p2', averageRating: null },
    ]);
  } finally {
    server.close();
    await once(server, 'close');
    database.close();
  }
});
