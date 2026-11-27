import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { openDatabase } from '../src/infrastructure/database/connection.js';
import { ItineraryRepository } from '../src/infrastructure/repositories/ItineraryRepository.js';
import { PlaceRepository } from '../src/infrastructure/repositories/PlaceRepository.js';
import { ItineraryService } from '../src/application/services/ItineraryService.js';
import { ItineraryController } from '../src/application/controllers/ItineraryController.js';
import { createItineraryRouter } from '../src/routes/itineraryRoutes.js';

test('POST addPlace returns 409 for a duplicate and leaves itinerary associations unchanged', async () => {
  const database = openDatabase({ databasePath: ':memory:' });
  const user = { id: 'u1', role: 'user' };
  database.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
    .run('u1', 'Ana', 'ana@example.com', 'hash');
  database.prepare(`
    INSERT INTO places (id, title, category, latitude, longitude, author_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('p1', 'Place 1', 'park', 0, 0, 'u1');

  const itineraryRepository = new ItineraryRepository(database);
  const placeRepository = new PlaceRepository(database);
  const service = new ItineraryService(itineraryRepository, placeRepository);
  const itinerary = service.create({ title: 'Trip', description: 'Test', placeIds: [] }, user);
  const controller = new ItineraryController(service);
  const app = express();
  app.use(express.json());
  app.use('/api/itineraries', createItineraryRouter(controller, (req, res, next) => {
    req.user = user;
    next();
  }));
  const server = createServer(app).listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const url = `http://127.0.0.1:${server.address().port}/api/itineraries/${itinerary.id}/places`;
    const add = () => fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ placeId: 'p1' }),
    });

    const first = await add();
    assert.equal(first.status, 200);
    assert.equal(await first.json(), true);
    const beforeDuplicate = database.prepare(
      'SELECT place_id, position FROM itinerary_places WHERE itinerary_id = ? ORDER BY position',
    ).all(itinerary.id);

    const duplicate = await add();
    assert.equal(duplicate.status, 409);
    assert.deepEqual(await duplicate.json(), {
      error: 'A place can appear only once in an itinerary.',
    });
    assert.deepEqual(database.prepare(
      'SELECT place_id, position FROM itinerary_places WHERE itinerary_id = ? ORDER BY position',
    ).all(itinerary.id), beforeDuplicate);
  } finally {
    server.close();
    await once(server, 'close');
    database.close();
  }
});
