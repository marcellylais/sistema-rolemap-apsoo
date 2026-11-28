import { randomUUID } from 'node:crypto';
import { Review } from '../../domain/entities/Review.js';
import {
  DuplicateReportError,
  PermissionError,
  ValidationError,
} from '../../domain/errors/DomainError.js';

function authenticatedPrincipal(user) {
  if (!user || typeof user.id !== 'string' || !user.id.trim()) {
    throw new ValidationError('An authenticated user is required.');
  }
  return { id: user.id, isAdmin: user.isAdmin === true || user.role === 'admin' };
}

export class ReviewService {
  constructor(reviewRepository, placeRepository, userRepository) {
    if (!reviewRepository
      || typeof reviewRepository.create !== 'function'
      || typeof reviewRepository.findById !== 'function'
      || typeof reviewRepository.findByPlaceId !== 'function'
      || typeof reviewRepository.findByUserId !== 'function'
      || typeof reviewRepository.delete !== 'function') {
      throw new TypeError('ReviewService requires a ReviewRepository.');
    }
    if (!placeRepository || typeof placeRepository.findById !== 'function') {
      throw new TypeError('ReviewService requires a PlaceRepository.');
    }
    if (!userRepository || typeof userRepository.isAdmin !== 'function') {
      throw new TypeError('ReviewService requires a UserRepository with isAdmin.');
    }
    this.reviewRepository = reviewRepository;
    this.placeRepository = placeRepository;
    this.userRepository = userRepository;
  }

  createOrUpdate(placeId, { rating, comment } = {}, authenticatedUser) {
    const principal = authenticatedPrincipal(authenticatedUser);
    const place = this.placeRepository.findById(placeId);
    if (!place) throw new ValidationError('Place does not exist.');

    const existingReview = this.reviewRepository.findByUserId(principal.id)
      .find((review) => review.placeId === placeId);

    if (existingReview) {
      existingReview.update({ rating, comment });
      return { review: this.reviewRepository.create(existingReview), created: false };
    }

    const review = new Review({
      id: randomUUID(),
      rating,
      comment: comment ?? '',
      userId: principal.id,
      placeId,
    });
    return { review: this.reviewRepository.create(review), created: true };
  }

  findById(id) {
    return this.reviewRepository.findPublicById(id);
  }

  findByPlaceId(placeId) {
    return this.reviewRepository.findPublicByPlaceId(placeId);
  }

  findByUserId(userId) {
    return this.reviewRepository.findPublicByUserId(userId);
  }

  findPlaceById(placeId) {
    // PlaceRepository reconstructs the associated reviews; Place owns averageRating.
    return this.placeRepository.findById(placeId);
  }

  delete(reviewId, authenticatedUser) {
    const principal = authenticatedPrincipal(authenticatedUser);
    const review = this.reviewRepository.findById(reviewId);
    if (!review) return false;
    if (review.userId !== principal.id && !principal.isAdmin) {
      throw new PermissionError('Only the review author or an administrator may delete it.');
    }
    return this.reviewRepository.delete(reviewId);
  }

  report(reviewId, targetType, authenticatedUser) {
    const principal = authenticatedPrincipal(authenticatedUser);
    if (typeof reviewId !== 'string' || !reviewId.trim()) {
      throw new ValidationError('A valid review id is required.');
    }
    if (!['rating', 'comment'].includes(targetType)) {
      throw new ValidationError('Report target must be rating or comment.');
    }

    const result = this.reviewRepository.createReport({
      id: randomUUID(),
      reviewId,
      targetType,
      reporterId: principal.id,
    });
    if (!result.reviewExists) return false;
    if (result.duplicate) throw new DuplicateReportError('You have already reported this review content.');
    return result;
  }

  listPendingReports(authenticatedUser) {
    const principal = authenticatedPrincipal(authenticatedUser);
    this.#requireAdministrator(principal.id);
    return this.reviewRepository.findPendingReports();
  }

  moderateReport(reportId, data, authenticatedUser) {
    const principal = authenticatedPrincipal(authenticatedUser);
    this.#requireAdministrator(principal.id);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new ValidationError('Moderation data is required.');
    }
    const { decision, contentAction } = data;
    if (!['approve', 'reject'].includes(decision)) {
      throw new ValidationError('Decision must be approve or reject.');
    }
    if (contentAction !== undefined && !['keep_hidden', 'restore'].includes(contentAction)) {
      throw new ValidationError('Content action must be keep_hidden or restore.');
    }

    const result = this.reviewRepository.moderateReport({
      reportId,
      decision: decision === 'approve' ? 'approved' : 'rejected',
      contentAction,
      moderatorId: principal.id,
    });
    if (result.forbidden) throw new PermissionError('Only an administrator may moderate reports.');
    if (result.reportNotFound) return null;
    if (result.alreadyModerated) throw new ValidationError('This report has already been moderated.');
    return result;
  }

  #requireAdministrator(userId) {
    if (!this.userRepository.isAdmin(userId)) {
      throw new PermissionError('Only an administrator may access review moderation.');
    }
  }
}
