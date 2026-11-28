import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { openDatabase } from '../src/infrastructure/database/connection.js';
import { createApplication, startServer } from '../src/server.js';

const testEnv = (overrides = {}) => ({ JWT_SECRET: 'rolemap-test-secret', ROLEMAP_DB_PATH: ':memory:', ...overrides });

test('monta repositórios, serviços, controllers e middleware compartilhando uma conexão SQLite', () => {
  const application = createApplication({ env: testEnv() });
  try {
    const { database, repositories, services, controllers } = application;
    for (const repository of Object.values(repositories)) assert.equal(repository.database, database);

    assert.equal(services.users.userRepository, repositories.users);
    assert.equal(services.users.tokenService, application.tokenService);
    assert.equal(services.places.placeRepository, repositories.places);
    assert.equal(typeof services.places.geocodingClient.geocode, 'function');
    assert.equal(services.reviews.reviewRepository, repositories.reviews);
    assert.equal(services.reviews.placeRepository, repositories.places);
    assert.equal(services.reviews.userRepository, repositories.users);
    assert.equal(services.itineraries.itineraryRepository, repositories.itineraries);
    assert.equal(services.itineraries.placeRepository, repositories.places);
    assert.equal(services.favorites.userRepository, repositories.users);
    assert.equal(services.favorites.placeRepository, repositories.places);
    assert.equal(controllers.users.userService, services.users);
    assert.equal(controllers.places.placeService, services.places);
    assert.equal(controllers.reviews.reviewService, services.reviews);
    assert.equal(controllers.itineraries.itineraryService, services.itineraries);
    assert.equal(controllers.favorites.favoriteService, services.favorites);
    assert.equal(typeof application.authenticateToken, 'function');
    assert.equal(application.tokenService.verifyToken(application.tokenService.generateToken({ id: 'u1', role: 'user' })).sub, 'u1');
  } finally {
    application.database.close();
  }
});

test('injeta GOOGLE_MAPS_API_KEY somente no cliente server-side de geocodificação', () => {
  let receivedOptions;
  const geocodingClient = { async geocode() { return { latitude: 0, longitude: 0 }; } };
  const application = createApplication({
    env: testEnv({ GOOGLE_MAPS_API_KEY: 'test-only-google-key' }),
    geocodingClientFactory(options) {
      receivedOptions = options;
      return geocodingClient;
    },
  });
  try {
    assert.deepEqual(receivedOptions, { apiKey: 'test-only-google-key' });
    assert.equal(application.services.places.geocodingClient, geocodingClient);
  } finally {
    application.database.close();
  }
});

test('usa ROLEMAP_DB_PATH ao abrir a conexão e mantém somente uma conexão', () => {
  let receivedOptions;
  let openedDatabase;
  const application = createApplication({
    env: testEnv({ ROLEMAP_DB_PATH: ':memory:' }),
    databaseOpener(options) {
      receivedOptions = options;
      openedDatabase = openDatabase(options);
      return openedDatabase;
    },
  });
  try {
    assert.deepEqual(receivedOptions, { databasePath: ':memory:' });
    assert.ok(Object.values(application.repositories).every(({ database }) => database === openedDatabase));
  } finally {
    application.database.close();
  }
});

test('falha claramente sem JWT_SECRET antes de abrir o banco', () => {
  let databaseOpenCalls = 0;
  assert.throws(() => createApplication({
    env: { ROLEMAP_DB_PATH: ':memory:' },
    databaseOpener() { databaseOpenCalls += 1; throw new Error('should not open database'); },
  }), /JWT_SECRET must be configured/);
  assert.equal(databaseOpenCalls, 0);
});

test('fecha a conexão se ocorrer erro durante a montagem da aplicação', () => {
  let closeCalls = 0;
  const database = { close() { closeCalls += 1; } };
  assert.throws(() => createApplication({
    env: testEnv(),
    databaseOpener: () => database,
    appFactory() { throw new Error('app configuration failed'); },
  }), /app configuration failed/);
  assert.equal(closeCalls, 1);
});

class FakeHttpServer extends EventEmitter {
  constructor(events) {
    super();
    this.events = events;
    this.listening = false;
    this.closeCalls = 0;
  }

  listen(port) {
    this.requestedPort = port;
    this.listening = true;
    queueMicrotask(() => this.emit('listening'));
    return this;
  }

  address() {
    return { port: this.requestedPort };
  }

  close(callback) {
    this.closeCalls += 1;
    this.events.push('http close');
    this.listening = false;
    queueMicrotask(() => callback?.());
  }
}

test('usa PORT e encerra HTTP antes do SQLite, fechando a conexão uma única vez', async () => {
  const events = [];
  let databaseCloseCalls = 0;
  let fakeServer;
  const processObject = new EventEmitter();
  const runtime = await startServer({
    env: testEnv({ PORT: '4321' }),
    databaseOpener: () => ({ close() { databaseCloseCalls += 1; events.push('database close'); } }),
    passwordHasher: { hash() {}, compare() {} },
    appFactory: () => ({ expressApp: true }),
    httpServerFactory() {
      fakeServer = new FakeHttpServer(events);
      return fakeServer;
    },
    processObject,
    logger: { log(message) { events.push(message); }, error() {} },
  });

  assert.equal(runtime.port, 4321);
  assert.equal(fakeServer.requestedPort, 4321);
  processObject.emit('SIGINT');
  processObject.emit('SIGTERM');
  await runtime.shutdown('duplicate');

  assert.deepEqual(events.slice(-2), ['http close', 'database close']);
  assert.equal(fakeServer.closeCalls, 1);
  assert.equal(databaseCloseCalls, 1);
});

test('usa a porta 3000 quando PORT não está configurada', async () => {
  let fakeServer;
  const runtime = await startServer({
    env: { JWT_SECRET: 'rolemap-test-secret', ROLEMAP_DB_PATH: ':memory:' },
    databaseOpener: () => ({ close() {} }),
    passwordHasher: { hash() {}, compare() {} },
    appFactory: () => ({}),
    httpServerFactory() {
      fakeServer = new FakeHttpServer([]);
      return fakeServer;
    },
    processObject: new EventEmitter(),
    logger: { log() {}, error() {} },
  });
  assert.equal(fakeServer.requestedPort, 3000);
  await runtime.shutdown();
});
