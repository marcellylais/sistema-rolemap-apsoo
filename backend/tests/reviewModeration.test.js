import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { openDatabase } from '../src/infrastructure/database/connection.js';
import { UserRepository } from '../src/infrastructure/repositories/UserRepository.js';
import { PlaceRepository } from '../src/infrastructure/repositories/PlaceRepository.js';
import { ReviewRepository } from '../src/infrastructure/repositories/ReviewRepository.js';
import { ReviewService } from '../src/application/services/ReviewService.js';
import { ReviewController } from '../src/application/controllers/ReviewController.js';
import { createReviewRouter } from '../src/routes/reviewRoutes.js';
import { DuplicateReportError, PermissionError, ValidationError } from '../src/domain/errors/DomainError.js';

function setup() {
  const database = openDatabase({ databasePath: ':memory:' });
  const insertUser = database.prepare('INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)');
  insertUser.run('author', 'Author', 'author@example.com', 'hash', 'user');
  for (let index = 1; index <= 6; index += 1) {
    insertUser.run(`reporter${index}`, `Reporter ${index}`, `reporter${index}@example.com`, 'hash', 'user');
  }
  insertUser.run('admin', 'Admin', 'admin@example.com', 'hash', 'admin');
  insertUser.run('formerAdmin', 'Former admin', 'former@example.com', 'hash', 'user');
  database.prepare(`
    INSERT INTO places (id, title, category, latitude, longitude, author_id)
    VALUES ('p1', 'Place 1', 'nature', 0, 0, 'author'),
           ('p2', 'Place 2', 'culture', 0, 0, 'author')
  `).run();

  const userRepository = new UserRepository(database);
  const placeRepository = new PlaceRepository(database);
  const reviewRepository = new ReviewRepository(database);
  const service = new ReviewService(reviewRepository, placeRepository, userRepository);
  return { database, userRepository, placeRepository, reviewRepository, service };
}

const identity = (id, role = 'user') => ({ id, role });

function createReview(service, placeId, rating = 5, comment = 'Original comment') {
  return service.createOrUpdate(placeId, { rating, comment }, identity('author')).review;
}

function makeAuthMiddleware() {
  const identities = {
    reporter: identity('reporter1'),
    reporter2: identity('reporter2'),
    reporter3: identity('reporter3'),
    reporter4: identity('reporter4'),
    forgedAdmin: identity('reporter1', 'admin'),
    adminWithOldUserClaim: identity('admin', 'user'),
    formerAdmin: identity('formerAdmin', 'admin'),
  };
  return (req, res, next) => {
    const token = req.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (!token || !identities[token]) return res.status(401).json({ error: 'Unauthorized' });
    req.user = identities[token];
    return next();
  };
}

