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
import { ValidationError } from '../src/domain/errors/DomainError.js';

function setup(geocodingClient = { async geocode() { return { latitude: 0, longitude: 0 }; } }) {
  const database = openDatabase({ databasePath: ':memory:' });
  database.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
    .run('author', 'Author', 'author@example.com', 'hash');
  const repository = new PlaceRepository(database);
  repository.create({
    id: 'p-center', title: 'Parque Central', description: '', category: 'natureza',
    latitude: 0, longitude: 0, authorId: 'author',
  });
  repository.create({
    id: 'p-near', title: 'Parque do Lago', description: '', category: 'natureza',
    latitude: 0, longitude: 0.03, authorId: 'author',
  });
  repository.create({
    id: 'p-far', title: 'Parque Distante', description: '', category: 'natureza',
    latitude: 0, longitude: 0.1, authorId: 'author',
  });
  repository.create({
    id: 'p-museum', title: 'Museu Central', description: '', category: 'cultura',
    latitude: 0.01, longitude: 0, authorId: 'author',
  });
  database.prepare('INSERT INTO reviews (id, rating, user_id, place_id) VALUES (?, ?, ?, ?)')
    .run('r-center', 4, 'author', 'p-center');
  const service = new PlaceService(repository, geocodingClient);
  return { database, repository, service, controller: new PlaceController(service), geocodingClient };
}

async function withApi(controller, run) {
  const app = express();
  app.use('/api/places', createPlaceRouter(controller, (_req, _res, next) => next()));
  const server = createServer(app).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${server.address().port}/api/places`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('HTTP busca por nome e categoria combinados, e por coordenadas com distância ordenada e média', async () => {
  const context = setup();
  try {
    await withApi(context.controller, async (baseUrl) => {
      const filtered = await fetch(`${baseUrl}/search?name=parque&category=natureza`);
      assert.equal(filtered.status, 200);
      assert.deepEqual((await filtered.json()).map(({ id }) => id), ['p-center', 'p-far', 'p-near']);

      const nearby = await fetch(`${baseUrl}/search?latitude=0&longitude=0&radiusKm=4`);
      assert.equal(nearby.status, 200);
      const results = await nearby.json();
      assert.deepEqual(results.map(({ id }) => id), ['p-center', 'p-museum', 'p-near']);
      assert.equal(results[0].averageRating, 4);

      const combined = await fetch(`${baseUrl}/search?name=parque&category=natureza&latitude=0&longitude=0&radiusKm=4`);
      assert.deepEqual((await combined.json()).map(({ id }) => id), ['p-center', 'p-near']);

      // An unbounded finite positive radius is accepted; the API has no arbitrary application cap.
      const global = await fetch(`${baseUrl}/search?latitude=0&longitude=0&radiusKm=20016`);
      assert.equal((await global.json()).length, 4);
      // Existing category route remains intact.
      const category = await fetch(`${baseUrl}/category/cultura`);
      assert.deepEqual((await category.json()).map(({ id }) => id), ['p-museum']);
    });
  } finally { context.database.close(); }
});

test('endereço é geocodificado antes da busca e o resultado continua vindo do catálogo local', async () => {
  const calls = [];
  const context = setup({
    async geocode(address) {
      calls.push(address);
      return { latitude: 0, longitude: 0 };
    },
  });
  try {
    await withApi(context.controller, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/search?address=${encodeURIComponent('Praça da Sé, São Paulo')}&radiusKm=4&category=natureza`);
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).map(({ id }) => id), ['p-center', 'p-near']);
      assert.deepEqual(calls, ['Praça da Sé, São Paulo']);
    });
  } finally { context.database.close(); }
});

test('valida filtros, origem, coordenadas e raio antes de consultar ou geocodificar', async () => {
  const calls = [];
  const context = setup({ async geocode(address) { calls.push(address); return null; } });
  try {
    for (const criteria of [
      {},
      { name: '' },
      { latitude: 0, radiusKm: 5 },
      { longitude: 0, radiusKm: 5 },
      { latitude: 0, longitude: 0 },
      { radiusKm: 5 },
      { latitude: 91, longitude: 0, radiusKm: 5 },
      { latitude: 0, longitude: -181, radiusKm: 5 },
      { latitude: 'north', longitude: 0, radiusKm: 5 },
      { latitude: 0, longitude: 0, radiusKm: 0 },
      { latitude: 0, longitude: 0, radiusKm: 'Infinity' },
      { address: 'Rua A', latitude: 0, longitude: 0, radiusKm: 5 },
      { address: 'Rua A' },
    ]) {
      await assert.rejects(context.service.search(criteria), ValidationError);
    }
    assert.deepEqual(calls, []);

    await withApi(context.controller, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/search?latitude=0&longitude=0`);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.length > 0, true);

      const unknownAddress = await fetch(`${baseUrl}/search?address=Unknown%20Address&radiusKm=2`);
      assert.equal(unknownAddress.status, 400);
      assert.deepEqual(calls, ['Unknown Address']);
    });
  } finally { context.database.close(); }
});

test('falha do geocodificador é convertida em resposta genérica sem detalhes internos', async () => {
  const context = setup({
    async geocode() { throw new Error('upstream secret and stack details'); },
  });
  try {
    await withApi(context.controller, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/search?address=Some%20Address&radiusKm=2`);
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: 'Internal server error.' });
    });
  } finally { context.database.close(); }
});
