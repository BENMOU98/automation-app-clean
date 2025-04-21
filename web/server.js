// web/server.js
//
// This is the main server file for the WordPress Automation web interface.
// It sets up an Express.js server that provides a web interface to manage
// the WordPress content automation platform.

// Load environment variables
require('dotenv').config();

// Import required modules - fixed duplicate declarations
const express = require('express');
const path = require('path');
const multer = require('multer');
const XLSX = require('xlsx');
const fs = require('fs').promises;  // Use promise-based fs
const axios = require('axios');
const session = require('express-session');
const flash = require('connect-flash');

// Import our existing automation modules
const { config, validateConfig, saveConfig, loadConfig } = require('../src/config');
const { readKeywordsFromExcel, updateExcelWithPublicationStatus, addKeywordsToExcel } = require('../src/excel');
const { generateArticleContent } = require('../src/openai');
const { testWordPressConnection, publishToWordPress } = require('../src/wordpress');

// Import updated authentication middleware
const { 
  isAuthenticated, 
  isAdmin, 
  isEmployee, 
  isResourceOwner,
  attachUserToLocals 
} = require('./middleware/auth');

// Import user model
const userModel = require('./models/users');

// Helper function for fs.existsSync since we're using promise-based fs
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Helper function to read file as string
async function readFile(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error);
    throw error;
  }
}

// Helper function to write file
async function writeFile(filePath, content) {
  try {
    await fs.writeFile(filePath, content, 'utf8');
  } catch (error) {
    console.error(`Error writing file ${filePath}:`, error);
    throw error;
  }
}

// Create the Express application
const app = express();
const port = process.env.PORT || 4000;

// Configure middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Configure session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'wordpress-automation-secret',
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Configure flash messages
app.use(flash());

// Configure file uploads
const upload = multer({ dest: 'uploads/' });

