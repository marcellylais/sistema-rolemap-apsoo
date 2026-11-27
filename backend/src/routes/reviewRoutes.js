import express from 'express';

const REVIEW_CONTROLLER_METHODS = [
  'createOrUpdate', 'findByPlaceId', 'findByUserId', 'findById', 'delete',
  'report', 'listPendingReports', 'moderateReport',
];

export function createReviewRouter(reviewController, authenticateToken) {
  if (!reviewController
    || REVIEW_CONTROLLER_METHODS.some((method) => typeof reviewController[method] !== 'function')) {
    throw new TypeError('createReviewRouter requires a ReviewController with review operation methods.');
  }
  if (typeof authenticateToken !== 'function') {
    throw new TypeError('createReviewRouter requires an authenticateToken middleware function.');
  }

  const router = express.Router();
  router.get('/moderation/reports', authenticateToken, reviewController.listPendingReports.bind(reviewController));
  router.patch('/moderation/reports/:reportId', authenticateToken, reviewController.moderateReport.bind(reviewController));
  router.post('/:id/reports', authenticateToken, reviewController.report.bind(reviewController));
  router.post('/places/:placeId', authenticateToken, reviewController.createOrUpdate.bind(reviewController));
  router.get('/places/:placeId', reviewController.findByPlaceId.bind(reviewController));
  router.get('/users/:userId', reviewController.findByUserId.bind(reviewController));
  router.get('/:id', reviewController.findById.bind(reviewController));
  router.delete('/:id', authenticateToken, reviewController.delete.bind(reviewController));
  return router;
}
