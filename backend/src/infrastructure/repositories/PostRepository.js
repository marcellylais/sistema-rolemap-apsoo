
import { Post } from '../../domain/entities/Post.js';
import { PermissionError, ValidationError } from '../../domain/errors/DomainError.js';

function toPost(row) {
  if (!row) return null;

  return {
    ...new Post({
      id: row.id,
      content: row.content,
      userId: row.user_id,
      createdAt: row.created_at,
    }),
    authorName: row.author_name,
  };
}

export class PostRepository {
  constructor(database) {
    if (!database) throw new TypeError('PostRepository requires a database connection.');
    this.database = database;
  }

  create(post, authenticatedUserId) {
    if (typeof authenticatedUserId !== 'string' || !authenticatedUserId) {
      throw new ValidationError('An authenticated user id is required.');
    }

    const validatedPost = new Post({
      id: post.id,
      content: post.content,
      userId: authenticatedUserId,
    });

    this.database.prepare(`
      INSERT INTO posts (id, content, user_id)
      VALUES (@id, @content, @userId)
    `).run({
      id: validatedPost.id,
      content: validatedPost.content,
      userId: validatedPost.userId,
    });

    return this.findById(validatedPost.id);
  }

  findById(id) {
    const row = this.database.prepare(`
      SELECT p.id, p.content, p.user_id, p.created_at, u.name AS author_name
      FROM posts AS p
      INNER JOIN users AS u ON u.id = p.user_id
      WHERE p.id = ?
    `).get(id);

    return toPost(row);
  }

  findRecent(limit = 20) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new ValidationError('Post limit must be between 1 and 100.');
    }

    const rows = this.database.prepare(`
      SELECT p.id, p.content, p.user_id, p.created_at, u.name AS author_name
      FROM posts AS p
      INNER JOIN users AS u ON u.id = p.user_id
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT ?
    `).all(limit);

    return rows.map(toPost);
  }

  
  delete(id, authenticatedUserId) {
    if (typeof authenticatedUserId !== 'string' || !authenticatedUserId) {
      throw new ValidationError('An authenticated user id is required.');
    }

    const post = this.database.prepare(`
      SELECT user_id
      FROM posts
      WHERE id = ?
    `).get(id);

    if (!post) return false;

    const authenticatedUser = this.database.prepare(`
      SELECT role
      FROM users
      WHERE id = ?
    `).get(authenticatedUserId);

    if (!authenticatedUser) {
      throw new ValidationError('Authenticated user not found.');
    }

    if (
      post.user_id !== authenticatedUserId &&
      authenticatedUser.role !== 'admin'
    ) {
      throw new PermissionError('Only the post author or an administrator may delete it.');
    }

    return this.database.prepare('DELETE FROM posts WHERE id = ?').run(id).changes > 0;
  }

}
