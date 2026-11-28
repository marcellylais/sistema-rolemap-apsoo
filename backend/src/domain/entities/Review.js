import { ValidationError } from '../errors/DomainError.js';

export class Review {
  constructor({ id, rating, comment = '', userId, placeId, createdAt = new Date(), updatedAt = createdAt }) {
    if (!id || !userId || !placeId) throw new ValidationError('Review requires id, user id and place id.');
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new ValidationError('Review rating must be an integer from 1 to 5.');
    }
    if (typeof comment !== 'string') throw new ValidationError('Review comment must be a string.');
    this.id = id;
    this.rating = rating;
    this.comment = comment.trim();
    this.userId = userId;
    this.placeId = placeId;
    this.createdAt = new Date(createdAt);
    this.updatedAt = new Date(updatedAt);
    if (Number.isNaN(this.createdAt.getTime()) || Number.isNaN(this.updatedAt.getTime())) {
      throw new ValidationError('Review dates must be valid.');
    }
  }

  update({ rating, comment = this.comment }, updatedAt = new Date()) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new ValidationError('Review rating must be an integer from 1 to 5.');
    }
    if (typeof comment !== 'string') throw new ValidationError('Review comment must be a string.');
    const date = new Date(updatedAt);
    if (Number.isNaN(date.getTime())) throw new ValidationError('Review update date must be valid.');
    this.rating = rating;
    this.comment = comment.trim();
    this.updatedAt = date;
    return this;
  }
}
