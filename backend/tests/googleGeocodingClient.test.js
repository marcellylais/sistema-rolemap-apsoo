import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleGeocodingClient } from '../src/infrastructure/geocoding/GoogleGeocodingClient.js';

test('geocodifica endereço server-side usando header de chave e solicita somente coordenadas', async () => {
  let request;
  const client = new GoogleGeocodingClient({
    apiKey: 'unit-test-secret',
    async fetchImpl(url, options) {
      request = { url: new URL(url), options };
      return {
        ok: true,
        async json() {
          return { results: [{ location: { latitude: -23.55, longitude: -46.63 } }] };
        },
      };
    },
  });

  assert.deepEqual(await client.geocode('Praça da Sé / Centro'), { latitude: -23.55, longitude: -46.63 });
  assert.equal(request.url.origin, 'https://geocode.googleapis.com');
  assert.equal(request.url.pathname, '/v4/geocode/address/Pra%C3%A7a%20da%20S%C3%A9%20%2F%20Centro');
  assert.equal(request.url.search.includes('unit-test-secret'), false);
  assert.equal(request.options.headers['X-Goog-Api-Key'], 'unit-test-secret');
  assert.equal(request.options.headers['X-Goog-FieldMask'], 'results.location');
});

test('sem resultados retorna null e não chama a rede se a chave estiver ausente', async () => {
  let calls = 0;
  const noResultClient = new GoogleGeocodingClient({
    apiKey: 'unit-test-secret',
    async fetchImpl() { return { ok: true, async json() { return { results: [] }; } }; },
  });
  assert.equal(await noResultClient.geocode('Endereço não encontrado'), null);

  const missingKeyClient = new GoogleGeocodingClient({ apiKey: '', async fetchImpl() { calls += 1; } });
  await assert.rejects(missingKeyClient.geocode('Rua de teste'), /GOOGLE_MAPS_API_KEY/);
  assert.equal(calls, 0);
});

test('erros HTTP, de rede e respostas malformadas não expõem a chave configurada', async () => {
  const failingClients = [
    new GoogleGeocodingClient({ apiKey: 'do-not-leak', async fetchImpl() { return { ok: false }; } }),
    new GoogleGeocodingClient({ apiKey: 'do-not-leak', async fetchImpl() { throw new Error('do-not-leak'); } }),
    new GoogleGeocodingClient({ apiKey: 'do-not-leak', async fetchImpl() { return { ok: true, async json() { throw new Error('bad payload'); } }; } }),
    new GoogleGeocodingClient({ apiKey: 'do-not-leak', async fetchImpl() { return { ok: true, async json() { return { results: [{ location: { latitude: '0', longitude: 0 } }] }; } }; } }),
  ];
  for (const client of failingClients) {
    await assert.rejects(client.geocode('Rua de teste'), (error) => {
      assert.equal(error.message.includes('do-not-leak'), false);
      return true;
    });
  }
});
