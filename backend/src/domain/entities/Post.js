
import { ValidationError } from '../errors/DomainError.js';

export class Post {
  constructor({ id, content, userId, createdAt = null }) {
    if (!id || !userId) {
      throw new ValidationError('Post requires id and user id.');
    }

    if (typeof content !== 'string' || !content.trim()) {
      throw new ValidationError('Post content cannot be empty.');
    }

    this.id = id;
    this.content = content.trim();
    this.userId = userId;
    this.createdAt = createdAt;
  }
}