// API endpoint to get article content by keyword - With ownership check
app.get('/api/article-content', isAuthenticated, async (req, res) => {
  try {
    const { keyword } = req.query;
    
    if (!keyword) {
      return res.status(400).json({ success: false, error: 'Keyword is required' });
    }
    
    console.log(`Getting article content for keyword: ${keyword}`);
    
    // Check if the keyword exists in Excel
    try {
      // Load the Excel file directly to avoid any potential issues with the utility function
      const workbook = XLSX.readFile(config.app.excelFile);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet);
      
      // Find the keyword
      const keywordRow = data.find(row => row[config.app.keywordColumn] === keyword);
      
      if (!keywordRow) {
        console.log(`Keyword "${keyword}" not found in Excel file`);
        return res.status(404).json({ success: false, error: 'Keyword not found in Excel file' });
      }
      
      // Check ownership for employees
      if (req.session.user.role === 'employee') {
        if (keywordRow.OwnerId && keywordRow.OwnerId !== req.session.user.id &&
            keywordRow.CreatedBy && keywordRow.CreatedBy !== req.session.user.id) {
          return res.status(403).json({ 
            success: false, 
            error: 'You do not have permission to access this content' 
          });
        }
      }
      
      console.log('Found keyword row:', keywordRow);
      
      // Try to get content from WordPress if Post ID exists
      if (keywordRow['Post ID']) {
        try {
          console.log(`Fetching content from WordPress for Post ID: ${keywordRow['Post ID']}`);
          
          // Create authentication header
          const authString = `${config.wordpress.username}:${config.wordpress.password}`;
          const encodedAuth = Buffer.from(authString).toString('base64');
          
          // Get post content from WordPress
          const response = await axios.get(`${config.wordpress.apiUrl}/posts/${keywordRow['Post ID']}`, {
            headers: {
              'Authorization': `Basic ${encodedAuth}`
            }
          });
          
          if (response.data && response.data.id) {
            console.log('Successfully retrieved content from WordPress');
            // Return the article content
            const article = {
              title: response.data.title.rendered || 'No Title',
              content: response.data.content.rendered || 'No Content'
            };
            
            return res.json({ success: true, article });
          }
        } catch (wpError) {
          console.error('Error fetching from WordPress:', wpError.message);
          // Continue to fallbacks below
        }
      } else {
        console.log('Post ID not found in Excel row');
      }
      
      // If we get here, try cache
      console.log('Trying cache...');
      if (req.app.locals.cachedArticles && req.app.locals.cachedArticles[keyword]) {
        console.log('Found article in cache');
        return res.json({ 
          success: true, 
          article: req.app.locals.cachedArticles[keyword],
          source: 'cache'
        });
      }
      
      // Last resort - create a simple dummy article
      console.log('No content found, returning dummy article');
      return res.json({
        success: true,
        article: {
          title: `Article about ${keyword}`,
          content: `<p>This article about "${keyword}" is published to WordPress, but the content cannot be retrieved.</p>
                   <p>You might need to view it directly on your WordPress site.</p>`
        },
        source: 'dummy'
      });
      
    } catch (excelError) {
      console.error('Error reading Excel file:', excelError);
      return res.status(500).json({ 
        success: false, 
        error: `Failed to read Excel file: ${excelError.message}` 
      });
    }
  } catch (error) {
    console.error('Error in article-content endpoint:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API endpoint to delete article from history - With ownership check
app.post('/api/delete-article-history', isAuthenticated, isEmployee, async (req, res) => {
  try {
    const { keyword } = req.body;
    
    if (!keyword) {
      console.log('No keyword provided for deletion');
      return res.status(400).json({ success: false, error: 'Keyword is required' });
    }
    
    console.log(`Deleting article history for keyword: ${keyword}`);
    
    try {
      // Read the Excel file
      const workbook = XLSX.readFile(config.app.excelFile);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet);
      
      // Find the keyword entry
      const keywordIndex = data.findIndex(row => row[config.app.keywordColumn] === keyword);
      
      if (keywordIndex === -1) {
        console.log(`Keyword "${keyword}" not found in Excel file`);
        return res.status(404).json({ success: false, error: 'Keyword not found in Excel file' });
      }
      
      // Check ownership for employees
      if (req.session.user.role === 'employee') {
        if (data[keywordIndex].OwnerId && data[keywordIndex].OwnerId !== req.session.user.id &&
            data[keywordIndex].CreatedBy && data[keywordIndex].CreatedBy !== req.session.user.id) {
          return res.status(403).json({
            success: false,
            error: 'You do not have permission to modify this article history'
          });
        }
      }
      
      console.log(`Found keyword at index ${keywordIndex}`);
      
      // Reset the status and publication data but keep the keyword
      const updatedRow = {};
      
      // Copy all fields from the original row
      Object.keys(data[keywordIndex]).forEach(key => {
        updatedRow[key] = data[keywordIndex][key];
      });
      
      // Override the fields we want to change
      updatedRow['Status'] = 'Pending';
      updatedRow['Publication Date'] = '';
      updatedRow['Post URL'] = '';
      updatedRow['Post ID'] = '';
      
      // Update the row
      data[keywordIndex] = updatedRow;
      
      // Write the updated data back to the Excel file
      const newWorksheet = XLSX.utils.json_to_sheet(data);
      workbook.Sheets[sheetName] = newWorksheet;
      XLSX.writeFile(workbook, config.app.excelFile);
      
      console.log('Successfully reset keyword status to pending');
      
      // Remove from cache if it exists
      if (req.app.locals.cachedArticles && req.app.locals.cachedArticles[keyword]) {
        delete req.app.locals.cachedArticles[keyword];
        console.log('Removed from cache');
      }
      
      // Return success
      return res.json({ 
        success: true, 
        message: 'Article deleted from history successfully' 
      });
    } catch (excelError) {
      console.error('Error manipulating Excel file:', excelError);
      return res.status(500).json({ 
        success: false, 
        error: `Failed to update Excel file: ${excelError.message}` 
      });
    }
  } catch (error) {
    console.error('Error in delete-article-history endpoint:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

//====================================================
// AUTOMATION FUNCTIONS
//====================================================

// Function to process a single keyword
async function processSingleKeyword(keywordRow) {
  try {
    const keyword = keywordRow[config.app.keywordColumn];
    
    // Update progress
    jobProgress.current = 0;
    jobProgress.currentKeyword = keyword;
    jobProgress.status = 'Processing';
    
    logProgress(`Processing keyword: "${keyword}"`);
    
    // Generate article content
    logProgress(`Generating content for "${keyword}"...`);
    
    // Check if we should use prompts settings
    let promptSettings = null;
    
    if (config.prompts) {
      promptSettings = {
        useMultiPartGeneration: config.prompts.useMultiPartGeneration,
        mainPrompt: config.prompts.mainPrompt || config.app.contentTemplate,
        part1Prompt: config.prompts.part1Prompt,
        part2Prompt: config.prompts.part2Prompt,
        part3Prompt: config.prompts.part3Prompt,
        toneVoice: config.prompts.toneVoice,
        seoGuidelines: config.prompts.seoGuidelines,
        thingsToAvoid: config.prompts.thingsToAvoid
      };
    } else if (config.app.contentTemplate) {
      // Fallback to just using content template
      promptSettings = config.app.contentTemplate;
    }
    
    const article = await generateArticleContent(
      config.openai, 
      keyword, 
      config.app.minWords,
      promptSettings
    );
    
    // Publish to WordPress
    logProgress(`Publishing "${keyword}" to WordPress...`);
    const publishData = await publishToWordPress(
      config.wordpress,
      article,
      keyword,
      config.app.publishStatus
    );
    
    // Update Excel with publication status
    updateExcelWithPublicationStatus(config.app.excelFile, keywordRow, publishData);
    
    // Log success with a checkmark
    logProgress(`✓ Published "${keyword}" successfully as ${config.app.publishStatus}`);
    
    // Update progress
    jobProgress.current = 1;
    jobProgress.status = 'Completed';
    
    return true;
  } catch (error) {
    // Log error with an X mark
    logProgress(`✗ Failed to process "${keywordRow[config.app.keywordColumn]}": ${error.message}`);
    throw error;
  }
}

// Function to run the automation
async function runAutomation(keywordFilter = null) {
  try {
    // Read keywords from Excel
    let keywordRows = readKeywordsFromExcel(config.app.excelFile, config.app.keywordColumn);
    
    // Apply filter if provided (for employee access)
    if (keywordFilter) {
      keywordRows = keywordRows.filter(keywordFilter);
    }
    
    if (keywordRows.length === 0) {
      logProgress('No pending keywords found in Excel file. Nothing to do.');
      return;
    }
    
    // Update progress info
    jobProgress.total = keywordRows.length;
    jobProgress.current = 0;
    jobProgress.status = 'Processing keywords';
    
    // Track success and failures
    let successCount = 0;
    let failureCount = 0;
    
    // Start with a summary log
    logProgress(`Started processing ${keywordRows.length} keywords`);
    
    // Process each keyword
    for (let i = 0; i < keywordRows.length; i++) {
      const keywordRow = keywordRows[i];
      const keyword = keywordRow[config.app.keywordColumn];
      
      // Update progress
      jobProgress.current = i + 1;
      jobProgress.currentKeyword = keyword;
      
      // Log in a simplified format
      logProgress(`Processing: "${keyword}" (${i + 1}/${keywordRows.length})`);
      
      try {
        // Generate article content
        logProgress(`Generating content for "${keyword}"...`);
        
        // Check if we should use prompts settings
        let promptSettings = null;
        
        if (config.prompts) {
          promptSettings = {
            useMultiPartGeneration: config.prompts.useMultiPartGeneration,
            mainPrompt: config.prompts.mainPrompt || config.app.contentTemplate,
            part1Prompt: config.prompts.part1Prompt,
            part2Prompt: config.prompts.part2Prompt,
            part3Prompt: config.prompts.part3Prompt,
            toneVoice: config.prompts.toneVoice,
            seoGuidelines: config.prompts.seoGuidelines,
            thingsToAvoid: config.prompts.thingsToAvoid
          };
        } else if (config.app.contentTemplate) {
          // Fallback to just using content template
          promptSettings = config.app.contentTemplate;
        }
        
        const article = await generateArticleContent(
          config.openai, 
          keyword, 
          config.app.minWords,
          promptSettings
        );
        
        // Publish to WordPress
        logProgress(`Publishing "${keyword}" to WordPress...`);
        const publishData = await publishToWordPress(
          config.wordpress,
          article,
          keyword,
          config.app.publishStatus
        );
        
        // Update Excel with publication status
        updateExcelWithPublicationStatus(config.app.excelFile, keywordRow, publishData);
        
        // Log success with a checkmark
        logProgress(`✓ Published "${keyword}" successfully as ${config.app.publishStatus}`);
        successCount++;
        
        // Add a delay between keywords
        if (i < keywordRows.length - 1) {
          logProgress(`Waiting before next keyword...`);
          await new Promise(resolve => setTimeout(resolve, config.app.delayBetweenPosts));
        }
      } catch (error) {
        // Log error with an X mark
        logProgress(`✗ Failed to process "${keyword}": ${error.message}`);
        failureCount++;
        // Continue with next keyword
      }
    }
    
    // Log completion summary
    logProgress(`Automation completed: ${successCount} published, ${failureCount} failed`);
  } catch (error) {
    logProgress(`Automation failed: ${error.message}`);
    throw error;
  }
}

// Ensure data directory exists before starting
async function initializeApp() {
  try {
    // Create data directory if it doesn't exist
    const dataDir = path.join(__dirname, '../data');
    try {
      await fs.mkdir(dataDir, { recursive: true });
      console.log('Data directory initialized');
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    
    // Create users.json file with default admin user if it doesn't exist
    await ensureUsersFileExists();
    console.log('User authentication system initialized');
    
    // Initialize ownership for existing keywords if Excel file exists
    try {
      if (await fileExists(config.app.excelFile)) {
        // Get admin user ID
        const users = await getAllUsers();
        const adminUser = users.find(user => user.role === 'admin');
        
        if (adminUser) {
          await userModel.initializeKeywordOwnership(config.app.excelFile, config.app.keywordColumn, adminUser.id);
        }
      }
    } catch (ownershipError) {
      console.warn('Error initializing keyword ownership:', ownershipError);
      // Continue without failing - application will still work
    }
  } catch (error) {
    console.error('Error initializing app:', error);
    throw error;
  }
}

// Admin employee dashboard route for monitoring employee activities
app.get('/admin/employee-dashboard', isAuthenticated, isAdmin, async (req, res) => {
  try {
    // Get all employees
    const allUsers = await getAllUsers();
    const employees = allUsers.filter(user => user.role === 'employee');
    
    // Optional: Get selected employee ID from query params
    const selectedEmployeeId = req.query.employeeId || '';
    let selectedEmployee = null;
    let keywords = [];
    let publications = [];
    let activityLog = [];
    let stats = {
      totalKeywords: 0,
      publishedKeywords: 0,
      pendingKeywords: 0,
      todayActivity: 0
    };
    
    // If an employee is selected, get their data
    if (selectedEmployeeId) {
      // Find selected employee
      selectedEmployee = employees.find(emp => emp.id === selectedEmployeeId);
      
      if (selectedEmployee) {
        // Get employee's keywords
        const excelFileExists = await fileExists(config.app.excelFile);
        
        if (excelFileExists) {
          const workbook = XLSX.readFile(config.app.excelFile);
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const data = XLSX.utils.sheet_to_json(worksheet);
          
          // Filter data for the selected employee
          keywords = data.filter(row => 
            row.OwnerId === selectedEmployeeId || row.CreatedBy === selectedEmployeeId
          );
          
          // Filter for published articles
          publications = keywords.filter(row => row.Status === 'Published');
          
          // Calculate statistics
          stats.totalKeywords = keywords.length;
          stats.publishedKeywords = publications.length;
          stats.pendingKeywords = keywords.filter(row => 
            row.Status === 'Pending' || !row.Status || row.Status === ''
          ).length;
          
          // Create dummy activity log for now (can be replaced with actual logging system)
          // In a real implementation, you would read from a proper activity log
          activityLog = createDummyActivityLog(keywords, publications, selectedEmployeeId);
          
          // Count today's activity
          const today = new Date().toISOString().split('T')[0]; // Get YYYY-MM-DD
          stats.todayActivity = activityLog.filter(log => 
            log.timestamp.startsWith(today)
          ).length;
        }
      }
    }
    
    // Render the employee dashboard view
    res.render('employee-dashboard', {
      page: 'employee-dashboard',
      employees,
      selectedEmployeeId,
      selectedEmployee,
      keywords,
      publications,
      activityLog,
      stats,
      keywordColumn: config.app.keywordColumn,
      error: req.flash('error'),
      success: req.flash('success')
    });
  } catch (error) {
    console.error('Error loading employee dashboard:', error);
    req.flash('error', 'Error loading employee dashboard: ' + error.message);
    res.redirect('/');
  }
});

// Helper function to create dummy activity log for demo purposes
// This would be replaced with real logging in a production system
function createDummyActivityLog(keywords, publications, employeeId) {
  const log = [];
  
  // Add keyword creation log entries
  keywords.forEach(keyword => {
    if (keyword.CreatedBy === employeeId) {
      log.push({
        type: 'info',
        timestamp: keyword.CreatedAt || new Date().toISOString(),
        message: `Created keyword: "${keyword[config.app.keywordColumn]}"`
      });
    }
  });
  
  // Add publication log entries
  publications.forEach(pub => {
    log.push({
      type: 'success',
      timestamp: pub['Publication Date'] || new Date().toISOString(),
      message: `Published article for: "${pub[config.app.keywordColumn]}"`
    });
  });
  
  // Sort by timestamp (newest first)
  return log.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

// Add this new route to server.js
// This route is specifically for the admin to view articles from the employee dashboard
app.get('/admin/view-article/:keyword/:userId', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const keyword = req.params.keyword;
    const userId = req.params.userId;
    
    console.log(`Admin viewing article for keyword: "${keyword}" by user ID: ${userId}`);
    
    // Load the Excel file
    const workbook = XLSX.readFile(config.app.excelFile);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    // Find the specific keyword for the specific user
    const keywordRow = data.find(row => 
      row[config.app.keywordColumn] === keyword && 
      (row.OwnerId === userId || row.CreatedBy === userId)
    );
    
    if (!keywordRow) {
      req.flash('error', `Article for keyword "${keyword}" by this employee not found`);
      return res.redirect('/admin/employee-dashboard');
    }
    
    // Try to get content from WordPress if Post ID exists
    if (keywordRow['Post ID']) {
      try {
        console.log(`Fetching content from WordPress for Post ID: ${keywordRow['Post ID']}`);
        
        // Create authentication header
        const authString = `${config.wordpress.username}:${config.wordpress.password}`;
        const encodedAuth = Buffer.from(authString).toString('base64');
        
        // Get post content from WordPress
        const response = await axios.get(`${config.wordpress.apiUrl}/posts/${keywordRow['Post ID']}`, {
          headers: {
            'Authorization': `Basic ${encodedAuth}`
          }
        });
        
        if (response.data && response.data.id) {
          console.log('Successfully retrieved content from WordPress');
          
          // Create article object
          const article = {
            title: response.data.title.rendered || 'No Title',
            content: response.data.content.rendered || 'No Content'
          };
          
          // Render the preview page
          return res.render('article-view', {
            page: 'article-view',
            keyword: keyword,
            article: article,
            employeeId: userId,
            isAdmin: true,
            error: req.flash('error'),
            success: req.flash('success')
          });
        }
      } catch (wpError) {
        console.error('Error fetching from WordPress:', wpError.message);
        // Continue to fallbacks below
      }
    }
    
    // If we couldn't get content from WordPress, show error
    req.flash('error', 'Could not retrieve article content. The post may no longer exist in WordPress.');
    return res.redirect('/admin/employee-dashboard?employeeId=' + userId);
    
  } catch (error) {
    console.error('Error viewing article:', error);
    req.flash('error', 'Error viewing article: ' + error.message);
    return res.redirect('/admin/employee-dashboard');
  }
});

async function startServer() {
  try {
    // Load configuration from file
    await loadConfig();
    
    // Continue with existing initialization
    await initializeApp();
    
    // Use PORT from environment variable (Cloudways sets this)
    const port = process.env.PORT || 4000;
    
    // Listen on all available network interfaces (0.0.0.0)
    app.listen(port, '0.0.0.0', () => {
      console.log(`WordPress Automation web app running at http://localhost:${port}`);
      console.log(`Default admin credentials: username: admin, password: admin123`);
      console.log(`Please login and change the default password immediately!`);
    });
  } catch (error) {
    console.error('ERROR STARTING SERVER:', error);
  }
}
startServer();

// Attach user to locals
app.use(attachUserToLocals);

// Track running job
let isJobRunning = false;
let jobProgress = {
  total: 0,
  current: 0,
  currentKeyword: '',
  status: '',
  log: []
};

// Helper function to log progress (simplified activity logging)
function logProgress(message) {
  const timestamp = new Date().toLocaleTimeString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
  
  // Add to the job progress log
  jobProgress.log.push(logMessage);
  
  // Keep log size reasonable
  if (jobProgress.log.length > 50) {
    jobProgress.log.shift();
  }
}

//====================================================
// USER MANAGEMENT
//====================================================

// File to store user data
const USERS_FILE = path.join(__dirname, '../data/users.json');

// Create data directory and users file if they don't exist
async function ensureUsersFileExists() {
  try {
    const dataDir = path.join(__dirname, '../data');
    
    // Create data directory if it doesn't exist
    try {
      await fs.mkdir(dataDir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    
    // Check if users file exists
    try {
      await fs.access(USERS_FILE);
    } catch (error) {
      // Create the file with default admin user
      const crypto = require('crypto');
      const adminUser = {
        id: crypto.randomBytes(16).toString('hex'),
        username: 'admin',
        // Default password: admin123
        password: crypto.createHash('sha256').update('admin123').digest('hex'),
        name: 'Administrator',
        email: 'admin@example.com',
        role: 'admin',
        createdAt: new Date().toISOString()
      };
      
      await writeFile(USERS_FILE, JSON.stringify({ users: [adminUser] }, null, 2));
      console.log('Created users file with default admin user');
    }
  } catch (error) {
    console.error('Error ensuring users file exists:', error);
    throw error;
  }
}

// Load all users
async function getAllUsers() {
  await ensureUsersFileExists();
  
  try {
    const data = await readFile(USERS_FILE, 'utf8');
    return JSON.parse(data).users;
  } catch (error) {
    console.error('Error loading users:', error);
    return [];
  }
}

// Save all users
async function saveUsers(users) {
  try {
    await writeFile(USERS_FILE, JSON.stringify({ users }, null, 2));
  } catch (error) {
    console.error('Error saving users:', error);
    throw error;
  }
}

// Hash password
function hashPassword(password) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Generate user ID
function generateId() {
  const crypto = require('crypto');
  return crypto.randomBytes(16).toString('hex');
}

// Authenticate user
async function authenticateUser(username, password) {
  const users = await getAllUsers();
  const user = users.find(user => 
    user.username === username && user.password === hashPassword(password)
  );
  
  if (!user) return null;
  
  // Return user without password
  const { password: _, ...userWithoutPassword } = user;
  return userWithoutPassword;
}

// Create user
async function createUser(userData) {
  const users = await getAllUsers();
  
  // Check if username or email already exists
  const existingUser = users.find(user => 
    user.username === userData.username || user.email === userData.email
  );
  
  if (existingUser) {
    if (existingUser.username === userData.username) {
      throw new Error('Username already exists');
    } else {
      throw new Error('Email already exists');
    }
  }
  
  // Create new user
  const newUser = {
    id: generateId(),
    username: userData.username,
    password: hashPassword(userData.password),
    name: userData.name,
    email: userData.email,
    role: userData.role || 'employee', // Default to employee if not specified
    createdAt: new Date().toISOString()
  };
  
  // Add to users array
  users.push(newUser);
  
  // Save to file
  await saveUsers(users);
  
  // Return user without password
  const { password, ...userWithoutPassword } = newUser;
  return userWithoutPassword;
}

// Update user
async function updateUser(id, userData) {
  const users = await getAllUsers();
  const index = users.findIndex(user => user.id === id);
  
  if (index === -1) {
    throw new Error('User not found');
  }
  
  // Check if username or email already exists
  if (userData.username || userData.email) {
    const existingUser = users.find(user => 
      user.id !== id && (
        (userData.username && user.username === userData.username) || 
        (userData.email && user.email === userData.email)
      )
    );
    
    if (existingUser) {
      if (userData.username && existingUser.username === userData.username) {
        throw new Error('Username already exists');
      } else {
        throw new Error('Email already exists');
      }
    }
  }
  
  // Update user data
  users[index] = {
    ...users[index],
    ...userData,
    // If password is updated, hash it
    ...(userData.password ? { password: hashPassword(userData.password) } : {})
  };
  
  // Save to file
  await saveUsers(users);
  
  // Return user without password
  const { password, ...userWithoutPassword } = users[index];
  return userWithoutPassword;
}

// Delete user
async function deleteUser(id) {
  const users = await getAllUsers();
  const index = users.findIndex(user => user.id === id);
  
  if (index === -1) {
    throw new Error('User not found');
  }
  
  // Remove user
  const deletedUser = users.splice(index, 1)[0];
  
  // Save to file
  await saveUsers(users);
  
  // Return user without password
  const { password, ...userWithoutPassword } = deletedUser;
  return userWithoutPassword;
}

//====================================================
// AUTHENTICATION ROUTES
//====================================================

// Login page
app.get('/login', (req, res) => {
  // Redirect if already logged in
  if (req.session && req.session.user) {
    return res.redirect('/');
  }
  
  res.render('login', {
    page: 'login',
    error: req.flash('error'),
    success: req.flash('success')
  });
});

// Login form submission
app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      req.flash('error', 'Please provide both username and password');
      return res.redirect('/login');
    }
    
    // Authenticate user
    const user = await authenticateUser(username, password);
    
    if (!user) {
      req.flash('error', 'Invalid username or password');
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
    req.flash('error', 'Login failed: ' + error.message);
    res.redirect('/login');
  }
});

// Logout
app.get('/logout', (req, res) => {
  // Destroy session
  req.session.destroy(err => {
    if (err) {
      console.error('Error during logout:', err);
    }
    res.redirect('/login');
  });
});

// User management page (admin only)
app.get('/users', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const users = await getAllUsers();
    
    res.render('users', {
      page: 'users',
      users,
      error: req.flash('error'),
      success: req.flash('success')
    });
  } catch (error) {
    console.error('Error loading users page:', error);
    req.flash('error', 'Failed to load users: ' + error.message);
    res.redirect('/');
  }
});

// Create user (admin only)
app.post('/users', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { username, password, name, email, role } = req.body;
    
    // Validate required fields
    if (!username || !password || !name || !email || !role) {
      req.flash('error', 'All fields are required');
      return res.redirect('/users');
    }
    
    // Create user
    await createUser({
      username,
      password,
      name,
      email,
      role
    });
    
    req.flash('success', 'User created successfully');
    res.redirect('/users');
  } catch (error) {
    console.error('Error creating user:', error);
    req.flash('error', 'Failed to create user: ' + error.message);
    res.redirect('/users');
  }
});

// Update user (admin only)
app.post('/users/:id', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, role, password } = req.body;
    
    // Validate required fields
    if (!name || !email || !role) {
      req.flash('error', 'Name, email and role are required');
      return res.redirect('/users');
    }
    
    // Update data
    const updateData = { name, email, role };
    
    // Add password if provided
    if (password) {
      updateData.password = password;
    }
    
    // Update user
    await updateUser(id, updateData);
    
    req.flash('success', 'User updated successfully');
    res.redirect('/users');
  } catch (error) {
    console.error('Error updating user:', error);
    req.flash('error', 'Failed to update user: ' + error.message);
    res.redirect('/users');
  }
});

