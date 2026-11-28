import { ValidationError, PermissionError } from '../errors/DomainError.js';

export class Place {
  #reviews = new Map();

  constructor({ id, title, description = '', category, latitude, longitude, authorId }) {
    if (!id || !title?.trim() || !category?.trim() || !authorId) {
      throw new ValidationError('Place requires id, title, category and author id.');
    }
    Place.validateCoordinates(latitude, longitude);
    if (typeof description !== 'string') throw new ValidationError('Place description must be a string.');
    this.id = id;
    this.title = title.trim();
    this.description = description.trim();
    this.category = category.trim();
    this.latitude = latitude;
    this.longitude = longitude;
    this.authorId = authorId;
  }

  static validateCoordinates(latitude, longitude) {
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      throw new ValidationError('Latitude must be a number from -90 to 90.');
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new ValidationError('Longitude must be a number from -180 to 180.');
    }
  }

  canBeEditedBy(user) { return Boolean(user && (user.id === this.authorId || user.isAdmin)); }

  updateDescription({ title = this.title, description = this.description, category = this.category }, user) {
    if (!this.canBeEditedBy(user)) throw new PermissionError('Only the place author or an administrator may edit it.');
    if (!title?.trim() || !category?.trim() || typeof description !== 'string') {
      throw new ValidationError('Place title and category are required; description must be a string.');
    }
    this.title = title.trim();
    this.description = description.trim();
    this.category = category.trim();
  }

  /** Adds a review, replacing the existing review by that user for this place. */
  addOrUpdateReview(review) {
    if (review.placeId !== this.id) throw new ValidationError('Review belongs to a different place.');
    const existing = this.#reviews.get(review.userId);
    if (existing) {
      existing.update({ rating: review.rating, comment: review.comment }, review.updatedAt);
      return existing;
    }
    this.#reviews.set(review.userId, review);
    return review;
  }

  get reviews() { return [...this.#reviews.values()]; }

  get averageRating() {
    if (this.#reviews.size === 0) return null;
    const total = [...this.#reviews.values()].reduce((sum, review) => sum + review.rating, 0);
    return total / this.#reviews.size;
  }
}
