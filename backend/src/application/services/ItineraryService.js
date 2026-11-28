import { randomUUID } from 'node:crypto';
import { Itinerary } from '../../domain/entities/Itinerary.js';
import { PermissionError, ValidationError } from '../../domain/errors/DomainError.js';

function authenticatedUserId(user) {
  if (!user || typeof user.id !== 'string' || !user.id.trim()) {
    throw new ValidationError('An authenticated user is required.');
  }
  return user.id;
}

function requireObject(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ValidationError('Itinerary data is required.');
  }
}

function requireTitle(title) {
  if (typeof title !== 'string' || !title.trim()) {
    throw new ValidationError('Itinerary title is required.');
  }
  return title;
}

function requireDescription(description) {
  if (typeof description !== 'string') {
    throw new ValidationError('Itinerary description must be a string.');
  }
  return description;
}

function validatePlaceIds(placeIds) {
  if (!Array.isArray(placeIds)) throw new ValidationError('Itinerary places must be a list of IDs.');
  if (placeIds.some((placeId) => typeof placeId !== 'string' || !placeId.trim())) {
    throw new ValidationError('Every itinerary place must have a valid ID.');
  }
}

export class ItineraryService {
  constructor(itineraryRepository, placeRepository) {
    if (!itineraryRepository
      || typeof itineraryRepository.create !== 'function'
      || typeof itineraryRepository.findById !== 'function'
      || typeof itineraryRepository.findByOwnerId !== 'function'
      || typeof itineraryRepository.update !== 'function'
      || typeof itineraryRepository.addPlace !== 'function'
      || typeof itineraryRepository.removePlace !== 'function'
      || typeof itineraryRepository.delete !== 'function') {
      throw new TypeError('ItineraryService requires an ItineraryRepository.');
    }
    if (!placeRepository || typeof placeRepository.findById !== 'function') {
      throw new TypeError('ItineraryService requires a PlaceRepository.');
    }
    this.itineraryRepository = itineraryRepository;
    this.placeRepository = placeRepository;
  }

  create(data, authenticatedUser) {
    requireObject(data);
    const ownerId = authenticatedUserId(authenticatedUser);
    const title = requireTitle(data.title);
    const description = requireDescription(data.description);
    const placeIds = data.placeIds === undefined ? [] : data.placeIds;
    validatePlaceIds(placeIds);

    // Itinerary enforces RN04 before persistence; place existence is checked through its repository.
    const itinerary = new Itinerary({
      id: randomUUID(),
      title,
      description,
      ownerId,
      placeIds,
    });
    this.#ensurePlacesExist(placeIds);
    return this.itineraryRepository.create(itinerary, ownerId);
  }

  findById(id, authenticatedUser) {
    const ownerId = authenticatedUserId(authenticatedUser);
    const itinerary = this.itineraryRepository.findById(id);
    if (!itinerary) return null;
    if (itinerary.ownerId !== ownerId) {
      throw new PermissionError('Only the itinerary owner may view it.');
    }
    return itinerary;
  }

  findByOwner(authenticatedUser) {
    const ownerId = authenticatedUserId(authenticatedUser);
    return this.itineraryRepository.findByOwnerId(ownerId);
  }

  update(id, data, authenticatedUser) {
    const ownerId = authenticatedUserId(authenticatedUser);
    requireObject(data);
    const existing = this.itineraryRepository.findById(id);
    if (!existing) return false;

    const itinerary = new Itinerary({
      id: existing.id,
      title: requireTitle(data.title === undefined ? existing.title : data.title),
      description: requireDescription(data.description === undefined ? existing.description : data.description),
      // Preserve the persisted owner and place order; ignore ownerId/placeIds from request data.
      ownerId: existing.ownerId,
      placeIds: existing.placeIds,
    });
    return this.itineraryRepository.update(itinerary, ownerId);
  }

  addPlace(itineraryId, placeId, authenticatedUser) {
    const ownerId = authenticatedUserId(authenticatedUser);
    if (!this.placeRepository.findById(placeId)) {
      throw new ValidationError('Place does not exist.');
    }
    return this.itineraryRepository.addPlace(itineraryId, placeId, ownerId);
  }

  removePlace(itineraryId, placeId, authenticatedUser) {
    const ownerId = authenticatedUserId(authenticatedUser);
    return this.itineraryRepository.removePlace(itineraryId, placeId, ownerId);
  }

  delete(id, authenticatedUser) {
    const ownerId = authenticatedUserId(authenticatedUser);
    return this.itineraryRepository.delete(id, ownerId);
  }

  #ensurePlacesExist(placeIds) {
    for (const placeId of placeIds) {
      if (!this.placeRepository.findById(placeId)) {
        throw new ValidationError(`Place does not exist: ${placeId}`);
      }
    }
  }
}