// Delete user (admin only)
app.post('/users/:id/delete', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Don't allow deleting own account
    if (id === req.session.user.id) {
      req.flash('error', 'You cannot delete your own account');
      return res.redirect('/users');
    }
    
    // Delete user
    await deleteUser(id);
    
    req.flash('success', 'User deleted successfully');
    res.redirect('/users');
  } catch (error) {
    console.error('Error deleting user:', error);
    req.flash('error', 'Failed to delete user: ' + error.message);
    res.redirect('/users');
  }
});

// My profile page
app.get('/profile', isAuthenticated, (req, res) => {
  res.render('profile', {
    page: 'profile',
    error: req.flash('error'),
    success: req.flash('success')
  });
});

// Update profile
app.post('/profile', isAuthenticated, async (req, res) => {
  try {
    const { name, email, currentPassword, newPassword } = req.body;
    
    // Validate required fields
    if (!name || !email) {
      req.flash('error', 'Name and email are required');
      return res.redirect('/profile');
    }
    
    // Update data
    const updateData = { name, email };
    
    // If changing password, validate current password
    if (newPassword) {
      if (!currentPassword) {
        req.flash('error', 'Current password is required to set a new password');
        return res.redirect('/profile');
      }
      
      // Get all users to verify password
      const users = await getAllUsers();
      const user = users.find(u => u.id === req.session.user.id);
      
      if (!user || user.password !== hashPassword(currentPassword)) {
        req.flash('error', 'Current password is incorrect');
        return res.redirect('/profile');
      }
      
      // Password is correct, update it
      updateData.password = newPassword;
    }
    
    // Update user
    const updatedUser = await updateUser(req.session.user.id, updateData);
    
    // Update session
    req.session.user = updatedUser;
    
    req.flash('success', 'Profile updated successfully');
    res.redirect('/profile');
  } catch (error) {
    console.error('Error updating profile:', error);
    req.flash('error', 'Failed to update profile: ' + error.message);
    res.redirect('/profile');
  }
});

