// src/config.js
//
// This module loads configuration from data/config.json file
// and provides a central place for all settings.

const fs = require('fs').promises;
const path = require('path');

// Path to configuration file
const CONFIG_FILE = path.join(__dirname, '../data/config.json');
const DEFAULT_CONFIG_FILE = path.join(__dirname, '../data/default-config.json');

// Default configuration
const defaultConfig = {
  // WordPress API configuration
  wordpress: {
    apiUrl: '',
    username: '',
    password: '',
  },
  
  // OpenAI API configuration
  openai: {
    apiKey: '',
    model: 'gpt-3.5-turbo',
    temperature: 0.7,
    maxTokens: 3500,
  },
  
  // Application settings
  app: {
    excelFile: 'keywords.xlsx',
    keywordColumn: 'Keyword',
    minWords: 800,
    publishStatus: 'draft', // 'draft' or 'publish'
    delayBetweenPosts: 5000, // milliseconds
    contentTemplate: 'Write a comprehensive, engaging, and SEO-optimized article about "{keyword}" that follows these guidelines:\n\n1. The article should be at least {minWords} words\n2. Use proper WordPress formatting with H2 and H3 headings (no H1 as that\'s for the title)\n3. Include a compelling introduction that hooks the reader\n4. Break down the topic into logical sections with descriptive headings\n5. Include practical tips, examples, and actionable advice\n6. Add a conclusion that summarizes key points\n7. Optimize for SEO with natural keyword usage\n8. Make the content valuable and informative for the reader', 
  },
  
  // Prompt settings
  prompts: {
    useMultiPartGeneration: false,
    mainPrompt: '',
    part1Prompt: 'Write an engaging introduction for an article about "{keyword}". The introduction should hook the reader, explain why the topic is important, and preview what the article will cover. Use approximately {minWords} words.',
    part2Prompt: 'Write the main body content for an article about "{keyword}". This should include detailed information, breakdown of the topic into logical sections with appropriate H2 and H3 headings, practical tips, examples, and actionable advice. Use approximately {minWords} words.',
    part3Prompt: 'Write a conclusion for an article about "{keyword}". The conclusion should summarize the key points, provide final thoughts, and possibly include a call to action. Use approximately {minWords} words.',
    toneVoice: '',
    seoGuidelines: '',
    thingsToAvoid: '',
    articleFormat: '',
    useArticleFormat: false
  },
};

// Runtime config object
let config = { ...defaultConfig };

// Load configuration from file
async function loadConfig() {
  try {
    // Check if config file exists
    try {
      const data = await fs.readFile(CONFIG_FILE, 'utf8');
      config = JSON.parse(data);
      console.log('Configuration loaded from data/config.json');
      return config;
    } catch (error) {
      // If the file doesn't exist or can't be parsed, create it with default values
      if (error.code === 'ENOENT' || error.name === 'SyntaxError') {
        console.log('Config file not found or invalid. Creating default config...');
        await saveConfig(defaultConfig);
        config = { ...defaultConfig };
        return config;
      }
      throw error;
    }
  } catch (error) {
    console.error('Error loading configuration:', error);
    // Still return the default config so the app can run
    return config;
  }
}

// Save configuration to file
async function saveConfig(newConfig) {
  try {
    // Create data directory if it doesn't exist
    const dataDir = path.join(__dirname, '../data');
    try {
      await fs.mkdir(dataDir, { recursive: true });
    } catch (dirError) {
      if (dirError.code !== 'EEXIST') throw dirError;
    }
    
    // Save config file
    await fs.writeFile(CONFIG_FILE, JSON.stringify(newConfig, null, 2), 'utf8');
    
    // Update runtime config
    config = { ...newConfig };
    
    console.log('Configuration saved to data/config.json');
    return true;
  } catch (error) {
    console.error('Error saving configuration:', error);
    return false;
  }
}

// Validate the essential configuration
function validateConfig() {
  const missingVars = [];
  
  if (!config.wordpress.apiUrl) missingVars.push('WordPress API URL');
  if (!config.wordpress.username) missingVars.push('WordPress Username');
  if (!config.wordpress.password) missingVars.push('WordPress Password');
  if (!config.openai.apiKey) missingVars.push('OpenAI API Key');
  
  if (missingVars.length > 0) {
    console.error('Error: Missing required configuration values:');
    missingVars.forEach(variable => console.error(`- ${variable}`));
    console.error('Please configure these settings in the web interface at /settings');
    return false;
  }
  
  // If multi-part generation is enabled, check if all part prompts are defined
  if (config.prompts.useMultiPartGeneration) {
    const missingPrompts = [];
    if (!config.prompts.part1Prompt) missingPrompts.push('Part 1 Prompt');
    if (!config.prompts.part2Prompt) missingPrompts.push('Part 2 Prompt');
    if (!config.prompts.part3Prompt) missingPrompts.push('Part 3 Prompt');
    
    if (missingPrompts.length > 0) {
      console.warn('Warning: Multi-part generation is enabled but some prompts are missing:');
      missingPrompts.forEach(prompt => console.warn(`- ${prompt}`));
      console.warn('Default prompts will be used for missing parts.');
    }
  }
  
  return true;
}

// Initialize configuration
loadConfig();

module.exports = {
  config,
  validateConfig,
  saveConfig,
  loadConfig
};