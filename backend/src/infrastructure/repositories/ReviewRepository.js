import { Review } from '../../domain/entities/Review.js';
import { ReviewReport } from '../../domain/entities/ReviewReport.js';

const REVIEW_COLUMNS = 'id, rating, comment, user_id, place_id, created_at, updated_at';
const PUBLIC_REVIEW_COLUMNS = 'r.id, r.rating, r.comment, r.user_id, r.place_id, r.created_at, r.updated_at';

function toReview(row) {
  if (!row) return null;
  return new Review({
    id: row.id,
    rating: row.rating,
    comment: row.comment,
    userId: row.user_id,
    placeId: row.place_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toReport(row) {
  if (!row) return null;
  return new ReviewReport({
    id: row.id,
    reviewId: row.review_id,
    targetType: row.target_type,
    reporterId: row.reporter_id,
    status: row.status,
    createdAt: row.created_at,
    moderatedBy: row.moderated_by,
    moderatedAt: row.moderated_at,
  });
}

function toPublicReview(row) {
  if (!row || row.rating_visibility_state) return null;
  const commentHidden = Boolean(row.comment_visibility_state);
  return {
    id: row.id,
    rating: row.rating,
    comment: commentHidden ? null : row.comment,
    ...(commentHidden ? { commentHidden: true } : {}),
    userId: row.user_id,
    placeId: row.place_id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function validateTargetType(targetType) {
  if (!['rating', 'comment'].includes(targetType)) {
    throw new TypeError('Review report target must be rating or comment.');
  }
}

export class ReviewRepository {
  constructor(database) {
    if (!database) throw new TypeError('ReviewRepository requires a database connection.');
    this.database = database;
  }

  create(review) {
    this.database.prepare(`
      INSERT INTO reviews (id, rating, comment, user_id, place_id, created_at, updated_at)
      VALUES (@id, @rating, @comment, @userId, @placeId, @createdAt, @updatedAt)
      ON CONFLICT (user_id, place_id) DO UPDATE SET
        rating = excluded.rating,
        comment = excluded.comment,
        updated_at = excluded.updated_at
    `).run({
      id: review.id,
      rating: review.rating,
      comment: review.comment,
      userId: review.userId,
      placeId: review.placeId,
      createdAt: review.createdAt.toISOString(),
      updatedAt: review.updatedAt.toISOString(),
    });

    // The upsert keeps the original row (and therefore its report and moderation links).
    return this.#findByUserAndPlace(review.userId, review.placeId);
  }

  findById(id) {
    const row = this.database.prepare(`SELECT ${REVIEW_COLUMNS} FROM reviews WHERE id = ?`).get(id);
    return toReview(row);
  }

  findByPlaceId(placeId) {
    const rows = this.database.prepare(`
      SELECT ${REVIEW_COLUMNS} FROM reviews WHERE place_id = ? ORDER BY created_at, id
    `).all(placeId);
    return rows.map(toReview);
  }

  findByUserId(userId) {
    const rows = this.database.prepare(`
      SELECT ${REVIEW_COLUMNS} FROM reviews WHERE user_id = ? ORDER BY created_at, id
    `).all(userId);
    return rows.map(toReview);
  }

  findPublicById(id) {
    const row = this.#publicReviews('r.id = ?', [id])[0];
    return row ?? null;
  }

  findPublicByPlaceId(placeId) {
    return this.#publicReviews('r.place_id = ?', [placeId]);
  }

  findPublicByUserId(userId) {
    return this.#publicReviews('r.user_id = ?', [userId]);
  }

findRecentPublic(limit = 20) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new TypeError('Review limit must be between 1 and 100.');
  }

  const rows = this.database.prepare(`
    SELECT
      ${PUBLIC_REVIEW_COLUMNS},
      rating_moderation.visibility_state AS rating_visibility_state,
      comment_moderation.visibility_state AS comment_visibility_state
    FROM reviews AS r
    LEFT JOIN review_content_moderation AS rating_moderation
      ON rating_moderation.review_id = r.id
      AND rating_moderation.target_type = 'rating'
    LEFT JOIN review_content_moderation AS comment_moderation
      ON comment_moderation.review_id = r.id
      AND comment_moderation.target_type = 'comment'
    WHERE rating_moderation.review_id IS NULL
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT ?
  `).all(limit);

  return rows.map(toPublicReview).filter(Boolean);
}

  delete(id) {
    const result = this.database.prepare('DELETE FROM reviews WHERE id = ?').run(id);
    return result.changes > 0;
  }

  createReport({ id, reviewId, targetType, reporterId }) {
    validateTargetType(targetType);
    const register = this.database.transaction(() => {
      const reviewExists = this.database.prepare('SELECT 1 FROM reviews WHERE id = ?').get(reviewId);
      if (!reviewExists) return { reviewExists: false };

      const result = this.database.prepare(`
        INSERT INTO review_reports (id, review_id, target_type, reporter_id)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (review_id, target_type, reporter_id) DO NOTHING
      `).run(id, reviewId, targetType, reporterId);
      if (result.changes === 0) return { reviewExists: true, duplicate: true };

      const activeReportCount = this.#activeReportCount(reviewId, targetType);
      const visibilityState = this.#synchronizeAutomaticVisibility(reviewId, targetType, activeReportCount);
      const report = toReport(this.database.prepare('SELECT * FROM review_reports WHERE id = ?').get(id));
      return { reviewExists: true, duplicate: false, report, activeReportCount, visibilityState };
    });
    return register();
  }

  findPendingReports() {
    const rows = this.database.prepare(`
      SELECT
        rr.id AS report_id,
        rr.review_id AS report_review_id,
        rr.target_type AS report_target_type,
        rr.reporter_id AS report_reporter_id,
        rr.status AS report_status,
        rr.created_at AS report_created_at,
        rr.moderated_by AS report_moderated_by,
        rr.moderated_at AS report_moderated_at,
        r.id, r.rating, r.comment, r.user_id, r.place_id, r.created_at, r.updated_at,
        COALESCE(cm.visibility_state, 'visible') AS visibility_state,
        (SELECT COUNT(DISTINCT active.reporter_id)
         FROM review_reports AS active
         WHERE active.review_id = rr.review_id
           AND active.target_type = rr.target_type
           AND active.status != 'rejected') AS active_report_count
      FROM review_reports AS rr
      JOIN reviews AS r ON r.id = rr.review_id
      LEFT JOIN review_content_moderation AS cm
        ON cm.review_id = rr.review_id AND cm.target_type = rr.target_type
      WHERE rr.status = 'pending'
      ORDER BY rr.created_at, rr.id
    `).all();

    return rows.map((row) => ({
      report: toReport({
        id: row.report_id,
        review_id: row.report_review_id,
        target_type: row.report_target_type,
        reporter_id: row.report_reporter_id,
        status: row.report_status,
        created_at: row.report_created_at,
        moderated_by: row.report_moderated_by,
        moderated_at: row.report_moderated_at,
      }),
      review: toReview(row),
      visibilityState: row.visibility_state,
      activeReportCount: row.active_report_count,
    }));
  }

  moderateReport({ reportId, decision, contentAction, moderatorId }) {
    const moderate = this.database.transaction(() => {
      const moderator = this.database.prepare('SELECT role FROM users WHERE id = ?').get(moderatorId);
      if (!moderator || moderator.role !== 'admin') {
        return { forbidden: true };
      }

      const existing = this.database.prepare('SELECT * FROM review_reports WHERE id = ?').get(reportId);
      if (!existing) return { reportNotFound: true };
      if (existing.status !== 'pending') return { alreadyModerated: true };

      const moderatedAt = new Date().toISOString();
      this.database.prepare(`
        UPDATE review_reports
        SET status = ?, moderated_by = ?, moderated_at = ?
        WHERE id = ? AND status = 'pending'
      `).run(decision, moderatorId, moderatedAt, reportId);

      const activeReportCount = this.#activeReportCount(existing.review_id, existing.target_type);
      let visibilityState = this.#getVisibilityState(existing.review_id, existing.target_type);

      if (contentAction === 'keep_hidden') {
        this.#setVisibility(existing.review_id, existing.target_type, 'moderator_hidden', moderatorId);
        visibilityState = 'moderator_hidden';
      } else if (contentAction === 'restore') {
        if (activeReportCount >= 4) {
          this.#setVisibility(existing.review_id, existing.target_type, 'auto_hidden', null);
          visibilityState = 'auto_hidden';
        } else {
          this.#clearVisibility(existing.review_id, existing.target_type);
          visibilityState = 'visible';
        }
      } else {
        visibilityState = this.#synchronizeAutomaticVisibility(
          existing.review_id,
          existing.target_type,
          activeReportCount,
        );
      }

      const report = toReport(this.database.prepare('SELECT * FROM review_reports WHERE id = ?').get(reportId));
      return { report, activeReportCount, visibilityState };
    });
    return moderate();
  }

  #publicReviews(condition, parameters) {
    const rows = this.database.prepare(`
      SELECT
        ${PUBLIC_REVIEW_COLUMNS},
        rating_moderation.visibility_state AS rating_visibility_state,
        comment_moderation.visibility_state AS comment_visibility_state
      FROM reviews AS r
      LEFT JOIN review_content_moderation AS rating_moderation
        ON rating_moderation.review_id = r.id AND rating_moderation.target_type = 'rating'
      LEFT JOIN review_content_moderation AS comment_moderation
        ON comment_moderation.review_id = r.id AND comment_moderation.target_type = 'comment'
      WHERE ${condition} AND rating_moderation.review_id IS NULL
      ORDER BY r.created_at, r.id
    `).all(...parameters);
    return rows.map(toPublicReview);
  }

  #findByUserAndPlace(userId, placeId) {
    const row = this.database.prepare(`
      SELECT ${REVIEW_COLUMNS} FROM reviews WHERE user_id = ? AND place_id = ?
    `).get(userId, placeId);
    return toReview(row);
  }

  #activeReportCount(reviewId, targetType) {
    return this.database.prepare(`
      SELECT COUNT(DISTINCT reporter_id) AS count
      FROM review_reports
      WHERE review_id = ? AND target_type = ? AND status != 'rejected'
    `).get(reviewId, targetType).count;
  }

  #getVisibilityState(reviewId, targetType) {
    return this.database.prepare(`
      SELECT visibility_state FROM review_content_moderation
      WHERE review_id = ? AND target_type = ?
    `).get(reviewId, targetType)?.visibility_state ?? 'visible';
  }

  #synchronizeAutomaticVisibility(reviewId, targetType, activeReportCount) {
    const current = this.#getVisibilityState(reviewId, targetType);
    if (current === 'moderator_hidden') return current;
    if (activeReportCount >= 4) {
      this.#setVisibility(reviewId, targetType, 'auto_hidden', null);
      return 'auto_hidden';
    }
    if (current === 'auto_hidden') this.#clearVisibility(reviewId, targetType);
    return 'visible';
  }

  #setVisibility(reviewId, targetType, visibilityState, moderatorId) {
    this.database.prepare(`
      INSERT INTO review_content_moderation (review_id, target_type, visibility_state, updated_at, moderator_id)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)
      ON CONFLICT (review_id, target_type) DO UPDATE SET
        visibility_state = excluded.visibility_state,
        updated_at = excluded.updated_at,
        moderator_id = excluded.moderator_id
    `).run(reviewId, targetType, visibilityState, moderatorId);
  }

  #clearVisibility(reviewId, targetType) {
    this.database.prepare(`
      DELETE FROM review_content_moderation WHERE review_id = ? AND target_type = ?
    `).run(reviewId, targetType);
  }
}