//====================================================
// UPDATED PAGE ROUTES WITH ACCESS CONTROL
//====================================================

// Home page route - Requires authentication and filters data for employees
app.get('/', isAuthenticated, isResourceOwner, async (req, res) => {
  // Check if the configuration is valid
  const configValid = validateConfig();
  
  // Check connection to WordPress only if config is valid
  let wpConnectionStatus = false;
  if (configValid) {
    try {
      wpConnectionStatus = await testWordPressConnection(config.wordpress);
    } catch (error) {
      console.error('Error testing WordPress connection:', error.message);
    }
  }
  
  // Check if keywords file exists
  const excelFileExists = await fileExists(config.app.excelFile);
  
  // For regular employees, only pass their own job progress data
  let filteredJobProgress = jobProgress;
  
  if (req.session.user.role === 'employee' && req.ownerId) {
    // If we're going to track job progress per user in the future,
    // we would filter the job progress here based on req.ownerId
  }
  
  res.render('index', {
    page: 'home',
    configValid,
    wpConnectionStatus,
    excelFileExists,
    isJobRunning,
    jobProgress: filteredJobProgress,
    config,
    error: req.flash('error'),
    success: req.flash('success')
  });
});

// Keywords page route - Requires authentication with resource ownership check
app.get('/keywords', isAuthenticated, isResourceOwner, async (req, res) => {
  let keywords = [];
  let error = null;
  
  // Check if Excel file exists and load keywords
  const excelFileExists = await fileExists(config.app.excelFile);
  
  if (excelFileExists) {
    try {
      const allKeywords = readKeywordsFromExcel(config.app.excelFile, config.app.keywordColumn);
      
      // For employees, filter keywords to only show their own
      if (req.session.user.role === 'employee' && req.ownerId) {
        // Filter keywords based on user ID
        // This requires adding a "CreatedBy" or "OwnerId" column to the Excel file
        keywords = allKeywords.filter(keyword => {
          // If the keyword has a "CreatedBy" field and it matches the user ID, include it
          // Otherwise, don't include it for employees
          return keyword.CreatedBy === req.ownerId || keyword.OwnerId === req.ownerId;
        });
      } else {
        // For admins, show all keywords
        keywords = allKeywords;
      }
    } catch (err) {
      error = `Error reading Excel file: ${err.message}`;
    }
  } else {
    error = `Excel file not found at: ${config.app.excelFile}`;
  }
  
  res.render('keywords', {
    page: 'keywords',
    keywords,
    error: error || req.flash('error'),
    success: req.flash('success'),
    excelFile: config.app.excelFile,
    keywordColumn: config.app.keywordColumn
  });
});

