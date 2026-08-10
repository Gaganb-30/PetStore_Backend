import jwt from 'jsonwebtoken';
import config from '../config/index.js';

/**
 * Generate JWT access token (short-lived)
 */
export const generateAccessToken = (userId) => {
  return jwt.sign({ id: userId }, config.jwtSecret, {
    expiresIn: config.jwtExpire,
  });
};

/**
 * Generate JWT refresh token (long-lived)
 */
export const generateRefreshToken = (userId) => {
  return jwt.sign({ id: userId }, config.jwtRefreshSecret, {
    expiresIn: config.jwtRefreshExpire,
  });
};

/**
 * Verify refresh token
 */
export const verifyRefreshToken = (token) => {
  return jwt.verify(token, config.jwtRefreshSecret);
};
