// src/wordpress.js
//
// This module handles WordPress API interactions without using axios

const https = require('https');
const url = require('url');

/**
 * Test the WordPress API connection
 * @param {Object} wpConfig - WordPress configuration
 * @returns {boolean} True if connection successful
 */
async function testWordPressConnection(wpConfig) {
  try {
    console.log(`Testing WordPress API connection to ${wpConfig.apiUrl}...`);
    
    // Test authentication
    await testAuthentication(wpConfig);
    console.log('✓ Authentication successful');
    
    return true;
  } catch (error) {
    console.error('✗ WordPress connection test failed:', error.message);
    return false;
  }
}

/**
 * Test WordPress authentication using native https
 * @param {Object} wpConfig - WordPress configuration
 */
async function testAuthentication(wpConfig) {
  return new Promise((resolve, reject) => {
    try {
      // Parse the API URL
      const parsedUrl = url.parse(wpConfig.apiUrl);
      
      // Create authentication header
      const authString = `${wpConfig.username}:${wpConfig.password}`;
      const encodedAuth = Buffer.from(authString).toString('base64');
      
      // Set up request options
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: `${parsedUrl.pathname}/users/me`,
        method: 'GET',
        headers: {
          'Authorization': `Basic ${encodedAuth}`,
          'Content-Type': 'application/json'
        },
        rejectUnauthorized: false // Allow self-signed certificates
      };
      
      console.log(`Testing authentication to ${options.hostname}${options.path}`);
      
      // Make the request
      const req = https.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              const responseData = JSON.parse(data);
              console.log(`Logged in as: ${responseData.name || 'User'} (ID: ${responseData.id})`);
              resolve(responseData);
            } else {
              console.error(`Authentication failed with status code: ${res.statusCode}`);
              console.error(`Response: ${data}`);
              reject(new Error(`Authentication failed with status ${res.statusCode}`));
            }
          } catch (error) {
            console.error('Error parsing authentication response:', error);
            reject(error);
          }
        });
      });
      
      req.on('error', (error) => {
        console.error('Authentication request error:', error);
        reject(error);
      });
      
      req.end();
    } catch (error) {
      console.error('Error setting up authentication request:', error);
      reject(error);
    }
  });
}

/**
 * Format HTML content for WordPress Gutenberg blocks
 * @param {string} content - HTML content
 * @returns {string} Formatted content with Gutenberg blocks
 */
function formatContentForWordPress(content) {
  try {
    // Ensure content is a string - this is crucial to prevent the lastIndexOf error
    if (!content || typeof content !== 'string') {
      console.warn('Content is not a string, converting to string');
      content = String(content || '');
    }
    
    // Check if the content already has HTML tags
    const hasHtmlTags = /<\/?[a-z][\s\S]*>/i.test(content);
    
    if (hasHtmlTags) {
      // Convert HTML content to WordPress Gutenberg blocks
      return content
        .replace(/<h2>(.*?)<\/h2>/gi, '<!-- wp:heading --><h2>$1</h2><!-- /wp:heading -->')
        .replace(/<h3>(.*?)<\/h3>/gi, '<!-- wp:heading {"level":3} --><h3>$1</h3><!-- /wp:heading -->')
        .replace(/<p>(.*?)<\/p>/gi, '<!-- wp:paragraph --><p>$1</p><!-- /wp:paragraph -->')
        .replace(/<ul>([\s\S]*?)<\/ul>/gi, '<!-- wp:list --><ul>$1</ul><!-- /wp:list -->')
        .replace(/<ol>([\s\S]*?)<\/ol>/gi, '<!-- wp:list {"ordered":true} --><ol>$1</ol><!-- /wp:list -->');
    } else {
      // If no HTML tags, format the content as WordPress blocks
      return content
        .split('\n\n')
        .map(para => para.trim())
        .filter(para => para.length > 0)
        .map(para => {
          // Check if paragraph is a heading
          if (para.startsWith('# ')) {
            return `<!-- wp:heading --><h2>${para.substring(2)}</h2><!-- /wp:heading -->`;
          } else if (para.startsWith('## ')) {
            return `<!-- wp:heading --><h2>${para.substring(3)}</h2><!-- /wp:heading -->`;
          } else if (para.startsWith('### ')) {
            return `<!-- wp:heading {"level":3} --><h3>${para.substring(4)}</h3><!-- /wp:heading -->`;
          } else {
            // Regular paragraph
            return `<!-- wp:paragraph --><p>${para}</p><!-- /wp:paragraph -->`;
          }
        })
        .join('\n\n');
    }
  } catch (error) {
    console.error('Error formatting content:', error);
    return String(content || ''); // Return stringified content if formatting fails
  }
}