// History page route - Requires authentication with resource ownership check
app.get('/history', isAuthenticated, isResourceOwner, async (req, res) => {
  let publications = [];
  let error = null;
  
  // Read all data from Excel including published articles
  const excelFileExists = await fileExists(config.app.excelFile);
  
  if (excelFileExists) {
    try {
      const workbook = XLSX.readFile(config.app.excelFile);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet);
      
      // Filter published articles
      let allPublications = data.filter(row => row.Status === 'Published');
      
      // Filter publications for employees to only show their own
      if (req.session.user.role === 'employee' && req.ownerId) {
        // Only show publications created by this employee
        publications = allPublications.filter(pub => {
          return pub.CreatedBy === req.ownerId || pub.OwnerId === req.ownerId;
        });
      } else {
        // For admins, show all publications
        publications = allPublications;
      }
      
      // Make sure the keyword column is accessible as 'Keyword'
      publications = publications.map(row => {
        // If the keyword column name is different from 'Keyword', create an alias
        if (config.app.keywordColumn !== 'Keyword' && row[config.app.keywordColumn]) {
          row['Keyword'] = row[config.app.keywordColumn];
        }
        return row;
      });
      
      // Set error to null explicitly
      error = null;
    } catch (err) {
      error = `Error reading Excel file: ${err.message}`;
    }
  } else {
    error = `Excel file not found at: ${config.app.excelFile}`;
  }
  
  res.render('history', {
    page: 'history',
    publications: publications || [],
    error: typeof error === 'string' ? error : null,
    success: req.flash('success'),
    config // Pass config to the view to access keywordColumn
  });
});

// Settings page route - Requires admin
app.get('/settings', isAuthenticated, isAdmin, async (req, res) => {
  res.render('settings', {
    page: 'settings',
    config,
    error: req.flash('error'),
    success: req.flash('success')
  });
});

// Prompt settings page route - Requires authentication
app.get('/prompt-settings', isAuthenticated, (req, res) => {
  try {
    // Make sure config.prompts exists
    if (!config.prompts) {
      config.prompts = {
        useMultiPartGeneration: false,
        mainPrompt: config.app.contentTemplate || "",
        part1Prompt: "",
        part2Prompt: "",
        part3Prompt: "",
        toneVoice: "",
        seoGuidelines: "",
        thingsToAvoid: ""
      };
    }
    
    res.render('prompt-settings', {
      page: 'prompt-settings',
      config: config,
      error: req.flash('error'),
      success: req.flash('success')
    });
  } catch (error) {
    console.error('Error rendering prompt settings page:', error);
    req.flash('error', 'Error loading prompt settings: ' + error.message);
    res.redirect('/');
  }
});

// Route to handle the article preview page - Requires authentication
app.get('/preview/:keyword', isAuthenticated, async (req, res) => {
  try {
    const keyword = req.params.keyword;
    console.log(`Preview requested for keyword: "${keyword}"`);
    
    // Load the Excel file
    const workbook = XLSX.readFile(config.app.excelFile);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    // Find all rows with this keyword (may be owned by different users)
    const keywordRows = data.filter(row => row[config.app.keywordColumn] === keyword);
    
    if (keywordRows.length === 0) {
      console.log(`Keyword "${keyword}" not found in Excel file`);
      req.flash('error', `Keyword "${keyword}" not found in Excel file`);
      return res.redirect('/keywords');
    }
    
    let keywordRow = null;
    
    // For employees, find their own keyword
    if (req.session.user.role === 'employee') {
      keywordRow = keywordRows.find(row => 
        row.OwnerId === req.session.user.id || row.CreatedBy === req.session.user.id
      );
      
      if (!keywordRow) {
        req.flash('error', 'You do not have permission to view this keyword');
        return res.redirect('/keywords');
      }
    } else {
      // For admins, just use the first match (or could add a user parameter to select which employee's version)
      keywordRow = keywordRows[0];
    }
    
    // Check if a cached article exists for this keyword in session
    if (req.app.locals.cachedArticles && req.app.locals.cachedArticles[keyword]) {
      // Render preview with cached article
      return res.render('preview', {
        page: 'preview',
        keyword: keyword,
        article: req.app.locals.cachedArticles[keyword],
        error: req.flash('error'),
        success: req.flash('success')
      });
    }
    
    // Try to get content from WordPress if Post ID exists
    if (keywordRow['Post ID']) {
      try {
        console.log(`Fetching content from WordPress for Post ID: ${keywordRow['Post ID']}`);
        
        // Create authentication header
        const authString = `${config.wordpress.username}:${config.wordpress.password}`;
        const encodedAuth = Buffer.from(authString).toString('base64');
        
        // Get post content from WordPress
        const response = await axios.get(`${config.wordpress.apiUrl}/posts/${keywordRow['Post ID']}`, {
          headers: {
            'Authorization': `Basic ${encodedAuth}`
          }
        });
        
        if (response.data && response.data.id) {
          console.log('Successfully retrieved content from WordPress');
          // Cache the article
          if (!req.app.locals.cachedArticles) {
            req.app.locals.cachedArticles = {};
          }
          req.app.locals.cachedArticles[keyword] = {
            title: response.data.title.rendered || 'No Title',
            content: response.data.content.rendered || 'No Content'
          };
          
          // Render preview with WordPress article
          return res.render('preview', {
            page: 'preview',
            keyword: keyword,
            article: req.app.locals.cachedArticles[keyword],
            error: req.flash('error'),
            success: req.flash('success')
          });
        }
      } catch (wpError) {
        console.error('Error fetching from WordPress:', wpError.message);
        // Continue to generate a new preview
      }
    }
    
    // If no cached article or WordPress content, generate one
    // Initialize app.locals.cachedArticles if it doesn't exist
    if (!req.app.locals.cachedArticles) {
      req.app.locals.cachedArticles = {};
    }
    
    // Show generation is not yet started
    return res.redirect(`/generate-preview/${encodeURIComponent(keyword)}`);
    
  } catch (error) {
    console.error('Error rendering preview page:', error);
    req.flash('error', 'Error rendering preview page: ' + error.message);
    return res.redirect('/keywords');
  }
});

// Route to generate content for preview - Requires authentication
app.get('/generate-preview/:keyword', isAuthenticated, async (req, res) => {
  try {
    const keyword = req.params.keyword;
    console.log(`Generating preview for keyword: "${keyword}"`);
    
    // Render a loading page that will trigger content generation
    res.render('generate', {
      page: 'generate',
      keyword: keyword,
      error: req.flash('error'),
      success: req.flash('success')
    });
  } catch (error) {
    console.error('Error rendering generation page:', error);
    req.flash('error', 'Error rendering generation page: ' + error.message);
    res.redirect('/keywords');
  }
});

//====================================================
// UPDATED API ROUTES WITH OWNERSHIP CHECKS
//====================================================

// API endpoint to test WordPress connection with provided credentials - Admin only
app.post('/api/test-connection', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { apiUrl, username, password } = req.body;
    
    if (!apiUrl || !username || !password) {
      return res.status(400).json({ success: false, error: 'Missing required parameters' });
    }
    
    // Create authentication header
    const authString = `${username}:${password}`;
    const encodedAuth = Buffer.from(authString).toString('base64');
    
    // Try to get current user info
    const response = await axios.get(`${apiUrl}/users/me`, {
      headers: {
        'Authorization': `Basic ${encodedAuth}`
      }
    });
    
    // Check if response contains user data
    if (response.data && response.data.id) {
      res.json({
        success: true,
        user: response.data
      });
    } else {
      res.json({
        success: false, 
        error: 'Connection successful but user data is incomplete or missing'
      });
    }
  } catch (error) {
    let errorMessage = 'Connection failed';
    
    if (error.response) {
      errorMessage = `Connection failed: ${error.response.status} - ${error.response.statusText}`;
      if (error.response.data && error.response.data.message) {
        errorMessage += ` (${error.response.data.message})`;
      }
    } else if (error.message) {
      errorMessage = `Connection failed: ${error.message}`;
    }
    
    res.json({
      success: false,
      error: errorMessage
    });
  }
});

// API endpoint to test OpenAI API connection - Admin only
app.post('/api/test-openai', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { apiKey, model } = req.body;
    
    if (!apiKey) {
      return res.status(400).json({ success: false, error: 'API key is required' });
    }
    
    // Initialize OpenAI client with the provided API key
    const { OpenAI } = require('openai');
    const openai = new OpenAI({
      apiKey: apiKey,
    });
    
    // Test the API with a simple completion
    const testModel = model || 'gpt-3.5-turbo';
    const response = await openai.chat.completions.create({
      model: testModel,
      messages: [
        { role: "system", content: "You are a test assistant." },
        { role: "user", content: "Return only the text 'OpenAI API connection successful' if you receive this message." }
      ],
      max_tokens: 20,
      temperature: 0,
    });
    
    // Check if we got a valid response
    if (response && response.choices && response.choices.length > 0) {
      const content = response.choices[0].message.content.trim();
      
      // Return success response with model information
      res.json({
        success: true,
        model: testModel,
        message: 'OpenAI API connection successful',
        response: content
      });
    } else {
      res.json({
        success: false,
        error: 'Received an empty or invalid response from OpenAI'
      });
    }
  } catch (error) {
    // Format the error message
    let errorMessage = 'OpenAI API connection failed';
    
    if (error.response) {
      // API returned an error
      const status = error.response.status;
      const data = error.response.data;
      
      if (status === 401) {
        errorMessage = 'Authentication error: Invalid API key';
      } else if (status === 429) {
        errorMessage = 'Rate limit exceeded or insufficient quota';
      } else if (data && data.error) {
        errorMessage = `Error: ${data.error.message || data.error.type}`;
      } else {
        errorMessage = `Error ${status}: ${error.message}`;
      }
    } else if (error.message) {
      errorMessage = `Connection failed: ${error.message}`;
    }
    
    res.json({
      success: false,
      error: errorMessage
    });
  }
});

