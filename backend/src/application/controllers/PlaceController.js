import {
  AuthenticationError,
  PermissionError,
  ValidationError,
} from '../../domain/errors/DomainError.js';

const INTERNAL_ERROR_RESPONSE = { error: 'Internal server error.' };
const PLACE_NOT_FOUND_RESPONSE = { error: 'Place not found.' };
const PLACE_FIELDS = ['title', 'description', 'category', 'latitude', 'longitude'];
const DESCRIPTIVE_FIELDS = ['title', 'description', 'category'];

function pickFields(source, fields) {
  const data = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  return Object.fromEntries(fields.filter((field) => Object.hasOwn(data, field)).map((field) => [field, data[field]]));
}

function serializePlace(place) {
  const averageRating = place.averageRating;
  return {
    ...place,
    ...(averageRating === undefined ? {} : { averageRating }),
  };
}

function authenticatedUser(req) {
  const user = req.user;
  return user && typeof user.id === 'string' && user.id.trim() ? user : null;
}

export class PlaceController {
  constructor(placeService) {
    const requiredMethods = ['create', 'findById', 'findAll', 'findByCategory', 'search', 'update', 'delete'];
    if (!placeService || requiredMethods.some((method) => typeof placeService[method] !== 'function')) {
      throw new TypeError('PlaceController requires a PlaceService with place operations.');
    }
    this.placeService = placeService;
    for (const method of ['create', 'findById', 'findAll', 'findByCategory', 'search', 'update', 'delete']) {
      this[method] = this[method].bind(this);
    }
  }

  async create(req, res) {
    const user = authenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const place = await this.placeService.create(pickFields(req.body, PLACE_FIELDS), user);
      return res.status(201).json(place);
    } catch (error) {
      return this.#sendError(res, error);
    }
  }

  async findById(req, res) {
    try {
      const place = await this.placeService.findById(req.params.id);
      if (!place) return res.status(404).json(PLACE_NOT_FOUND_RESPONSE);
      return res.status(200).json(serializePlace(place));
    } catch (error) {
      return this.#sendError(res, error);
    }
  }

  async findAll(_req, res) {
    try {
      const places = await this.placeService.findAll();
      return res.status(200).json(places.map(serializePlace));
    } catch (error) {
      return this.#sendError(res, error);
    }
  }

  async findByCategory(req, res) {
    try {
      const category = req.params.category ?? req.query.category;
      const places = await this.placeService.findByCategory(category);
      return res.status(200).json(places.map(serializePlace));
    } catch (error) {
      return this.#sendError(res, error);
    }
  }

  async search(req, res) {
    try {
      const filters = pickFields(req.query, [
        'name', 'category', 'latitude', 'longitude', 'radiusKm', 'address',
      ]);
      const places = await this.placeService.search(filters);
      return res.status(200).json(places.map(serializePlace));
    } catch (error) {
      return this.#sendError(res, error);
    }
  }

  async update(req, res) {
    const user = authenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const updated = await this.placeService.update(
        req.params.id,
        pickFields(req.body, DESCRIPTIVE_FIELDS),
        user,
      );
      if (!updated) return res.status(404).json(PLACE_NOT_FOUND_RESPONSE);
      return res.status(200).json(updated);
    } catch (error) {
      return this.#sendError(res, error);
    }
  }

  async delete(req, res) {
    const user = authenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const deleted = await this.placeService.delete(req.params.id, user);
      if (!deleted) return res.status(404).json(PLACE_NOT_FOUND_RESPONSE);
      return res.status(204).end();
    } catch (error) {
      return this.#sendError(res, error);
    }
  }

  #sendError(res, error) {
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
