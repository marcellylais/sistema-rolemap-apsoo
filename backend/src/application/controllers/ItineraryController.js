import {
  AuthenticationError,
  DuplicatePlaceError,
  PermissionError,
  ValidationError,
} from '../../domain/errors/DomainError.js';

const INTERNAL_ERROR_RESPONSE = { error: 'Internal server error.' };
const ITINERARY_NOT_FOUND_RESPONSE = { error: 'Itinerary not found.' };

function pickFields(source, fields) {
  const data = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  return Object.fromEntries(fields
    .filter((field) => Object.hasOwn(data, field))
    .map((field) => [field, data[field]]));
}

function authenticatedUser(req) {
  const user = req?.user;
  return user && typeof user.id === 'string' && user.id.trim() ? user : null;
}

export class ItineraryController {
  constructor(itineraryService) {
    const requiredMethods = ['create', 'findById', 'findByOwner', 'update', 'addPlace', 'removePlace', 'delete'];
    if (!itineraryService || requiredMethods.some((method) => typeof itineraryService[method] !== 'function')) {
      throw new TypeError('ItineraryController requires an ItineraryService with itinerary operation methods.');
    }
    this.itineraryService = itineraryService;
    for (const method of ['create', 'findAll', 'findByOwner', 'findById', 'update', 'addPlace', 'removePlace', 'delete']) {
      this[method] = this[method].bind(this);
    }
  }

  async create(req, res) {
    const user = authenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const itinerary = await this.itineraryService.create(
        pickFields(req.body, ['title', 'description', 'placeIds']),
        user,
      );
      return res.status(201).json(itinerary);
    } catch (error) {
      return this.#sendError(res, error);
    }
  }

  async findAll(req, res) {
    // GET / lists only the authenticated owner's itineraries; ItineraryService has no global findAll.
    return this.findByOwner(req, res);
  }

  async findByOwner(req, res) {
    const user = authenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const itineraries = await this.itineraryService.findByOwner(user);
      return res.status(200).json(itineraries);
    } catch (error) {
      return this.#sendError(res, error);
    }
  }

  async findById(req, res) {
    const user = authenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const itinerary = await this.itineraryService.findById(req.params.id, user);
      if (!itinerary) return res.status(404).json(ITINERARY_NOT_FOUND_RESPONSE);
      return res.status(200).json(itinerary);
    } catch (error) {
      return this.#sendError(res, error);
    }
  }

  async update(req, res) {
    const user = authenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const updated = await this.itineraryService.update(
        req.params.id,
        pickFields(req.body, ['title', 'description']),
        user,
      );
      if (!updated) return res.status(404).json(ITINERARY_NOT_FOUND_RESPONSE);
      return res.status(200).json(updated);
    } catch (error) {
      return this.#sendError(res, error);
    }
  }

  async addPlace(req, res) {
    const user = authenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const result = await this.itineraryService.addPlace(req.params.id, req.body?.placeId, user);
      if (!result) return res.status(404).json(ITINERARY_NOT_FOUND_RESPONSE);
      return res.status(200).json(result);
    } catch (error) {
      return this.#sendError(res, error);
    }
  }

  async removePlace(req, res) {
    const user = authenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const removed = await this.itineraryService.removePlace(req.params.id, req.params.placeId, user);
      if (!removed) return res.status(404).json(ITINERARY_NOT_FOUND_RESPONSE);
      return res.status(204).end();
    } catch (error) {
      return this.#sendError(res, error);
    }
  }

  async delete(req, res) {
    const user = authenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const deleted = await this.itineraryService.delete(req.params.id, user);
      if (!deleted) return res.status(404).json(ITINERARY_NOT_FOUND_RESPONSE);
      return res.status(204).end();
    } catch (error) {
      return this.#sendError(res, error);
    }
  }

  #sendError(res, error) {
    if (error instanceof DuplicatePlaceError) {
      return res.status(409).json({ error: error.message });
    }
    if (error instanceof ValidationError) {
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
