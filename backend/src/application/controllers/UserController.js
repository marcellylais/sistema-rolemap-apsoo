import {
  AuthenticationError,
  DuplicateEmailError,
  ValidationError,
} from '../../domain/errors/DomainError.js';

const INTERNAL_ERROR_RESPONSE = { error: 'Internal server error.' };

export class UserController {
  constructor(userService) {
    if (!userService
      || typeof userService.register !== 'function'
      || typeof userService.authenticate !== 'function') {
      throw new TypeError('UserController requires a UserService with register and authenticate methods.');
    }
    this.userService = userService;
    this.register = this.register.bind(this);
    this.login = this.login.bind(this);
  }

  async register(req, res) {
    try {
      const { name, email, password } = req.body ?? {};
      const user = await this.userService.register({ name, email, password });
      return res.status(201).json(user);
    } catch (error) {
      return this.#sendError(res, error);
    }
  }

  async login(req, res) {
    try {
      const { email, password } = req.body ?? {};
      const result = await this.userService.authenticate({ email, password });
      return res.status(200).json(result);
    } catch (error) {
      return this.#sendError(res, error);
    }
  }

  #sendError(res, error) {
    if (error instanceof ValidationError) {
      return res.status(400).json({ error: error.message });
    }
    if (error instanceof DuplicateEmailError) {
      return res.status(409).json({ error: error.message });
    }
    if (error instanceof AuthenticationError) {
      return res.status(401).json({ error: error.message });
    }
    return res.status(500).json(INTERNAL_ERROR_RESPONSE);
  }
}
