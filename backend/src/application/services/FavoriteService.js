import { ValidationError } from '../../domain/errors/DomainError.js';

function authenticatedUserId(user) {
  if (!user || typeof user.id !== 'string' || !user.id.trim()) {
    throw new ValidationError('An authenticated user is required.');
  }
  return user.id;
}

function requirePlaceId(placeId) {
  if (typeof placeId !== 'string' || !placeId.trim()) {
    throw new ValidationError('A valid place id is required.');
  }
}

export class FavoriteService {
  constructor(userRepository, placeRepository) {
    if (!userRepository
      || typeof userRepository.addFavorite !== 'function'
      || typeof userRepository.removeFavorite !== 'function'
      || typeof userRepository.findFavoritePlaceIds !== 'function'
      || typeof userRepository.hasFavorite !== 'function') {
      throw new TypeError('FavoriteService requires a UserRepository.');
    }
    if (!placeRepository || typeof placeRepository.findById !== 'function') {
      throw new TypeError('FavoriteService requires a PlaceRepository.');
    }
    this.userRepository = userRepository;
    this.placeRepository = placeRepository;
  }

  addFavorite(placeId, authenticatedUser) {
    const userId = authenticatedUserId(authenticatedUser);
    requirePlaceId(placeId);
    if (!this.placeRepository.findById(placeId)) {
      throw new ValidationError('Place does not exist.');
    }
    // Existing favorites are an idempotent no-op; UserRepository returns false.
    return this.userRepository.addFavorite(userId, placeId);
  }

  removeFavorite(placeId, authenticatedUser) {
    const userId = authenticatedUserId(authenticatedUser);
    requirePlaceId(placeId);
    return this.userRepository.removeFavorite(userId, placeId);
  }

  findFavorites(authenticatedUser) {
    const userId = authenticatedUserId(authenticatedUser);
    return this.userRepository.findFavoritePlaceIds(userId);
  }

  hasFavorite(placeId, authenticatedUser) {
    const userId = authenticatedUserId(authenticatedUser);
    requirePlaceId(placeId);
    return this.userRepository.hasFavorite(userId, placeId);
  }
}
