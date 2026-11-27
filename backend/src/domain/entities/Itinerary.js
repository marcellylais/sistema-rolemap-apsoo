import { ValidationError, DuplicatePlaceError } from '../errors/DomainError.js';

export class Itinerary {
  #placeIds = [];

  constructor({ id, title, description = '', ownerId, placeIds = [] }) {
    if (!id || !title?.trim() || !ownerId) throw new ValidationError('Itinerary requires id, title and owner id.');
    if (typeof description !== 'string' || !Array.isArray(placeIds)) {
      throw new ValidationError('Itinerary description and places are invalid.');
    }
    this.id = id;
    this.title = title.trim();
    this.description = description.trim();
    this.ownerId = ownerId;
    for (const placeId of placeIds) this.addPlace(placeId);
  }

  addPlace(placeId) {
    if (!placeId) throw new ValidationError('A place id is required.');
    if (this.#placeIds.includes(placeId)) throw new DuplicatePlaceError('A place can appear only once in an itinerary.');
    this.#placeIds.push(placeId);
  }

  removePlace(placeId) {
    const index = this.#placeIds.indexOf(placeId);
    if (index === -1) return false;
    this.#placeIds.splice(index, 1);
    return true;
  }

  get placeIds() { return [...this.#placeIds]; }
}
