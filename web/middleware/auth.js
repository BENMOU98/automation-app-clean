// web/middleware/auth.js
// Authentication and authorization middleware

// Middleware to check if user is logged in
function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  
  // Store original URL to redirect after login
  req.session.returnTo = req.originalUrl;
  
  // Flash message if available
  if (req.flash) {
    req.flash('error', 'Please log in to access this page');
  }
  
  return res.redirect('/login');
}

// Middleware to check if user is an admin
function isAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  
  // Flash message if available
  if (req.flash) {
    req.flash('error', 'You need admin privileges to access this page');
  }
  
  // If logged in but not admin, go to dashboard, otherwise login
  if (req.session && req.session.user) {
    return res.redirect('/');
  } else {
    return res.redirect('/login');
  }
}

// Middleware to check if user is an employee
function isEmployee(req, res, next) {
  if (req.session && req.session.user && 
     (req.session.user.role === 'employee' || req.session.user.role === 'admin')) {
    return next();
  }
  
  // Flash message if available
  if (req.flash) {
    req.flash('error', 'You need employee privileges to access this page');
  }
  
  // If logged in but not employee, go to dashboard, otherwise login
  if (req.session && req.session.user) {
    return res.redirect('/');
  } else {
    return res.redirect('/login');
  }
}

// NEW: Middleware to check if user owns the resource or is an admin
function isResourceOwner(req, res, next) {
  // If user is an admin, always allow access
  if (req.session && req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  
  // For employees, check if they are accessing their own data
  if (req.session && req.session.user && req.session.user.role === 'employee') {
    // Set userId in request for filtering data in routes
    req.ownerId = req.session.user.id;
    return next();
  }
  
  // If not authorized
  if (req.flash) {
    req.flash('error', 'You do not have permission to access this resource');
  }
  
  // If logged in but not authorized, go to dashboard, otherwise login
  if (req.session && req.session.user) {
    return res.redirect('/');
  } else {
    return res.redirect('/login');
  }
}

// Middleware for user data in views
function attachUserToLocals(req, res, next) {
  // Make user data available to all views
  res.locals.user = req.session.user || null;
  next();
}

module.exports = {
  isAuthenticated,
  isAdmin,
  isEmployee,
  isResourceOwner,
  attachUserToLocals
};