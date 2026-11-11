const express = require('express');
const { Router } = express;
const { optionalAuth, requireAuth } = require('../middleware/auth');
const {
  signup, signin, signout, me,
  getAvatar, updateProfile, uploadAvatar, deleteAvatar,
} = require('../controllers/auth.controller');

const router = Router();

// Profile dropdown (Phase 2E): phone update + profile photo.
// No password endpoints on purpose — signup/signin remain the single
// source of truth for password rules (nothing is ever stored but the hash).
const avatarUpload = express.raw({
  type: ['image/jpeg', 'image/png', 'image/webp'],
  limit: '1mb', // user-decided cap: 1 MB photos (1048576 bytes)
});

router.post('/signup', optionalAuth, signup); // optionalAuth: owner may create owners
router.post('/signin', signin);
router.post('/signout', signout);
router.get('/me', requireAuth, me);

router.patch('/me', requireAuth, updateProfile);
router.post('/avatar', requireAuth, avatarUpload, uploadAvatar);
router.get('/avatar', requireAuth, getAvatar);
router.delete('/avatar', requireAuth, deleteAvatar);

module.exports = router;
