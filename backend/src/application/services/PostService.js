
import { randomUUID } from 'node:crypto';
import { Post } from '../../domain/entities/Post.js';
import { ValidationError } from '../../domain/errors/DomainError.js';

function authenticatedPrincipal(user) {
  if (!user || typeof user.id !== 'string' || !user.id.trim()) {
    throw new ValidationError('An authenticated user is required.');
  }

  return { id: user.id };
}

export class PostService {
  constructor(postRepository) {
    if (
      !postRepository
      || typeof postRepository.create !== 'function'
      || typeof postRepository.findById !== 'function'
      || typeof postRepository.findRecent !== 'function'
      || typeof postRepository.delete !== 'function'
    ) {
      throw new TypeError('PostService requires a PostRepository.');
    }

    this.postRepository = postRepository;
  }

  create(data, authenticatedUser) {
    const principal = authenticatedPrincipal(authenticatedUser);

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new ValidationError('Post data is required.');
    }

    const post = new Post({
      id: randomUUID(),
      content: data.content,
      userId: principal.id,
    });

    return this.postRepository.create(post, principal.id);
  }

  findRecent(limit = 20) {
    return this.postRepository.findRecent(limit);
  }

  findById(id) {
    return this.postRepository.findById(id);
  }

  delete(postId, authenticatedUser) {
    const principal = authenticatedPrincipal(authenticatedUser);

    return this.postRepository.delete(postId, principal.id);
  }
}
