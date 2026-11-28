
import express from 'express';

export function createFeedRouter(feedController) {
  if (
    !feedController
    || typeof feedController.findRecent !== 'function'
  ) {
    throw new TypeError(
      'createFeedRouter requires a FeedController with feed operation methods.',
    );
  }

  const router = express.Router();

  router.get('/', feedController.findRecent.bind(feedController));

  return router;
}
