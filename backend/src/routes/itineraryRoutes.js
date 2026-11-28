import express from 'express';

const ITINERARY_CONTROLLER_METHODS = [
  'create',
  'findAll',
  'findById',
  'update',
  'addPlace',
  'removePlace',
  'delete',
];

export function createItineraryRouter(itineraryController, authenticateToken) {
  if (!itineraryController
    || ITINERARY_CONTROLLER_METHODS.some((method) => typeof itineraryController[method] !== 'function')) {
    throw new TypeError('createItineraryRouter requires an ItineraryController with itinerary operation methods.');
  }
  if (typeof authenticateToken !== 'function') {
    throw new TypeError('createItineraryRouter requires an authenticateToken middleware function.');
  }

  const router = express.Router();
  router.post('/', authenticateToken, itineraryController.create.bind(itineraryController));
  router.get('/', authenticateToken, itineraryController.findAll.bind(itineraryController));
  router.post('/:id/places', authenticateToken, itineraryController.addPlace.bind(itineraryController));
  router.delete('/:id/places/:placeId', authenticateToken, itineraryController.removePlace.bind(itineraryController));
  router.get('/:id', authenticateToken, itineraryController.findById.bind(itineraryController));
  router.put('/:id', authenticateToken, itineraryController.update.bind(itineraryController));
  router.delete('/:id', authenticateToken, itineraryController.delete.bind(itineraryController));
  return router;
}
