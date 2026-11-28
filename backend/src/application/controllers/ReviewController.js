import {
  AuthenticationError,
  DuplicateReportError,
  PermissionError,
  ValidationError,
} from '../../domain/errors/DomainError.js';

const INTERNAL_ERROR_RESPONSE = { error: 'Internal server error.' };
const REVIEW_NOT_FOUND_RESPONSE = { error: 'Review not found.' };
const REVIEW_FIELDS = ['rating', 'comment'];
const REPORT_FIELDS = ['targetType'];
const MODERATION_FIELDS = ['decision', 'contentAction'];

function pickReviewFields(source) {
  const data = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  return Object.fromEntries(REVIEW_FIELDS
    .filter((field) => Object.hasOwn(data, field))
    .map((field) => [field, data[field]]));
}

function pickFields(source, fields) {
  const data = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  return Object.fromEntries(fields
    .filter((field) => Object.hasOwn(data, field))
    .map((field) => [field, data[field]]));
}

function authenticatedUser(req) {
  const user = req.user;
  return user && typeof user.id === 'string' && user.id.trim() ? user : null;
}

export class ReviewController {
  constructor(reviewService) {
    const requiredMethods = [
      'createOrUpdate', 'findById', 'findByPlaceId', 'findByUserId', 'delete',
      'report', 'listPendingReports', 'moderateReport',
    ];
    if (!reviewService || requiredMethods.some((method) => typeof reviewService[method] !== 'function')) {
      throw new TypeError('ReviewController requires a ReviewService with review operations.');
    }
    this.reviewService = reviewService;
    for (const method of [...requiredMethods, 'findById', 'findByPlaceId', 'findByUserId']) {
      this[method] = this[method].bind(this);
    }
  }

  async createOrUpdate(req, res) {
    const user = authenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const result = await this.reviewService.createOrUpdate(
        req.params.placeId,
        pickReviewFields(req.body),
        user,
      );
      return res.status(result.created ? 201 : 200).json(result.review);
    } catch (error) {
      return this.#sendError(res, error);
    }
  }

  async findById(req, res) {
    try {
      const review = await this.reviewService.findById(req.params.id);
      if (!review) return res.status(404).json(REVIEW_NOT_FOUND_RESPONSE);
      return res.status(200).json(review);
    } catch (error) {
      return this.#sendError(res, error);
    }
  }

  async findByPlaceId(req, res) {
    try {
      const reviews = await this.reviewService.findByPlaceId(req.params.placeId);
      return res.status(200).json(reviews);
    } catch (error) {
      return this.#sendError(res, error);
    }
  }

  async findByUserId(req, res) {
    try {
      const reviews = await this.reviewService.findByUserId(req.params.userId);
      return res.status(200).json(reviews);
    } catch (error) {
      return this.#sendError(res, error);
    }
  }

  async delete(req, res) {
    const user = authenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const deleted = await this.reviewService.delete(req.params.id, user);
      if (!deleted) return res.status(404).json(REVIEW_NOT_FOUND_RESPONSE);
      return res.status(204).end();
    } catch (error) {
      return this.#sendError(res, error);
    }
  }

  async report(req, res) {
    const user = authenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const result = await this.reviewService.report(
        req.params.id,
        pickFields(req.body, REPORT_FIELDS).targetType,
        user,
      );
      if (!result) return res.status(404).json(REVIEW_NOT_FOUND_RESPONSE);
      return res.status(201).json({
        id: result.report.id,
        reviewId: result.report.reviewId,
        targetType: result.report.targetType,
        status: result.report.status,
        createdAt: result.report.createdAt,
        activeReportCount: result.activeReportCount,
        visibilityState: result.visibilityState,
      });
    } catch (error) {
      return this.#sendError(res, error);
    }
  }

  async listPendingReports(req, res) {
    const user = authenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const reports = await this.reviewService.listPendingReports(user);
      return res.status(200).json(reports);
    } catch (error) {
      return this.#sendError(res, error);
    }
  }

  async moderateReport(req, res) {
    const user = authenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const result = await this.reviewService.moderateReport(
        req.params.reportId,
        pickFields(req.body, MODERATION_FIELDS),
        user,
      );
      if (!result) return res.status(404).json({ error: 'Report not found.' });
      return res.status(200).json({
        report: {
          id: result.report.id,
          reviewId: result.report.reviewId,
          targetType: result.report.targetType,
          status: result.report.status,
          moderatedBy: result.report.moderatedBy,
          moderatedAt: result.report.moderatedAt,
        },
        activeReportCount: result.activeReportCount,
        visibilityState: result.visibilityState,
      });
    } catch (error) {
      return this.#sendError(res, error);
    }
  }

  #sendError(res, error) {
    if (error instanceof DuplicateReportError) {
      return res.status(409).json({ error: error.message });
    }
    if (error instanceof ValidationError) {
      return res.status(400).json({ error: error.message });
    }
    if (error instanceof PermissionError) {
      return res.status(403).json({ error: error.message });
    }
    if (error instanceof AuthenticationError) {
      return res.status(401).json({ error: error.message });
    }
    return res.status(500).json(INTERNAL_ERROR_RESPONSE);
  }
}
