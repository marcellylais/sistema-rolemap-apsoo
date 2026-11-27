import { randomUUID } from 'node:crypto';
import { Place } from '../../domain/entities/Place.js';
import { PermissionError, ValidationError } from '../../domain/errors/DomainError.js';

function requirePlaceData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ValidationError('Place data is required.');
  }
  return data;
}

function requireText(value, fieldName, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    throw new ValidationError(`${fieldName} must be ${allowEmpty ? 'a string' : 'a non-empty string'}.`);
  }
  return value;
}

function authenticatedPrincipal(user) {
  if (!user || typeof user.id !== 'string' || !user.id.trim()) {
    throw new ValidationError('An authenticated user is required.');
  }
  // Service callers supply the authenticated principal, not client-provided place data.
  return { id: user.id, isAdmin: user.isAdmin === true || user.role === 'admin' };
}

function descriptionFields(data, currentPlace = null) {
  requirePlaceData(data);
  const title = data.title === undefined ? currentPlace?.title : data.title;
  const description = data.description === undefined ? (currentPlace?.description ?? '') : data.description;
  const category = data.category === undefined ? currentPlace?.category : data.category;

  return {
    title: requireText(title, 'Title'),
    description: requireText(description, 'Description', { allowEmpty: true }),
    category: requireText(category, 'Category'),
  };
}

function optionalText(value, fieldName) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

function searchNumber(value, fieldName) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  throw new ValidationError(`${fieldName} must be a finite number.`);
}

function validateSearchCriteria(criteria) {
  if (!criteria || typeof criteria !== 'object' || Array.isArray(criteria)) {
    throw new ValidationError('Search criteria are required.');
  }

  const name = optionalText(criteria.name, 'Name');
  const category = optionalText(criteria.category, 'Category');
  const address = optionalText(criteria.address, 'Address');
  const hasLatitude = criteria.latitude !== undefined;
  const hasLongitude = criteria.longitude !== undefined;
  const hasRadius = criteria.radiusKm !== undefined;
  const hasCoordinates = hasLatitude || hasLongitude;
  const hasLocation = Boolean(address) || hasCoordinates;
  const hasProximity = hasLocation || hasRadius;

  if (!name && !category && !hasProximity) {
    throw new ValidationError('At least one place search filter is required.');
  }

  if (hasProximity) {
    if (!hasRadius) throw new ValidationError('radiusKm is required for proximity searches.');
    if (Boolean(address) && hasCoordinates) {
      throw new ValidationError('Use either address or latitude/longitude as the origin, not both.');
    }
    if (!address && !(hasLatitude && hasLongitude)) {
      throw new ValidationError('Provide both latitude and longitude, or an address, for proximity searches.');
    }
  }

  const validated = { name, category };
  if (hasProximity) {
    const radiusKm = searchNumber(criteria.radiusKm, 'radiusKm');
    if (radiusKm <= 0) throw new ValidationError('radiusKm must be greater than zero.');
    validated.radiusKm = radiusKm;

    if (address) {
      validated.address = address;
    } else {
      const latitude = searchNumber(criteria.latitude, 'latitude');
      const longitude = searchNumber(criteria.longitude, 'longitude');
      if (latitude < -90 || latitude > 90) {
        throw new ValidationError('Latitude must be a number from -90 to 90.');
      }
      if (longitude < -180 || longitude > 180) {
        throw new ValidationError('Longitude must be a number from -180 to 180.');
      }
      validated.latitude = latitude;
      validated.longitude = longitude;
    }
  }

  return validated;
}

export class PlaceService {
  constructor(placeRepository, geocodingClient = null) {
    if (!placeRepository
      || typeof placeRepository.create !== 'function'
      || typeof placeRepository.findById !== 'function'
      || typeof placeRepository.findAll !== 'function'
      || typeof placeRepository.findByCategory !== 'function'
      || typeof placeRepository.search !== 'function'
      || typeof placeRepository.update !== 'function') {
      throw new TypeError('PlaceService requires a PlaceRepository.');
    }
    if (geocodingClient !== null && typeof geocodingClient.geocode !== 'function') {
      throw new TypeError('PlaceService geocoding dependency must provide geocode().');
    }
    this.placeRepository = placeRepository;
    this.geocodingClient = geocodingClient;
  }

  create(data, authenticatedUser) {
    const principal = authenticatedPrincipal(authenticatedUser);
    const fields = descriptionFields(data);
    const place = new Place({
      id: randomUUID(),
      ...fields,
      latitude: data.latitude,
      longitude: data.longitude,
      authorId: principal.id,
    });
    return this.placeRepository.create(place);
  }

  findById(id) {
    return this.placeRepository.findById(id);
  }

  findAll() {
    return this.placeRepository.findAll();
  }

  findByCategory(category) {
    return this.placeRepository.findByCategory(category);
  }

  async search(criteria) {
    const filters = validateSearchCriteria(criteria);
    if (filters.address) {
      if (!this.geocodingClient) throw new Error('Address geocoding is not configured.');
      const location = await this.geocodingClient.geocode(filters.address);
      if (!location) throw new ValidationError('Address could not be geocoded.');
      const { latitude, longitude } = location;
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
        throw new Error('Geocoding service returned an invalid latitude.');
      }
      if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        throw new Error('Geocoding service returned an invalid longitude.');
      }
      filters.latitude = latitude;
      filters.longitude = longitude;
      delete filters.address;
    }
    return this.placeRepository.search(filters);
  }

  update(id, data, authenticatedUser) {
    const principal = authenticatedPrincipal(authenticatedUser);
    const existingPlace = this.placeRepository.findById(id);
    if (!existingPlace) return false;

    const fields = descriptionFields(data, existingPlace);
    const updatedPlace = new Place({
      id: existingPlace.id,
      ...fields,
      latitude: existingPlace.latitude,
      longitude: existingPlace.longitude,
      authorId: existingPlace.authorId,
    });

    // PlaceRepository delegates authorization to Place.updateDescription using its persisted author.
    return this.placeRepository.update(updatedPlace, principal);
  }

  delete(id, authenticatedUser) {
    const principal = authenticatedPrincipal(authenticatedUser);
    const existingPlace = this.placeRepository.findById(id);
    if (!existingPlace) return false;

    if (!existingPlace.canBeEditedBy(principal)) {
      throw new PermissionError('Only the place author or an administrator may delete it.');
    }

    return this.placeRepository.delete(id);
  }
}
