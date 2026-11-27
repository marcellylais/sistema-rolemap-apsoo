import {
  AuthenticationError,
  PermissionError,
  ValidationError,
} from '../../domain/errors/DomainError.js';

const INTERNAL_ERROR_RESPONSE = { error: 'Internal server error.' };
const FAVORITE_NOT_FOUND_RESPONSE = { error: 'Favorite not found.' };
const PLACE_NOT_FOUND_RESPONSE = { error: 'Place not found.' };

function authenticatedUser(req) {
  const user = req?.user;
  return user && typeof user.id === 'string' && user.id.trim() ? user : null;
}

export class FavoriteController {
  constructor(favoriteService) {
    const requiredMethods = ['addFavorite', 'removeFavorite', 'findFavorites', 'hasFavorite'];
    if (!favoriteService || requiredMethods.some((method) => typeof favoriteService[method] !== 'function')) {
      throw new TypeError('FavoriteController requires a FavoriteService with favorite operation methods.');
    }
    this.favoriteService = favoriteService;
    for (const method of ['add', 'remove', 'findAll', 'check']) this[method] = this[method].bind(this);
  }

  async add(req, res) {
    const user = authenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const added = await this.favoriteService.addFavorite(req.body?.placeId, user);
      return res.status(added ? 201 : 200).json(added);
    } catch (error) {
      return this.#sendError(res, error);
    }
  }

  async remove(req, res) {
    const user = authenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const removed = await this.favoriteService.removeFavorite(req.params.placeId, user);
      if (!removed) return res.status(404).json(FAVORITE_NOT_FOUND_RESPONSE);
      return res.status(204).end();
    } catch (error) {
      return this.#sendError(res, error);
    }
  }

  async findAll(req, res) {
    const user = authenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const favoritePlaceIds = await this.favoriteService.findFavorites(user);
      return res.status(200).json(favoritePlaceIds);
    } catch (error) {
      return this.#sendError(res, error);
    }
  }

  async check(req, res) {
    const user = authenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const isFavorite = await this.favoriteService.hasFavorite(req.params.placeId, user);
      return res.status(200).json(isFavorite);
    } catch (error) {
      return this.#sendError(res, error);
    }
  }

  #sendError(res, error) {
    if (error instanceof ValidationError) {
      if (error.message === 'Place does not exist.') {
        return res.status(404).json(PLACE_NOT_FOUND_RESPONSE);
      }
      return res.status(400).json({ error: error.message });
    }
    if (error instanceof PermissionError) {
      return res.status(403).json({ error: error.message });
    }
    if (error instanceof AuthenticationError) {
      return res.status(401).json({ error: error.message });
    }
    return res.status(500).json(INTERNAL_ERROR_RESPONSE);
  }
}