// API endpoint to save settings - Admin only
// Add this to your server.js file, replacing the existing /api/save-settings endpoint
app.post('/api/save-settings', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { wordpress, openai, app } = req.body;
    
    // Validate required fields
    if (!wordpress || !openai || !app) {
      return res.status(400).json({ success: false, error: 'Missing required settings' });
    }
    
    // Update the config object
    config.wordpress = {
      apiUrl: wordpress.apiUrl,
      username: wordpress.username,
      password: wordpress.password
    };
    
    config.openai = {
      apiKey: openai.apiKey,
      model: openai.model,
      temperature: parseFloat(openai.temperature),
      maxTokens: parseInt(openai.maxTokens)
    };
    
    config.app = {
      ...config.app,
      excelFile: app.excelFile,
      keywordColumn: app.keywordColumn,
      minWords: parseInt(app.minWords),
      publishStatus: app.publishStatus,
      delayBetweenPosts: parseInt(app.delayBetweenPosts),
      contentTemplate: app.contentTemplate
    };
    
    // Save configuration to file
    const saved = await saveConfig(config);
    
    if (!saved) {
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to save configuration to file' 
      });
    }
    
    req.flash('success', 'Settings saved successfully');
    res.json({ success: true, message: 'Settings saved successfully' });
  } catch (error) {
    console.error('Error saving settings:', error);
    res.status(500).json({ success: false, error: `Failed to save settings: ${error.message}` });
  }
});

