import express from 'express';

const PLACE_CONTROLLER_METHODS = ['create', 'findAll', 'findByCategory', 'search', 'findById', 'update', 'delete'];

export function createPlaceRouter(placeController, authenticateToken) {
  if (!placeController || PLACE_CONTROLLER_METHODS.some((method) => typeof placeController[method] !== 'function')) {
    throw new TypeError('createPlaceRouter requires a PlaceController with place operation methods.');
  }
  if (typeof authenticateToken !== 'function') {
    throw new TypeError('createPlaceRouter requires an authenticateToken middleware function.');
  }

  const router = express.Router();
  router.post('/', authenticateToken, placeController.create.bind(placeController));
  router.get('/', placeController.findAll.bind(placeController));
  router.get('/category/:category', placeController.findByCategory.bind(placeController));
  router.get('/search', placeController.search.bind(placeController));
  router.get('/:id', placeController.findById.bind(placeController));
  router.put('/:id', authenticateToken, placeController.update.bind(placeController));
  router.delete('/:id', authenticateToken, placeController.delete.bind(placeController));
  return router;
}