async function withReviewApi(controller, run) {
  const app = express();
  app.use(express.json());
  app.use('/api/reviews', createReviewRouter(controller, makeAuthMiddleware()));
  const server = createServer(app).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${server.address().port}/api/reviews`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('RN03 oculta a partir da quarta denúncia distinta, por alvo, sem expor comentários nem incluir notas ocultas na média', () => {
  const { database, service } = setup();
  try {
    const review = createReview(service, 'p1');
    for (const reporterId of ['reporter1', 'reporter2', 'reporter3']) {
      const result = service.report(review.id, 'comment', identity(reporterId));
      assert.equal(result.activeReportCount, 1 + ['reporter1', 'reporter2', 'reporter3'].indexOf(reporterId));
      assert.equal(result.visibilityState, 'visible');
    }
    assert.equal(service.findById(review.id).comment, 'Original comment');
    assert.equal(service.findPlaceById('p1').averageRating, 5);

    assert.throws(() => service.report(review.id, 'comment', identity('reporter1')), DuplicateReportError);
    const fourthCommentReport = service.report(review.id, 'comment', identity('reporter4'));
    assert.equal(fourthCommentReport.activeReportCount, 4);
    assert.equal(fourthCommentReport.visibilityState, 'auto_hidden');
    assert.equal(service.findById(review.id).comment, null);
    assert.equal(service.findById(review.id).commentHidden, true);
    assert.equal(service.findPlaceById('p1').averageRating, 5);

    for (const reporterId of ['reporter1', 'reporter2', 'reporter3', 'reporter4']) {
      service.report(review.id, 'rating', identity(reporterId));
    }
    assert.equal(service.findById(review.id), null);
    assert.deepEqual(service.findByPlaceId('p1'), []);
    assert.equal(service.findPlaceById('p1').averageRating, null);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM reviews WHERE id = ?').get(review.id).count, 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM review_reports WHERE review_id = ?').get(review.id).count, 8);

    const updated = service.createOrUpdate('p1', { rating: 4, comment: 'Edited while hidden' }, identity('author'));
    assert.equal(updated.created, false);
    assert.equal(updated.review.id, review.id);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM review_reports WHERE review_id = ?').get(review.id).count, 8);
    assert.equal(database.prepare(`
      SELECT COUNT(*) AS count FROM review_content_moderation
      WHERE review_id = ? AND visibility_state = 'auto_hidden'
    `).get(review.id).count, 2);
  } finally { database.close(); }
});

test('rejeitar denúncia restaura ocultação automática; ocultação manual persiste até restauração explícita', () => {
  const { database, service } = setup();
  try {
    const autoHiddenReview = createReview(service, 'p1');
    const automaticReports = ['reporter1', 'reporter2', 'reporter3', 'reporter4']
      .map((id) => service.report(autoHiddenReview.id, 'rating', identity(id)));
    assert.equal(automaticReports[3].visibilityState, 'auto_hidden');
    const autoRestored = service.moderateReport(
      automaticReports[0].report.id,
      { decision: 'reject' },
      identity('admin', 'user'),
    );
    assert.equal(autoRestored.activeReportCount, 3);
    assert.equal(autoRestored.visibilityState, 'visible');
    assert.ok(service.findById(autoHiddenReview.id));

    const manualReview = createReview(service, 'p2', 4, 'Manual moderation');
    const reports = ['reporter1', 'reporter2', 'reporter3', 'reporter4']
      .map((id) => service.report(manualReview.id, 'comment', identity(id)));
    const keptHidden = service.moderateReport(
      reports[0].report.id,
      { decision: 'approve', contentAction: 'keep_hidden' },
      identity('admin'),
    );
    assert.equal(keptHidden.report.status, 'approved');
    assert.equal(keptHidden.visibilityState, 'moderator_hidden');

    for (const report of reports.slice(1, 3)) {
      const result = service.moderateReport(report.report.id, { decision: 'reject' }, identity('admin'));
      assert.equal(result.visibilityState, 'moderator_hidden');
      assert.equal(service.findById(manualReview.id).comment, null);
    }
    const restored = service.moderateReport(
      reports[3].report.id,
      { decision: 'reject', contentAction: 'restore' },
      identity('admin'),
    );
    assert.equal(restored.activeReportCount, 1);
    assert.equal(restored.visibilityState, 'visible');
    assert.equal(service.findById(manualReview.id).comment, 'Manual moderation');
  } finally { database.close(); }
});

test('somente administradores atuais no banco consultam/moderam; corpo não escolhe reporter nem moderador', async () => {
  const context = setup();
  const review = createReview(context.service, 'p1');
  const controller = new ReviewController(context.service);
  try {
    await withReviewApi(controller, async (baseUrl) => {
      const unauthorized = await fetch(`${baseUrl}/${review.id}/reports`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType: 'comment' }),
      });
      assert.equal(unauthorized.status, 401);

      const reportResponse = await fetch(`${baseUrl}/${review.id}/reports`, {
        method: 'POST',
        headers: { Authorization: 'Bearer reporter', 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType: 'comment', reporterId: 'reporter2', moderatorId: 'admin', role: 'admin' }),
      });
      assert.equal(reportResponse.status, 201);
      const reportBody = await reportResponse.json();
      assert.equal(Object.hasOwn(reportBody, 'reporterId'), false);
      assert.equal(context.database.prepare('SELECT reporter_id FROM review_reports WHERE id = ?').get(reportBody.id).reporter_id, 'reporter1');

      const duplicateResponse = await fetch(`${baseUrl}/${review.id}/reports`, {
        method: 'POST',
        headers: { Authorization: 'Bearer reporter', 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType: 'comment' }),
      });
      assert.equal(duplicateResponse.status, 409);

      const forgedAdmin = await fetch(`${baseUrl}/moderation/reports`, {
        headers: { Authorization: 'Bearer forgedAdmin' },
      });
      assert.equal(forgedAdmin.status, 403);
      const demotedAdmin = await fetch(`${baseUrl}/moderation/reports`, {
        headers: { Authorization: 'Bearer formerAdmin' },
      });
      assert.equal(demotedAdmin.status, 403);

      const currentAdmin = await fetch(`${baseUrl}/moderation/reports`, {
        headers: { Authorization: 'Bearer adminWithOldUserClaim' },
      });
      assert.equal(currentAdmin.status, 200);
      assert.equal((await currentAdmin.json()).length, 1);

      const moderationResponse = await fetch(`${baseUrl}/moderation/reports/${reportBody.id}`, {
        method: 'PATCH',
        headers: { Authorization: 'Bearer adminWithOldUserClaim', 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approve', contentAction: 'keep_hidden', moderatorId: 'reporter1', role: 'user' }),
      });
      assert.equal(moderationResponse.status, 200);
      assert.equal(context.database.prepare('SELECT moderated_by FROM review_reports WHERE id = ?').get(reportBody.id).moderated_by, 'admin');
      assert.equal(context.database.prepare('SELECT visibility_state FROM review_content_moderation WHERE review_id = ?').get(review.id).visibility_state, 'moderator_hidden');
      assert.equal((await (await fetch(`${baseUrl}/${review.id}`)).json()).comment, null);
    });
  } finally { context.database.close(); }
});

test('transações mantêm contagem correta em denúncias concorrentes e conservam apenas um registro por denunciante/alvo', async () => {
  const context = setup();
  const review = createReview(context.service, 'p1');
  try {
    await withReviewApi(new ReviewController(context.service), async (baseUrl) => {
      const reporterTokens = ['reporter', 'reporter2', 'reporter3', 'reporter4'];
      const responses = await Promise.all(reporterTokens.map((token) => fetch(`${baseUrl}/${review.id}/reports`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType: 'rating' }),
      })));
      assert.deepEqual(responses.map(({ status }) => status), [201, 201, 201, 201]);
      assert.equal(context.database.prepare(`
        SELECT COUNT(DISTINCT reporter_id) AS count FROM review_reports
        WHERE review_id = ? AND target_type = 'rating' AND status != 'rejected'
      `).get(review.id).count, 4);
      assert.equal(context.database.prepare(`
        SELECT visibility_state FROM review_content_moderation
        WHERE review_id = ? AND target_type = 'rating'
      `).get(review.id).visibility_state, 'auto_hidden');
    });
  } finally { context.database.close(); }
});

test('denúncia de avaliação inexistente e alvo inválido são tratados sem persistência', () => {
  const { database, service } = setup();
  try {
    assert.equal(service.report('missing', 'comment', identity('reporter1')), false);
    assert.throws(() => service.report('missing', 'body', identity('reporter1')), ValidationError);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM review_reports').get().count, 0);
    assert.throws(() => service.moderateReport('missing', { decision: 'approve' }, identity('reporter1', 'admin')), PermissionError);
  } finally { database.close(); }
});
