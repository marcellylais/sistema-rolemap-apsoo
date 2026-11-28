import express from 'express';

export function createUserRouter(userController) {
  if (!userController
    || typeof userController.register !== 'function'
    || typeof userController.login !== 'function') {
    throw new TypeError('createUserRouter requires a UserController with register and login methods.');
  }

  const router = express.Router();
  router.post('/register', userController.register.bind(userController));
  router.post('/login', userController.login.bind(userController));
  return router;
}
