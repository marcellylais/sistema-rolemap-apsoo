
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { openDatabase } from './infrastructure/database/connection.js';

import { UserRepository } from './infrastructure/repositories/UserRepository.js';
import { PlaceRepository } from './infrastructure/repositories/PlaceRepository.js';
import { ReviewRepository } from './infrastructure/repositories/ReviewRepository.js';
import { ItineraryRepository } from './infrastructure/repositories/ItineraryRepository.js';
import { PostRepository } from './infrastructure/repositories/PostRepository.js';

import { GoogleGeocodingClient } from './infrastructure/geocoding/GoogleGeocodingClient.js';

import { UserService } from './application/services/UserService.js';
import { PlaceService } from './application/services/PlaceService.js';
import { ReviewService } from './application/services/ReviewService.js';
import { ItineraryService } from './application/services/ItineraryService.js';
import { PostService } from './application/services/PostService.js';
import { FeedService } from './application/services/FeedService.js';
import { FavoriteService } from './application/services/FavoriteService.js';
import { TokenService } from './application/services/TokenService.js';

import { authenticateToken as createAuthenticateToken } from './application/middleware/authenticateToken.js';

import { UserController } from './application/controllers/UserController.js';
import { PlaceController } from './application/controllers/PlaceController.js';
import { ReviewController } from './application/controllers/ReviewController.js';
import { ItineraryController } from './application/controllers/ItineraryController.js';
import { PostController } from './application/controllers/PostController.js';
import { FeedController } from './application/controllers/FeedController.js';
import { FavoriteController } from './application/controllers/FavoriteController.js';

import { createApp } from './app.js';

function closeQuietly(database) {
  try {
    database?.close();
  } catch {
    // Keep the initialization error as the primary failure.
  }
}

export function createApplication({
  env = process.env,
  databaseOpener = openDatabase,
  passwordHasher = bcrypt,
  geocodingClientFactory = (options) => new GoogleGeocodingClient(options),
  appFactory = createApp,
} = {}) {
  if (!env || typeof env !== 'object') {
    throw new TypeError('createApplication requires an environment object.');
  }

  if (typeof env.JWT_SECRET !== 'string' || !env.JWT_SECRET.trim()) {
    throw new TypeError('JWT_SECRET must be configured with a non-empty secret.');
  }

  // Validate security configuration before opening SQLite.
  const tokenService = new TokenService(env.JWT_SECRET);
  let database;

  try {
    database = databaseOpener({
      databasePath: env.ROLEMAP_DB_PATH || undefined,
    });

    const repositories = {
      users: new UserRepository(database),
      places: new PlaceRepository(database),
      reviews: new ReviewRepository(database),
      itineraries: new ItineraryRepository(database),
      posts: new PostRepository(database),
    };

    const geocodingClient = geocodingClientFactory({
      apiKey: env.GOOGLE_MAPS_API_KEY,
    });

    const services = {
      users: new UserService(repositories.users, passwordHasher, tokenService),
      places: new PlaceService(repositories.places, geocodingClient),
      reviews: new ReviewService(
        repositories.reviews,
        repositories.places,
        repositories.users,
      ),
      itineraries: new ItineraryService(
        repositories.itineraries,
        repositories.places,
      ),
      favorites: new FavoriteService(
        repositories.users,
        repositories.places,
      ),
      posts: new PostService(repositories.posts),
      feeds: new FeedService(
        repositories.posts,
        repositories.reviews,
      ),
    };

    const controllers = {
      users: new UserController(services.users),
      places: new PlaceController(services.places),
      reviews: new ReviewController(services.reviews),
      itineraries: new ItineraryController(services.itineraries),
      favorites: new FavoriteController(services.favorites),
      posts: new PostController(services.posts),
      feeds: new FeedController(services.feeds),
    };

    const authenticateToken = createAuthenticateToken(tokenService);

    const app = appFactory({
      userController: controllers.users,
      placeController: controllers.places,
      reviewController: controllers.reviews,
      itineraryController: controllers.itineraries,
      favoriteController: controllers.favorites,
      postController: controllers.posts,
      feedController: controllers.feeds,
      authenticateToken,
    });

    return {
      app,
      database,
      repositories,
      services,
      controllers,
      tokenService,
      authenticateToken,
      geocodingClient,
    };
  } catch (error) {
    closeQuietly(database);
    throw error;
  }
}

function configuredPort(portValue) {
  if (portValue === undefined || String(portValue).trim() === '') {
    return 3000;
  }

  const port = Number(portValue);

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new TypeError('PORT must be an integer between 0 and 65535.');
  }

  return port;
}

export async function startServer({
  env = process.env,
  databaseOpener = openDatabase,
  passwordHasher = bcrypt,
  geocodingClientFactory = (options) => new GoogleGeocodingClient(options),
  appFactory = createApp,
  httpServerFactory = createServer,
  processObject = process,
  logger = console,
} = {}) {
  const port = configuredPort(env?.PORT);

  const application = createApplication({
    env,
    databaseOpener,
    passwordHasher,
    geocodingClientFactory,
    appFactory,
  });

  let closeDatabase;
  let server;
  let databaseClosed = false;

  closeDatabase = () => {
    if (databaseClosed) return;

    databaseClosed = true;
    application.database.close();
  };

  try {
    server = httpServerFactory(application.app);

    await new Promise((resolveListening, rejectListening) => {
      const onListening = () => {
        server.removeListener('error', onStartupError);
        resolveListening();
      };

      const onStartupError = (error) => {
        server.removeListener('listening', onListening);
        rejectListening(error);
      };

      server.once('listening', onListening);
      server.once('error', onStartupError);

      try {
        server.listen(port);
      } catch (error) {
        onStartupError(error);
      }
    });
  } catch (error) {
    closeQuietly({ close: closeDatabase });
    throw error;
  }

  let shutdownPromise;

  const removeSignalListeners = () => {
    processObject.removeListener('SIGINT', onSigint);
    processObject.removeListener('SIGTERM', onSigterm);
  };

  const shutdown = (signal = 'shutdown') => {
    if (shutdownPromise) return shutdownPromise;

    removeSignalListeners();

    shutdownPromise = new Promise((resolveShutdown) => {
      server.close((error) => {
        try {
          closeDatabase();
        } catch (closeError) {
          logger.error?.(
            'Failed to close the SQLite connection during shutdown.',
            closeError,
          );
          processObject.exitCode = 1;
        }

        if (error) {
          logger.error?.(
            `Failed to close the HTTP server after ${signal}.`,
            error,
          );
          processObject.exitCode = 1;
        }

        resolveShutdown();
      });
    });

    return shutdownPromise;
  };

  const onSigint = () => {
    void shutdown('SIGINT');
  };

  const onSigterm = () => {
    void shutdown('SIGTERM');
  };

  processObject.once('SIGINT', onSigint);
  processObject.once('SIGTERM', onSigterm);

  const address = server.address();
  const listeningPort = address && typeof address === 'object'
    ? address.port
    : port;

  logger.log?.(`Rolemap backend listening on port ${listeningPort}.`);

  return {
    ...application,
    server,
    shutdown,
    port: listeningPort,
  };
}

const currentFile = fileURLToPath(import.meta.url);

if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  startServer().catch((error) => {
    console.error(`Rolemap backend initialization failed: ${error.message}`);
    process.exitCode = 1;
  });
}