/**
 * Simple function to create plain text from HTML
 * @param {string} html - HTML content
 * @returns {string} Plain text content
 */
function htmlToText(html) {
  if (!html || typeof html !== 'string') return '';
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Publish article to WordPress using native https
 * @param {Object} wpConfig - WordPress configuration
 * @param {Object} article - Article with title and content
 * @param {string} keyword - Keyword for the article
 * @param {string} status - 'draft' or 'publish'
 * @returns {Object} WordPress API response
 */
async function publishToWordPress(wpConfig, article, keyword, status = 'draft') {
  return new Promise((resolve, reject) => {
    try {
      // Validate article input to prevent errors
      if (!article || typeof article !== 'object') {
        return reject(new Error('Invalid article object provided'));
      }
      
      // Ensure title is a string
      const title = article.title ? String(article.title) : '';
      if (!title) {
        return reject(new Error('Article title is required'));
      }
      
      // Ensure content is a string (this is crucial for the lastIndexOf error)
      const content = article.content ? String(article.content) : '';
      if (!content) {
        return reject(new Error('Article content is required'));
      }
      
      console.log(`Publishing article: ${title} (${status})`);
      
      // Parse the API URL
      const parsedUrl = url.parse(wpConfig.apiUrl);
      
      // Create authentication header
      const authString = `${wpConfig.username}:${wpConfig.password}`;
      const encodedAuth = Buffer.from(authString).toString('base64');
      
      // Format content for WordPress
      let formattedContent = "";
      try {
        formattedContent = formatContentForWordPress(content);
      } catch (formatError) {
        console.error('Error formatting content, using original:', formatError);
        formattedContent = content;
      }
      
      // Create extremely simple post data
      const postData = {
        title: title,
        content: formattedContent,
        status: status
      };
      
      // Convert to string
      const postDataString = JSON.stringify(postData);
      
      // Log what we're sending
      console.log(`Posting to ${parsedUrl.hostname}${parsedUrl.pathname}/posts`);
      console.log(`Title: ${postData.title.substring(0, 30)}...`);
      console.log(`Status: ${postData.status}`);
      console.log(`Content size: ${postDataString.length} characters`);
      
      // Set up request options
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: `${parsedUrl.pathname}/posts`,
        method: 'POST',
        headers: {
          'Authorization': `Basic ${encodedAuth}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postDataString)
        },
        rejectUnauthorized: false // Allow self-signed certificates
      };
      
      // Make the request
      const req = https.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              const responseData = JSON.parse(data);
              console.log(`✓ Article published successfully as ${status}`);
              console.log(`Post ID: ${responseData.id}`);
              console.log(`Post URL: ${responseData.link}`);
              
              resolve({
                postId: responseData.id,
                postUrl: responseData.link,
                status: 'Published',
                publishDate: new Date().toISOString().split('T')[0]
              });
            } else {
              console.error(`Failed to publish with status code: ${res.statusCode}`);
              console.error(`Response: ${data}`);
              reject(new Error(`Failed to publish with status ${res.statusCode}`));
            }
          } catch (error) {
            console.error('Error parsing publish response:', error);
            reject(error);
          }
        });
      });
      
      req.on('error', (error) => {
        console.error('Publish request error:', error);
        reject(error);
      });
      
      // Write data to request body
      req.write(postDataString);
      req.end();
    } catch (error) {
      console.error('Error setting up publish request:', error);
      reject(error);
    }
  });
}

module.exports = {
  testWordPressConnection,
  testAuthentication,
  publishToWordPress
};