
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createFeedRouter } from '../src/routes/feedRoutes.js';

function setup() {
  const app = express();
  const calls = [];

  const expectedFeed = [
    { id: 'p1', type: 'post' },
    { id: 'r1', type: 'review' },
  ];

  const feedController = {
    findRecent(req, res) {
      calls.push('findRecent');

      return res.status(200).json(expectedFeed);
    },
  };

  app.use('/api/feed', createFeedRouter(feedController));

  return { app, calls, expectedFeed };
}

test('permite consultar o feed publicamente', async () => {
  const { app, calls, expectedFeed } = setup();
  const server = app.listen(0);

  try {
    const response = await fetch(
      `http://localhost:${server.address().port}/api/feed`,
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expectedFeed);
    assert.deepEqual(calls, ['findRecent']);
  } finally {
    server.close();
  }
});

test('rejeita um controller inválido', () => {
  assert.throws(
    () => createFeedRouter(null),
    TypeError,
  );

  assert.throws(
    () => createFeedRouter({}),
    TypeError,
  );
});
