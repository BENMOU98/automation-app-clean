// web/routes/auth-routes.js
// Routes for authentication

const express = require('express');
const router = express.Router();
const userModel = require('../models/users');
const { isAuthenticated, isAdmin } = require('../middleware/auth');

// Login page
router.get('/login', (req, res) => {
  // Redirect if already logged in
  if (req.session && req.session.user) {
    return res.redirect('/');
  }
  
  res.render('login', {
    page: 'login',
    error: req.flash ? req.flash('error') : null,
    success: req.flash ? req.flash('success') : null
  });
});

// Login form submission
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      if (req.flash) req.flash('error', 'Please provide both username and password');
      return res.redirect('/login');
    }
    
    // Authenticate user
    const user = await userModel.authenticateUser(username, password);
    
    if (!user) {
      if (req.flash) req.flash('error', 'Invalid username or password');
      return res.redirect('/login');
    }
    
    // Set user in session
    req.session.user = user;
    
    // Redirect to saved returnTo URL or dashboard
    const returnUrl = req.session.returnTo || '/';
    delete req.session.returnTo;
    
    res.redirect(returnUrl);
  } catch (error) {
    console.error('Login error:', error);
    if (req.flash) req.flash('error', 'Login failed: ' + error.message);
    res.redirect('/login');
  }
});

// Logout
router.get('/logout', (req, res) => {
  // Destroy session
  req.session.destroy(err => {
    if (err) {
      console.error('Error during logout:', err);
    }
    res.redirect('/login');
  });
});

// User management page (admin only)
router.get('/users', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const users = await userModel.getAllUsers();
    
    res.render('users', {
      page: 'users',
      users,
      error: req.flash ? req.flash('error') : null,
      success: req.flash ? req.flash('success') : null
    });
  } catch (error) {
    console.error('Error loading users page:', error);
    if (req.flash) req.flash('error', 'Failed to load users: ' + error.message);
    res.redirect('/');
  }
});

// Create user (admin only)
router.post('/users', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { username, password, name, email, role } = req.body;
    
    // Validate required fields
    if (!username || !password || !name || !email || !role) {
      if (req.flash) req.flash('error', 'All fields are required');
      return res.redirect('/users');
    }
    
    // Create user
    await userModel.createUser({
      username,
      password,
      name,
      email,
      role
    });
    
    if (req.flash) req.flash('success', 'User created successfully');
    res.redirect('/users');
  } catch (error) {
    console.error('Error creating user:', error);
    if (req.flash) req.flash('error', 'Failed to create user: ' + error.message);
    res.redirect('/users');
  }
});

// Update user (admin only)
router.post('/users/:id', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, role, password } = req.body;
    
    // Validate required fields
    if (!name || !email || !role) {
      if (req.flash) req.flash('error', 'Name, email and role are required');
      return res.redirect('/users');
    }
    
    // Update data
    const updateData = { name, email, role };
    
    // Add password if provided
    if (password) {
      updateData.password = password;
    }
    
    // Update user
    await userModel.updateUser(id, updateData);
    
    if (req.flash) req.flash('success', 'User updated successfully');
    res.redirect('/users');
  } catch (error) {
    console.error('Error updating user:', error);
    if (req.flash) req.flash('error', 'Failed to update user: ' + error.message);
    res.redirect('/users');
  }
});

// Delete user (admin only)
router.post('/users/:id/delete', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Don't allow deleting own account
    if (id === req.session.user.id) {
      if (req.flash) req.flash('error', 'You cannot delete your own account');
      return res.redirect('/users');
    }
    
    // Delete user
    await userModel.deleteUser(id);
    
    if (req.flash) req.flash('success', 'User deleted successfully');
    res.redirect('/users');
  } catch (error) {
    console.error('Error deleting user:', error);
    if (req.flash) req.flash('error', 'Failed to delete user: ' + error.message);
    res.redirect('/users');
  }
});

// My profile page
router.get('/profile', isAuthenticated, (req, res) => {
  res.render('profile', {
    page: 'profile',
    error: req.flash ? req.flash('error') : null,
    success: req.flash ? req.flash('success') : null
  });
});

// Update profile
router.post('/profile', isAuthenticated, async (req, res) => {
  try {
    const { name, email, currentPassword, newPassword } = req.body;
    
    // Validate required fields
    if (!name || !email) {
      if (req.flash) req.flash('error', 'Name and email are required');
      return res.redirect('/profile');
    }
    
    // Update data
    const updateData = { name, email };
    
    // If changing password, validate current password
    if (newPassword) {
      if (!currentPassword) {
        if (req.flash) req.flash('error', 'Current password is required to set a new password');
        return res.redirect('/profile');
      }
      
      // Get all users to verify password
      const users = await userModel.getAllUsers();
      const user = users.find(u => u.id === req.session.user.id);
      
      if (!user || user.password !== userModel.hashPassword(currentPassword)) {
        if (req.flash) req.flash('error', 'Current password is incorrect');
        return res.redirect('/profile');
      }
      
      // Password is correct, update it
      updateData.password = newPassword;
    }
    
    // Update user
    const updatedUser = await userModel.updateUser(req.session.user.id, updateData);
    
    // Update session
    req.session.user = updatedUser;
    
    if (req.flash) req.flash('success', 'Profile updated successfully');
    res.redirect('/profile');
  } catch (error) {
    console.error('Error updating profile:', error);
    if (req.flash) req.flash('error', 'Failed to update profile: ' + error.message);
    res.redirect('/profile');
  }
});

module.exports = router;