// API endpoint to save prompt settings - Requires authentication
app.post('/api/save-prompt-settings', isAuthenticated, async (req, res) => {
  try {
    const promptSettings = req.body;
    
    // Update config object in memory
    if (!config.prompts) config.prompts = {};
    config.prompts.useMultiPartGeneration = promptSettings.useMultiPartGeneration;
    config.prompts.mainPrompt = promptSettings.mainPrompt;
    config.prompts.part1Prompt = promptSettings.part1Prompt;
    config.prompts.part2Prompt = promptSettings.part2Prompt;
    config.prompts.part3Prompt = promptSettings.part3Prompt;
    config.prompts.toneVoice = promptSettings.toneVoice;
    config.prompts.seoGuidelines = promptSettings.seoGuidelines;
    config.prompts.thingsToAvoid = promptSettings.thingsToAvoid;
    
    // Add new article format settings
    config.prompts.articleFormat = promptSettings.articleFormat;
    config.prompts.useArticleFormat = promptSettings.useArticleFormat;
    
    // Try to update .env file if possible
    try {
      const envPath = path.join(__dirname, '../.env');
      let envContent = await readFile(envPath);
      
      // Helper function to update environment variables
      function updateEnvVariable(content, key, value) {
        // Escape special characters in value
        const escapedValue = value
          ? value
              .replace(/\\/g, '\\\\')
              .replace(/"/g, '\\"')
              .replace(/\n/g, '\\n')
          : '';
        
        // Check if the variable already exists
        const regex = new RegExp(`^${key}=.*`, 'm');
        
        if (regex.test(content)) {
          // Update existing variable
          return content.replace(regex, `${key}="${escapedValue}"`);
        } else {
          // Add new variable at the end
          return `${content}\n${key}="${escapedValue}"`;
        }
      }
      
      // Update or add each setting
      envContent = updateEnvVariable(envContent, 'USE_MULTI_PART_GENERATION', promptSettings.useMultiPartGeneration.toString());
      envContent = updateEnvVariable(envContent, 'MAIN_PROMPT', promptSettings.mainPrompt);
      envContent = updateEnvVariable(envContent, 'PART1_PROMPT', promptSettings.part1Prompt);
      envContent = updateEnvVariable(envContent, 'PART2_PROMPT', promptSettings.part2Prompt);
      envContent = updateEnvVariable(envContent, 'PART3_PROMPT', promptSettings.part3Prompt);
      envContent = updateEnvVariable(envContent, 'TONE_VOICE', promptSettings.toneVoice);
      envContent = updateEnvVariable(envContent, 'SEO_GUIDELINES', promptSettings.seoGuidelines);
      envContent = updateEnvVariable(envContent, 'THINGS_TO_AVOID', promptSettings.thingsToAvoid);
      
      // Add new article format settings
      envContent = updateEnvVariable(envContent, 'ARTICLE_FORMAT', promptSettings.articleFormat);
      envContent = updateEnvVariable(envContent, 'USE_ARTICLE_FORMAT', promptSettings.useArticleFormat.toString());
      
      // Write updated content back to .env file
      await writeFile(envPath, envContent);
      
      console.log("Successfully updated .env file with prompt settings");
    } catch (envError) {
      console.warn("Unable to update .env file, but settings are stored in memory:", envError.message);
      // Continue without failing - settings are still in memory
    }
    
    // Success response
    req.flash('success', 'Prompt settings saved successfully');
    res.json({ success: true, message: 'Prompt settings saved successfully' });
  } catch (error) {
    console.error('Error saving prompt settings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API endpoint to test prompt generation - Requires authentication
app.post('/api/test-prompt-generation', isAuthenticated, async (req, res) => {
  try {
    const { keyword, promptSettings } = req.body;
    
    if (!keyword) {
      return res.status(400).json({ success: false, error: 'Keyword is required' });
    }
    
    // Use a lower word count for testing
    const testWordCount = 200;
    
    // Set up temporary OpenAI config with reduced tokens for faster testing
    const testOpenAIConfig = {
      ...config.openai,
      maxTokens: 500,  // Reduced tokens for faster response
    };
    
    // Generate sample content
    const article = await generateArticleContent(
      testOpenAIConfig,
      keyword,
      testWordCount,
      promptSettings
    );
    
    res.json({
      success: true,
      article: {
        title: article.title,
        content: article.content,
        wordCount: article.wordCount
      }
    });
  } catch (error) {
    console.error('Error testing prompt generation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API endpoint to start the automation - Requires employee privileges
app.post('/api/start-job', isAuthenticated, isEmployee, async (req, res) => {
  if (isJobRunning) {
    return res.status(400).json({ error: 'A job is already running' });
  }
  
  // Validate configuration
  if (!validateConfig()) {
    return res.status(400).json({ error: 'Invalid configuration. Check your .env file.' });
  }
  
  // Start the job
  isJobRunning = true;
  jobProgress = {
    total: 0,
    current: 0,
    currentKeyword: '',
    status: 'Starting...',
    log: [],
    userId: req.session.user.id // Track which user started the job
  };
  
  logProgress('Starting WordPress automation job');
  
  // For employees, only run automation on their own keywords
  let keywordFilter = null;
  if (req.session.user.role === 'employee') {
    keywordFilter = (row) => row.OwnerId === req.session.user.id || row.CreatedBy === req.session.user.id;
  }
  
  // Run the automation in the background
  runAutomation(keywordFilter)
    .then(() => {
      isJobRunning = false;
      jobProgress.status = 'Completed';
      logProgress('Job completed successfully!');
    })
    .catch(error => {
      isJobRunning = false;
      jobProgress.status = 'Failed';
      logProgress(`Job failed: ${error.message}`);
    });
  
  // Return success response
  res.json({ success: true, message: 'Job started successfully' });
});

// Updated API endpoint to process a single keyword - With ownership check
app.post('/api/process-single-keyword', isAuthenticated, isEmployee, async (req, res) => {
  try {
    if (isJobRunning) {
      return res.status(400).json({ error: 'A job is already running' });
    }
    
    const { keyword } = req.body;
    
    if (!keyword) {
      return res.status(400).json({ error: 'Keyword is required' });
    }
    
    // Validate configuration
    if (!validateConfig()) {
      return res.status(400).json({ error: 'Invalid configuration. Check your .env file.' });
    }
    
    // Try to find the keyword in the Excel file
    try {
      const keywordRows = readKeywordsFromExcel(config.app.excelFile, config.app.keywordColumn);
      const keywordRow = keywordRows.find(row => row[config.app.keywordColumn] === keyword);
      
      if (!keywordRow) {
        return res.status(404).json({ error: 'Keyword not found in Excel file' });
      }
      
      // Check ownership for employees
      if (req.session.user.role === 'employee') {
        if (keywordRow.OwnerId && keywordRow.OwnerId !== req.session.user.id && 
            keywordRow.CreatedBy && keywordRow.CreatedBy !== req.session.user.id) {
          return res.status(403).json({ 
            error: 'You do not have permission to process this keyword' 
          });
        }
      }
      
      // Check if keyword is already published
      if (keywordRow.Status === 'Published') {
        return res.status(400).json({ error: 'This keyword has already been published' });
      }
      
      // Start the job
      isJobRunning = true;
      jobProgress = {
        total: 1,
        current: 0,
        currentKeyword: keyword,
        status: 'Starting...',
        log: [],
        userId: req.session.user.id // Track which user started the job
      };
      
      logProgress(`Starting to process single keyword: "${keyword}"`);
      
      // Process the single keyword (non-blocking)
      processSingleKeyword(keywordRow)
        .then(() => {
          isJobRunning = false;
          jobProgress.status = 'Completed';
          logProgress(`Single keyword processed successfully!`);
        })
        .catch(error => {
          isJobRunning = false;
          jobProgress.status = 'Failed';
          logProgress(`Processing failed: ${error.message}`);
        });
      
      // Return success response
      return res.json({ success: true, message: 'Started processing keyword' });
      
    } catch (error) {
      console.error('Error processing keyword request:', error);
      return res.status(500).json({ error: `Failed to process keyword: ${error.message}` });
    }
  } catch (error) {
    console.error('Unexpected error in process-single-keyword endpoint:', error);
    return res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// API endpoint to get job status - Requires authentication
app.get('/api/job-status', isAuthenticated, (req, res) => {
  // For employees, only return job status for jobs they started
  if (req.session.user.role === 'employee' &&
      jobProgress.userId && 
      jobProgress.userId !== req.session.user.id) {
    // Return empty job status for jobs started by other users
    return res.json({
      isRunning: false,
      progress: {
        total: 0,
        current: 0,
        currentKeyword: '',
        status: 'No job running',
        log: []
      }
    });
  }
  
  // Return full job status for admins or for the user who started the job
  res.json({
    isRunning: isJobRunning,
    progress: jobProgress
  });
});

// Endpoint to add a new keyword - Allow duplicates across different employees
app.post('/api/add-keyword', isAuthenticated, isEmployee, async (req, res) => {
  const { keyword } = req.body;
  
  if (!keyword) {
    return res.status(400).json({ success: false, error: 'Keyword is required' });
  }
  
  try {
    // Load the Excel file
    const workbook = XLSX.readFile(config.app.excelFile);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    // Check if keyword already exists FOR THIS USER ONLY
    // This allows different employees to have the same keyword
    const existsForUser = data.some(row => 
      row[config.app.keywordColumn] === keyword && 
      (row.OwnerId === req.session.user.id || row.CreatedBy === req.session.user.id)
    );
    
    if (existsForUser) {
      return res.status(400).json({ 
        success: false, 
        error: 'You already have this keyword in your list' 
      });
    }
    
    // Add the new keyword with ownership information
    const newRow = {
      [config.app.keywordColumn]: keyword,
      Status: 'Pending',
      'Publication Date': '',
      'Post URL': '',
      'Post ID': '',
      // Add ownership information
      OwnerId: req.session.user.id,
      CreatedBy: req.session.user.id,
      CreatedAt: new Date().toISOString() // Add creation timestamp for activity tracking
    };
    
    data.push(newRow);
    
    // Write back to the Excel file
    const newWorksheet = XLSX.utils.json_to_sheet(data);
    workbook.Sheets[sheetName] = newWorksheet;
    XLSX.writeFile(workbook, config.app.excelFile);
    
    // Log this activity (in a production system, you would use a proper logging system)
    console.log(`User ${req.session.user.username} (${req.session.user.id}) added keyword: ${keyword}`);
    
    res.json({ success: true, message: 'Keyword added successfully' });
  } catch (error) {
    console.error('Error adding keyword:', error);
    res.status(500).json({ success: false, error: `Failed to add keyword: ${error.message}` });
  }
});

// API endpoint to delete a keyword - With ownership check
app.post('/api/delete-keyword', isAuthenticated, isEmployee, async (req, res) => {
  const { keyword } = req.body;
  
  if (!keyword) {
    return res.status(400).json({ success: false, error: 'Keyword is required' });
  }
  
  try {
    // Load the Excel file
    const workbook = XLSX.readFile(config.app.excelFile);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    // Find the keyword entry
    const keywordIndex = data.findIndex(row => row[config.app.keywordColumn] === keyword);
    
    if (keywordIndex === -1) {
      return res.status(404).json({ success: false, error: 'Keyword not found' });
    }
    
    // Check ownership if user is an employee (not admin)
    if (req.session.user.role === 'employee') {
      const keywordRow = data[keywordIndex];
      
      // If the keyword doesn't belong to this user, deny access
      if (keywordRow.OwnerId && keywordRow.OwnerId !== req.session.user.id &&
          keywordRow.CreatedBy && keywordRow.CreatedBy !== req.session.user.id) {
        return res.status(403).json({ 
          success: false, 
          error: 'You do not have permission to delete this keyword' 
        });
      }
    }
    
    // Remove the keyword
    data.splice(keywordIndex, 1);
    
    // Write back to the Excel file
    const newWorksheet = XLSX.utils.json_to_sheet(data);
    workbook.Sheets[sheetName] = newWorksheet;
    XLSX.writeFile(workbook, config.app.excelFile);
    
    res.json({ success: true, message: 'Keyword deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: `Failed to delete keyword: ${error.message}` });
  }
});

// Upload a new Excel file - Requires admin privileges
app.post('/api/upload-excel', isAuthenticated, isAdmin, upload.single('excelFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded' });
  }
  
  try {
    // Move the uploaded file to the correct location
    await fs.rename(req.file.path, config.app.excelFile);
    
    // Initialize ownership for all keywords in the file
    try {
      // Get admin user ID
      const users = await getAllUsers();
      const adminUser = users.find(user => user.role === 'admin');
      
      if (adminUser) {
        // Load the Excel file
        const workbook = XLSX.readFile(config.app.excelFile);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet);
        
        let updated = false;
        
        // Check each row for ownership information
        for (let i = 0; i < data.length; i++) {
          // If no ownership info, add it with admin as default owner
          if (!data[i].OwnerId || !data[i].CreatedBy) {
            data[i].OwnerId = adminUser.id;
            data[i].CreatedBy = adminUser.id;
            updated = true;
          }
        }
        
        // If any rows were updated, write back to the Excel file
        if (updated) {
          const newWorksheet = XLSX.utils.json_to_sheet(data);
          workbook.Sheets[sheetName] = newWorksheet;
          XLSX.writeFile(workbook, config.app.excelFile);
          console.log('Initialized ownership information for all keywords in the uploaded file');
        }
      }
    } catch (initError) {
      console.warn('Error initializing ownership for uploaded file:', initError);
      // Continue without failing - file was still uploaded
    }
    
    res.json({ success: true, message: 'Excel file uploaded successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: `Failed to upload file: ${error.message}` });
  }
});

// API endpoint to get keyword statistics for the dashboard - Requires authentication
app.get('/api/keyword-stats', isAuthenticated, async (req, res) => {
  try {
    // Check if Excel file exists
    const excelFileExists = await fileExists(config.app.excelFile);
    
    if (!excelFileExists) {
      return res.json({
        total: 0,
        published: 0,
        pending: 0
      });
    }
    
    // Load the Excel file
    const workbook = XLSX.readFile(config.app.excelFile);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    // For employees, filter to only their keywords
    let filteredData = data;
    if (req.session.user.role === 'employee') {
      filteredData = data.filter(row => 
        row.OwnerId === req.session.user.id || row.CreatedBy === req.session.user.id
      );
    }
    
    // Calculate stats
    const total = filteredData.length;
    const published = filteredData.filter(row => row.Status === 'Published').length;
    const pending = filteredData.filter(row => row.Status === 'Pending' || row.Status === undefined || row.Status === '').length;
    
    // Return stats as JSON
    res.json({
      total,
      published,
      pending
    });
  } catch (error) {
    console.error('Error getting keyword stats:', error);
    res.status(500).json({
      error: `Failed to get keyword stats: ${error.message}`,
      total: 0,
      published: 0,
      pending: 0
    });
  }
});

// Updated API endpoint to generate content - With better error handling
app.post('/api/generate-content', isAuthenticated, isEmployee, async (req, res) => {
  try {
    const { keyword } = req.body;
    
    if (!keyword) {
      return res.status(400).json({ success: false, error: 'Keyword is required' });
    }
    
    console.log(`Generating content for keyword: "${keyword}" by user ${req.session.user.username}`);
    
    // Load the Excel file
    const workbook = XLSX.readFile(config.app.excelFile);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    // Find keyword rows that match this keyword
    const keywordRows = data.filter(row => row[config.app.keywordColumn] === keyword);
    
    // Check if keyword exists for this user
    let keywordRow = null;
    
    if (req.session.user.role === 'employee') {
      // For employees, find their own keyword
      keywordRow = keywordRows.find(row => 
        row.OwnerId === req.session.user.id || row.CreatedBy === req.session.user.id
      );
    } else {
      // For admins, use the first matching keyword
      keywordRow = keywordRows[0];
    }
    
    if (!keywordRow) {
      // If keyword doesn't exist for this user, create it on-the-fly
      console.log(`Keyword "${keyword}" not found for user. Creating it automatically.`);
      
      // Create a new row with ownership
      const newRow = {
        [config.app.keywordColumn]: keyword,
        Status: 'Pending',
        'Publication Date': '',
        'Post URL': '',
        'Post ID': '',
        OwnerId: req.session.user.id,
        CreatedBy: req.session.user.id,
        CreatedAt: new Date().toISOString()
      };
      
      // Add the new row
      data.push(newRow);
      
      // Write back to the Excel file
      const newWorksheet = XLSX.utils.json_to_sheet(data);
      workbook.Sheets[sheetName] = newWorksheet;
      XLSX.writeFile(workbook, config.app.excelFile);
      
      // Use the new row as our keyword row
      keywordRow = newRow;
      
      console.log(`Created keyword "${keyword}" for user ${req.session.user.username}`);
    }
    
    // Check if we should use prompts settings
    let promptSettings = null;
    
    if (config.prompts) {
      promptSettings = {
        useMultiPartGeneration: config.prompts.useMultiPartGeneration,
        mainPrompt: config.prompts.mainPrompt || config.app.contentTemplate,
        part1Prompt: config.prompts.part1Prompt,
        part2Prompt: config.prompts.part2Prompt,
        part3Prompt: config.prompts.part3Prompt,
        toneVoice: config.prompts.toneVoice,
        seoGuidelines: config.prompts.seoGuidelines,
        thingsToAvoid: config.prompts.thingsToAvoid
      };
    } else if (config.app.contentTemplate) {
      // Fallback to just using content template
      promptSettings = config.app.contentTemplate;
    }
    
    // Generate article
    console.log(`Starting content generation for "${keyword}"`);
    const article = await generateArticleContent(
      config.openai, 
      keyword, 
      config.app.minWords,
      promptSettings
    );
    console.log(`Successfully generated content for "${keyword}"`);
    
    // Cache the article
    if (!req.app.locals.cachedArticles) {
      req.app.locals.cachedArticles = {};
    }
    req.app.locals.cachedArticles[keyword] = article;
    
    // Return success
    res.json({
      success: true,
      article,
      redirect: `/preview/${encodeURIComponent(keyword)}`
    });
  } catch (error) {
    console.error(`Error generating content for "${req.body.keyword}":`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Updated API endpoint to regenerate content - With ownership check
app.post('/api/regenerate-content', isAuthenticated, isEmployee, async (req, res) => {
  try {
    const { keyword } = req.body;
    
    if (!keyword) {
      return res.status(400).json({ success: false, error: 'Keyword is required' });
    }
    
    // Check ownership for employees
    if (req.session.user.role === 'employee') {
      // Load the Excel file to check ownership
      const workbook = XLSX.readFile(config.app.excelFile);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet);
      
      // Find the keyword
      const keywordRow = data.find(row => row[config.app.keywordColumn] === keyword);
      
      if (keywordRow) {
        // Check if the user owns this keyword
        if (keywordRow.OwnerId && keywordRow.OwnerId !== req.session.user.id &&
            keywordRow.CreatedBy && keywordRow.CreatedBy !== req.session.user.id) {
          return res.status(403).json({
            success: false,
            error: 'You do not have permission to regenerate content for this keyword'
          });
        }
      }
    }
    
    // Check if we should use prompts settings
    let promptSettings = null;
    
    if (config.prompts) {
      promptSettings = {
        useMultiPartGeneration: config.prompts.useMultiPartGeneration,
        mainPrompt: config.prompts.mainPrompt || config.app.contentTemplate,
        part1Prompt: config.prompts.part1Prompt,
        part2Prompt: config.prompts.part2Prompt,
        part3Prompt: config.prompts.part3Prompt,
        toneVoice: config.prompts.toneVoice,
        seoGuidelines: config.prompts.seoGuidelines,
        thingsToAvoid: config.prompts.thingsToAvoid
      };
    } else if (config.app.contentTemplate) {
      // Fallback to just using content template
      promptSettings = config.app.contentTemplate;
    }
    
    // Generate article
    const article = await generateArticleContent(
      config.openai, 
      keyword, 
      config.app.minWords,
      promptSettings
    );
    
    // Cache the article
    if (!req.app.locals.cachedArticles) {
      req.app.locals.cachedArticles = {};
    }
    req.app.locals.cachedArticles[keyword] = article;
    
    // Return success with the article data
    res.json({
      success: true,
      article
    });
  } catch (error) {
    console.error('Error regenerating content:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API endpoint to publish content - With ownership check
app.post('/api/publish-content', isAuthenticated, isEmployee, async (req, res) => {
  try {
    const { keyword, title, content, status } = req.body;
    
    if (!keyword || !title || !content) {
      return res.status(400).json({ success: false, error: 'Keyword, title, and content are required' });
    }
    
    // Check if the keyword exists in Excel
    const keywordRows = readKeywordsFromExcel(config.app.excelFile, config.app.keywordColumn);
    const keywordRow = keywordRows.find(row => row[config.app.keywordColumn] === keyword);
    
    if (!keywordRow) {
      return res.status(404).json({ success: false, error: 'Keyword not found in Excel file' });
    }
    
    // Check ownership for employees
    if (req.session.user.role === 'employee') {
      if (keywordRow.OwnerId && keywordRow.OwnerId !== req.session.user.id &&
          keywordRow.CreatedBy && keywordRow.CreatedBy !== req.session.user.id) {
        return res.status(403).json({
          success: false,
          error: 'You do not have permission to publish content for this keyword'
        });
      }
    }
    
    // Create article object with validated content
    const article = {
      title: String(title),
      content: String(content),
      wordCount: String(content).split(/\s+/).filter(word => word.length > 0).length
    };
    
    console.log(`Publishing article: "${article.title}" for keyword "${keyword}"`);
    console.log(`Content length: ${article.content.length} characters`);
    
    try {
      // Publish to WordPress
      const publishData = await publishToWordPress(
        config.wordpress,
        article,
        keyword,
        status || 'draft'
      );
      
      // Update Excel with publication status
      updateExcelWithPublicationStatus(config.app.excelFile, keywordRow, publishData);
      
      // Remove from cache
      if (req.app.locals.cachedArticles && req.app.locals.cachedArticles[keyword]) {
        delete req.app.locals.cachedArticles[keyword];
      }
      
      // Return success
      res.json({
        success: true,
        publishData,
        message: `Article ${status === 'publish' ? 'published' : 'saved as draft'} successfully`
      });
    } catch (publishError) {
      console.error('Error in publishing process:', publishError);
      return res.status(500).json({ 
        success: false, 
        error: `Failed to save article: ${publishError.message}` 
      });
    }
  } catch (error) {
    console.error('Error publishing content:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});