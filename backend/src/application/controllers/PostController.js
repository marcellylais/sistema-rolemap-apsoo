
import {
  PermissionError,
  ValidationError,
} from '../../domain/errors/DomainError.js';

const INTERNAL_ERROR_RESPONSE = {
  error: 'Internal server error.',
};

const POST_NOT_FOUND_RESPONSE = {
  error: 'Post not found.',
};

function authenticatedUser(req) {
  const user = req.user;

  return user && typeof user.id === 'string' && user.id.trim()
    ? user
    : null;
}

export class PostController {
  constructor(postService) {
    const requiredMethods = ['create', 'findRecent', 'delete'];

    if (
      !postService
      || requiredMethods.some(
        (method) => typeof postService[method] !== 'function',
      )
    ) {
      throw new TypeError(
        'PostController requires a PostService with post operations.',
      );
    }

    this.postService = postService;

    for (const method of requiredMethods) {
      this[method] = this[method].bind(this);
    }
  }

  async create(req, res) {
    const user = authenticatedUser(req);

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const post = await this.postService.create(
        { content: req.body?.content },
        user,
      );

      return res.status(201).json(post);
    } catch (error) {
      return this.#sendError(res, error);
    }
  }

  async findRecent(req, res) {
    try {
      const limit = req.query.limit === undefined
        ? 20
        : Number(req.query.limit);

      const posts = await this.postService.findRecent(limit);

      return res.status(200).json(posts);
    } catch (error) {
      return this.#sendError(res, error);
    }
  }

  async delete(req, res) {
    const user = authenticatedUser(req);

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const deleted = await this.postService.delete(req.params.id, user);

      if (!deleted) {
        return res.status(404).json(POST_NOT_FOUND_RESPONSE);
      }

      return res.status(204).end();
    } catch (error) {
      return this.#sendError(res, error);
    }
  }

  #sendError(res, error) {
    if (error instanceof ValidationError) {
      return res.status(400).json({ error: error.message });
    }

    if (error instanceof PermissionError) {
      return res.status(403).json({ error: error.message });
    }

    return res.status(500).json(INTERNAL_ERROR_RESPONSE);
  }
}
