const { Router } = require('express');
const { optionalAuth, requireAuth } = require('../middleware/auth');
const { signup, signin, signout, me } = require('../controllers/auth.controller');

const router = Router();

router.post('/signup', optionalAuth, signup); // optionalAuth: owner may create owners
router.post('/signin', signin);
router.post('/signout', signout);
router.get('/me', requireAuth, me);

module.exports = router;
