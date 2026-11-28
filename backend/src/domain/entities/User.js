import { ValidationError } from '../errors/DomainError.js';

export class User {
  #favoritePlaceIds = new Set();

  constructor({ id, name, email, passwordHash, role = 'user' }) {
    if (!id || !name?.trim() || !email?.trim() || !passwordHash?.trim()) {
      throw new ValidationError('User requires id, name, email and password hash.');
    }
    if (!['user', 'admin'].includes(role)) {
      throw new ValidationError('User role must be user or admin.');
    }
    this.id = id;
    this.name = name.trim();
    this.email = email.trim().toLowerCase();
    this.passwordHash = passwordHash;
    this.role = role;
  }

  addFavorite(placeId) {
    if (!placeId) throw new ValidationError('A place id is required.');
    this.#favoritePlaceIds.add(placeId);
  }

  removeFavorite(placeId) { return this.#favoritePlaceIds.delete(placeId); }
  hasFavorite(placeId) { return this.#favoritePlaceIds.has(placeId); }
  get favoritePlaceIds() { return [...this.#favoritePlaceIds]; }
  get isAdmin() { return this.role === 'admin'; }
}
