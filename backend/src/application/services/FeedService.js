import { ValidationError } from '../../domain/errors/DomainError.js';

export class FeedService {
  constructor(postRepository, reviewRepository) {
    if (
      !postRepository
      || typeof postRepository.findRecent !== 'function'
    ) {
      throw new TypeError('FeedService requires a PostRepository.');
    }

    if (
      !reviewRepository
      || typeof reviewRepository.findRecentPublic !== 'function'
    ) {
      throw new TypeError('FeedService requires a ReviewRepository.');
    }

    this.postRepository = postRepository;
    this.reviewRepository = reviewRepository;
  }

  findRecent(limit = 20) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new ValidationError('Feed limit must be between 1 and 100.');
    }

    const posts = this.postRepository.findRecent(limit);
    const reviews = this.reviewRepository.findRecentPublic(limit);

    const feed = [
      ...posts.map((post) => ({
        ...post,
        type: 'post',
      })),

      ...reviews.map((review) => ({
        ...review,
        type: 'review',
      })),
    ];

    return feed
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);
  }
}