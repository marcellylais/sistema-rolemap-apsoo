import express from 'express';

const FAVORITE_CONTROLLER_METHODS = ['add', 'remove', 'findAll', 'check'];

export function createFavoriteRouter(favoriteController, authenticateToken) {
  if (!favoriteController
    || FAVORITE_CONTROLLER_METHODS.some((method) => typeof favoriteController[method] !== 'function')) {
    throw new TypeError('createFavoriteRouter requires a FavoriteController with favorite operation methods.');
  }
  if (typeof authenticateToken !== 'function') {
    throw new TypeError('createFavoriteRouter requires an authenticateToken middleware function.');
  }

  const router = express.Router();
  router.post('/', authenticateToken, favoriteController.add.bind(favoriteController));
  router.get('/', authenticateToken, favoriteController.findAll.bind(favoriteController));
  router.get('/:placeId/check', authenticateToken, favoriteController.check.bind(favoriteController));
  router.delete('/:placeId', authenticateToken, favoriteController.remove.bind(favoriteController));
  return router;
}
