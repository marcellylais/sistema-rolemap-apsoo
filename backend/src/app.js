import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { createUserRouter } from './routes/userRoutes.js';
import { createPlaceRouter } from './routes/placeRoutes.js';
import { createReviewRouter } from './routes/reviewRoutes.js';
import { createItineraryRouter } from './routes/itineraryRoutes.js';
import { createFavoriteRouter } from './routes/favoriteRoutes.js';
import { swaggerSpec } from './docs/openapi.js';
import { createPostRouter } from './routes/postRoutes.js';
import { createFeedRouter } from './routes/feedRoutes.js';

const REQUIRED_DEPENDENCIES = [
  'userController',
  'placeController',
  'reviewController',
  'itineraryController',
  'favoriteController',
  'postController',
  'feedController',
  'authenticateToken',
];

export function createApp(dependencies = {}) {
  if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
    throw new TypeError('createApp requires a dependency object.');
  }

  for (const name of REQUIRED_DEPENDENCIES) {
    if (!dependencies[name]) throw new TypeError(`createApp requires ${name}.`);
  }
  if (typeof dependencies.authenticateToken !== 'function') {
    throw new TypeError('createApp requires authenticateToken to be a middleware function.');
  }

  const {
    userController,
    placeController,
    reviewController,
    itineraryController,
    favoriteController,
    postController,
    feedController,
    authenticateToken,
    corsOptions = {},
  } = dependencies;

  const app = express();
  app.use(cors(corsOptions));
  app.use(express.json());
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  app.use('/api/users', createUserRouter(userController));
  app.use('/api/places', createPlaceRouter(placeController, authenticateToken));
  app.use('/api/reviews', createReviewRouter(reviewController, authenticateToken));
  app.use('/api/itineraries', createItineraryRouter(itineraryController, authenticateToken));
  app.use('/api/posts', createPostRouter(postController, authenticateToken));
  app.use('/api/feed', createFeedRouter(feedController));
  app.use('/api/favorites', createFavoriteRouter(favoriteController, authenticateToken));

  return app;
}
