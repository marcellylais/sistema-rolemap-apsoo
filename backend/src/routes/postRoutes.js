
import express from 'express';

const POST_CONTROLLER_METHODS = [
  'create',
  'findRecent',
  'delete',
];

export function createPostRouter(postController, authenticateToken) {
  if (
    !postController
    || POST_CONTROLLER_METHODS.some(
      (method) => typeof postController[method] !== 'function',
    )
  ) {
    throw new TypeError(
      'createPostRouter requires a PostController with post operation methods.',
    );
  }

  if (typeof authenticateToken !== 'function') {
    throw new TypeError(
      'createPostRouter requires an authenticateToken middleware function.',
    );
  }

  const router = express.Router();

  router.get('/', postController.findRecent);
  router.post('/', authenticateToken, postController.create);
  router.delete('/:id', authenticateToken, postController.delete);

  return router;
}
