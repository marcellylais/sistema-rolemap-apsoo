import { randomUUID } from 'node:crypto';
import { User } from '../../domain/entities/User.js';
import { AuthenticationError, DuplicateEmailError, ValidationError } from '../../domain/errors/DomainError.js';

const BCRYPT_ROUNDS = 10;
const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password.';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function toPublicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

export class UserService {
  constructor(userRepository, passwordHasher, tokenService) {
    if (!userRepository || typeof userRepository.findByEmail !== 'function' || typeof userRepository.create !== 'function') {
      throw new TypeError('UserService requires a UserRepository.');
    }
    if (!passwordHasher || typeof passwordHasher.hash !== 'function' || typeof passwordHasher.compare !== 'function') {
      throw new TypeError('UserService requires a password hasher with hash and compare methods.');
    }
    if (!tokenService || typeof tokenService.generateToken !== 'function') {
      throw new TypeError('UserService requires a TokenService with a generateToken method.');
    }
    this.userRepository = userRepository;
    this.passwordHasher = passwordHasher;
    this.tokenService = tokenService;
  }

  async register({ name, email, password } = {}) {
    const normalizedName = typeof name === 'string' ? name.trim() : '';
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedName || !EMAIL_PATTERN.test(normalizedEmail) || typeof password !== 'string' || !password) {
      throw new ValidationError('Name, valid email and password are required.');
    }

    if (this.userRepository.findByEmail(normalizedEmail)) {
      throw new DuplicateEmailError('A user with this email already exists.');
    }

    const passwordHash = await this.passwordHasher.hash(password, BCRYPT_ROUNDS);
    const user = new User({
      id: randomUUID(),
      name: normalizedName,
      email: normalizedEmail,
      passwordHash,
      role: 'user',
    });

    // The repository also protects the unique constraint against concurrent registrations.
    const createdUser = await this.userRepository.create(user);
    return toPublicUser(createdUser);
  }

  async authenticate({ email, password } = {}) {
    const normalizedEmail = normalizeEmail(email);
    if (!EMAIL_PATTERN.test(normalizedEmail) || typeof password !== 'string' || !password) {
      throw new AuthenticationError(INVALID_CREDENTIALS_MESSAGE);
    }

    const user = await this.userRepository.findByEmail(normalizedEmail);
    if (!user) throw new AuthenticationError(INVALID_CREDENTIALS_MESSAGE);

    const passwordMatches = await this.passwordHasher.compare(password, user.passwordHash);
    if (!passwordMatches) throw new AuthenticationError(INVALID_CREDENTIALS_MESSAGE);

    const token = this.tokenService.generateToken(user);
    return { user: toPublicUser(user), token };
  }
}
