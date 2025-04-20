// src/openai.js
//
// This module handles interaction with the OpenAI API for generating content.

const { OpenAI } = require('openai');
const { extractRecipeData } = require('./recipe-extraction');

/**
 * Generate article content based on keyword
 * @param {Object} openaiConfig - OpenAI API configuration
 * @param {string} keyword - Keyword to generate article around
 * @param {number} minWords - Minimum word count for article
 * @param {Object} promptSettings - Custom prompt settings (optional)
 * @returns {Object} Article title and content
 */
async function generateArticleContent(openaiConfig, keyword, minWords = 800, promptSettings = null) {
  console.log(`Generating article for keyword: ${keyword}`);
  
  try {
    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: openaiConfig.apiKey,
    });

    // Check if we need to use multi-part generation
    if (promptSettings && promptSettings.useMultiPartGeneration) {
      return await generateMultiPartArticle(openai, openaiConfig, keyword, minWords, promptSettings);
    }

    // Prepare the prompt for content generation (single part)
    let contentPrompt;
    
    if (promptSettings && promptSettings.mainPrompt) {
      // Use the custom template from settings
      contentPrompt = applyPromptVariables(promptSettings.mainPrompt, {
        keyword: keyword,
        minWords: minWords
      });
    } else {
      // Use the default template
      contentPrompt = `Write a comprehensive, engaging, and SEO-optimized article about "${keyword}" that follows these guidelines:
      
      1. The article should be at least ${minWords} words
      2. Use proper WordPress formatting with H2 and H3 headings (no H1 as that's for the title)
      3. Include a compelling introduction that hooks the reader
      4. Break down the topic into logical sections with descriptive headings
      5. Include practical tips, examples, and actionable advice
      6. Add a conclusion that summarizes key points
      7. Optimize for SEO with natural keyword usage
      8. Make the content valuable and informative for the reader
      
      Format the article with proper HTML tags:
      - Use <h2> for main section headings
      - Use <h3> for subsection headings
      - Use <p> for paragraphs
      - Use <ul> and <li> for bullet points where appropriate
      - Use <ol> and <li> for numbered lists where appropriate
      
      Write in a conversational, authoritative tone that engages the reader.`;
    }
    
    // Prepare system message with tone guidance if available
    let systemMessage = "You are a professional content writer specializing in SEO-optimized articles that follow WordPress formatting standards.";
    
    if (promptSettings && promptSettings.toneVoice) {
      systemMessage += `\n\nWrite in the following tone/voice: ${promptSettings.toneVoice}`;
    }
    
    // Add SEO guidelines if available
    if (promptSettings && promptSettings.seoGuidelines) {
      contentPrompt += `\n\nFollow these additional SEO guidelines:\n${promptSettings.seoGuidelines}`;
    }
    
    // Add things to avoid if available - with stronger emphasis
    if (promptSettings && promptSettings.thingsToAvoid) {
      contentPrompt += `\n\nIMPORTANT: DO NOT mention, include, or reference ANY of the following in your content. This is a strict requirement. DO NOT use ANY of these terms or concepts:\n${promptSettings.thingsToAvoid}`;
    }
    
    // Add article format if enabled and specified
    if (promptSettings && promptSettings.useArticleFormat && promptSettings.articleFormat) {
      contentPrompt += `\n\nARTICLE FORMAT INSTRUCTIONS:\nFollow this specific structure and format for the article:\n${promptSettings.articleFormat}`;
    }
    
    // Check if we should use recipe format
    if (promptSettings && promptSettings.enableRecipeDetection && keyword.toLowerCase().match(/recipe|dish|cook|bake|food|meal|breakfast|lunch|dinner|dessert|appetizer|snack/)) {
      // Add recipe format prompt
      if (promptSettings.recipeFormatPrompt) {
        contentPrompt += `\n\nRECIPE FORMAT INSTRUCTIONS:\n${promptSettings.recipeFormatPrompt}`;
      } else {
        contentPrompt += `\n\nRECIPE FORMAT INSTRUCTIONS:
Please format this as a recipe article with the following sections:
1. A brief introduction about the dish
2. A "Ingredients" section with a clear, bulleted list (<ul><li>) of all ingredients with quantities
3. A "Instructions" section with numbered steps (<ol><li>) for preparation
4. Include preparation time, cooking time, and servings information clearly labeled (e.g., "Prep Time: 15 minutes")
5. Add a "Tips and Notes" section with helpful advice for making this recipe
6. If relevant, include nutrition information`;
      }
    }
    
    // Generate the article content
    const contentResponse = await openai.chat.completions.create({
      model: openaiConfig.model,
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: contentPrompt }
      ],
      temperature: openaiConfig.temperature,
      max_tokens: openaiConfig.maxTokens,
    });
    
    // Extract the content from the response
    let content = contentResponse.choices[0].message.content;
    
    // Post-process content to ensure "things to avoid" are really removed
    if (promptSettings && promptSettings.thingsToAvoid) {
      content = removeProhibitedContent(content, promptSettings.thingsToAvoid);
    }
    
    // Create the prompt for the article title
    const titlePrompt = `Create an engaging, SEO-friendly title for an article about "${keyword}" that will attract clicks and is optimized for SEO.`;
    
    // Add things to avoid to title generation if available
    let fullTitlePrompt = titlePrompt;
    if (promptSettings && promptSettings.thingsToAvoid) {
      fullTitlePrompt += `\n\nIMPORTANT: DO NOT use ANY of the following words in the title: ${promptSettings.thingsToAvoid}`;
    }
    
    // Generate the title
    const titleResponse = await openai.chat.completions.create({
      model: openaiConfig.model,
      messages: [
        { role: "system", content: "Generate a compelling, SEO-friendly title for this article." },
        { role: "user", content: fullTitlePrompt }
      ],
      temperature: openaiConfig.temperature,
      max_tokens: 50,
    });
    
    // Extract the title from the response and clean it up
    let title = titleResponse.choices[0].message.content.replace(/"/g, '');
    
    // Post-process title to ensure "things to avoid" are really removed
    if (promptSettings && promptSettings.thingsToAvoid) {
      title = removeProhibitedContent(title, promptSettings.thingsToAvoid);
    }
    
    console.log(`Generated article: "${title}" (${countWords(content)} words)`);
    
    // Check if the content contains a recipe (if recipe detection is enabled)
    let recipeData = null;
    if (promptSettings && promptSettings.enableRecipeDetection) {
      recipeData = extractRecipeData(content, keyword);
      if (recipeData) {
        console.log('Recipe detected and data extracted successfully');
      }
    }
    
    return {
      title,
      content,
      wordCount: countWords(content),
      recipeData  // Will be null if no recipe is detected or detection is disabled
    };
  } catch (error) {
    console.error('Error generating article content:', error.message);
    throw error;
  }
}

/**
 * Post-process content to ensure prohibited terms are removed
 * @param {string} content - The content to process
 * @param {string} thingsToAvoid - Comma-separated list of terms to avoid
 * @returns {string} Processed content with prohibited terms removed
 */
function removeProhibitedContent(content, thingsToAvoid) {
  // Parse things to avoid - handle both comma-separated strings and JSON-like arrays
  let avoidTerms = [];
  
  // Try to parse as JSON if it looks like an array
  if (thingsToAvoid.trim().startsWith('[') && thingsToAvoid.trim().endsWith(']')) {
    try {
      avoidTerms = JSON.parse(thingsToAvoid);
    } catch (e) {
      // If parsing fails, fall back to splitting by commas
      avoidTerms = parseAvoidTerms(thingsToAvoid);
    }
  } else {
    avoidTerms = parseAvoidTerms(thingsToAvoid);
  }
  
  // Clean and normalize terms
  avoidTerms = avoidTerms.map(term => 
    term.trim()
      .replace(/^["'](.+)["']$/, '$1') // Remove quotes
      .toLowerCase()
  ).filter(term => term.length > 0);
  
  console.log('Terms to avoid:', avoidTerms);
  
  // Check each term and create replacements
  avoidTerms.forEach(term => {
    // Create regex patterns to match the term with word boundaries and in various cases
    const wordPattern = new RegExp(`\\b${escapeRegExp(term)}\\b`, 'gi');
    
    // Replace in content - use a generic replacement or omit
    content = content.replace(wordPattern, '[alternative]');
  });
  
  return content;
}

/**
 * Parse comma-separated or quoted list of terms to avoid
 * @param {string} thingsToAvoid - String with terms to avoid
 * @returns {Array} Array of terms to avoid
 */
function parseAvoidTerms(thingsToAvoid) {
  // Handle various formats:
  // - Simple comma-separated: term1, term2, term3
  // - Quoted comma-separated: "term1", "term2", "term3"
  // - Mixed: term1, "term with spaces", term3
  
  // This regex matches:
  // - Quoted strings (keeping content inside quotes)
  // - Or non-quoted strings separated by commas
  const termRegex = /(?:"([^"]+)"|'([^']+)'|([^,"']+))/g;
  const terms = [];
  let match;
  
  while ((match = termRegex.exec(thingsToAvoid)) !== null) {
    // The match can be in group 1, 2, or 3 depending on whether it was quoted
    const term = match[1] || match[2] || match[3];
    if (term && term.trim()) {
      terms.push(term.trim());
    }
  }
  
  return terms;
}

/**
 * Escape special characters in string for use in regex
 * @param {string} string - String to escape
 * @returns {string} Escaped string
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Generate article in multiple parts (introduction, body, conclusion)
 * @param {Object} openai - OpenAI client instance
 * @param {Object} openaiConfig - OpenAI API configuration
 * @param {string} keyword - Keyword to generate article around
 * @param {number} minWords - Minimum word count for article
 * @param {Object} promptSettings - Custom prompt settings
 * @returns {Object} Article title and content
 */
async function generateMultiPartArticle(openai, openaiConfig, keyword, minWords, promptSettings) {
  console.log(`Generating multi-part article for keyword: ${keyword}`);
  
  // Prepare system message with tone guidance if available
  let systemMessage = "You are a professional content writer specializing in SEO-optimized articles that follow WordPress formatting standards.";
  
  if (promptSettings.toneVoice) {
    systemMessage += `\n\nWrite in the following tone/voice: ${promptSettings.toneVoice}`;
  }
  
  // Check if we need to include article format
  let articleFormatInstructions = "";
  if (promptSettings.useArticleFormat && promptSettings.articleFormat) {
    articleFormatInstructions = `\n\nARTICLE FORMAT INSTRUCTIONS:\nFollow this specific structure and format for the article:\n${promptSettings.articleFormat}`;
  }
  
  // Check if we should use recipe format
  let recipeFormatInstructions = "";
  if (promptSettings.enableRecipeDetection && keyword.toLowerCase().match(/recipe|dish|cook|bake|food|meal|breakfast|lunch|dinner|dessert|appetizer|snack/)) {
    if (promptSettings.recipeFormatPrompt) {
      recipeFormatInstructions = `\n\nRECIPE FORMAT INSTRUCTIONS:\n${promptSettings.recipeFormatPrompt}`;
    } else {
      recipeFormatInstructions = `\n\nRECIPE FORMAT INSTRUCTIONS:
Please format this as a recipe article with the following sections:
1. A brief introduction about the dish
2. A "Ingredients" section with a clear, bulleted list (<ul><li>) of all ingredients with quantities
3. A "Instructions" section with numbered steps (<ol><li>) for preparation
4. Include preparation time, cooking time, and servings information clearly labeled (e.g., "Prep Time: 15 minutes")
5. Add a "Tips and Notes" section with helpful advice for making this recipe
6. If relevant, include nutrition information`;
    }
  }
  
  // Calculate approximate word counts for each section
  // Introduction ~20%, Body ~60%, Conclusion ~20%
  const introWordCount = Math.floor(minWords * 0.2);
  const bodyWordCount = Math.floor(minWords * 0.6);
  const conclusionWordCount = Math.floor(minWords * 0.2);
  
  // Part 1: Introduction
  const introPart = await generateArticlePart(
    openai,
    openaiConfig,
    keyword,
    introWordCount,
    promptSettings.part1Prompt || "Write an engaging introduction for an article about {keyword}. The introduction should hook the reader, explain why the topic is important, and preview what the article will cover. Use approximately {minWords} words.",
    systemMessage,
    promptSettings,
    articleFormatInstructions + recipeFormatInstructions
  );
  
  // Part 2: Body
  const bodyPart = await generateArticlePart(
    openai,
    openaiConfig,
    keyword,
    bodyWordCount,
    promptSettings.part2Prompt || "Write the main body content for an article about {keyword}. This should include detailed information, breakdown of the topic into logical sections with appropriate H2 and H3 headings, practical tips, examples, and actionable advice. Use approximately {minWords} words.",
    systemMessage,
    promptSettings,
    articleFormatInstructions + recipeFormatInstructions
  );
  
  // Part 3: Conclusion
  const conclusionPart = await generateArticlePart(
    openai,
    openaiConfig,
    keyword,
    conclusionWordCount,
    promptSettings.part3Prompt || "Write a conclusion for an article about {keyword}. The conclusion should summarize the key points, provide final thoughts, and possibly include a call to action. Use approximately {minWords} words.",
    systemMessage,
    promptSettings,
    articleFormatInstructions + recipeFormatInstructions
  );
  
  // Combine the parts
  let combinedContent = `${introPart}\n\n${bodyPart}\n\n${conclusionPart}`;
  
  // Post-process content to ensure "things to avoid" are really removed
  if (promptSettings.thingsToAvoid) {
    combinedContent = removeProhibitedContent(combinedContent, promptSettings.thingsToAvoid);
  }
  
  // Generate title
  const titlePrompt = `Create an engaging, SEO-friendly title for an article about "${keyword}" that will attract clicks and is optimized for SEO.`;
  
  // Add things to avoid to title generation if available
  let fullTitlePrompt = titlePrompt;
  if (promptSettings.thingsToAvoid) {
    fullTitlePrompt += `\n\nIMPORTANT: DO NOT use ANY of the following words in the title: ${promptSettings.thingsToAvoid}`;
  }
  
  const titleResponse = await openai.chat.completions.create({
    model: openaiConfig.model,
    messages: [
      { role: "system", content: "Generate a compelling, SEO-friendly title for this article." },
      { role: "user", content: fullTitlePrompt }
    ],
    temperature: openaiConfig.temperature,
    max_tokens: 50,
  });
  
  let title = titleResponse.choices[0].message.content.replace(/"/g, '');
  
  // Post-process title to ensure "things to avoid" are really removed
  if (promptSettings.thingsToAvoid) {
    title = removeProhibitedContent(title, promptSettings.thingsToAvoid);
  }
  
  const wordCount = countWords(combinedContent);
  
  console.log(`Generated multi-part article: "${title}" (${wordCount} words)`);
  
  // Check if the content contains a recipe (if recipe detection is enabled)
  let recipeData = null;
  if (promptSettings.enableRecipeDetection) {
    recipeData = extractRecipeData(combinedContent, keyword);
    if (recipeData) {
      console.log('Recipe detected and data extracted successfully');
    }
  }
  
  return {
    title,
    content: combinedContent,
    wordCount,
    recipeData  // Will be null if no recipe is detected or detection is disabled
  };
}

/**
 * Generate a specific part of an article
 * @param {Object} openai - OpenAI client instance
 * @param {Object} openaiConfig - OpenAI API configuration
 * @param {string} keyword - Keyword to generate article around
 * @param {number} wordCount - Target word count for this part
 * @param {string} promptTemplate - Template for this article part
 * @param {string} systemMessage - System message with tone guidance
 * @param {Object} promptSettings - Custom prompt settings
 * @param {string} formatInstructions - Format instructions (article format, recipe format)
 * @returns {string} Generated content for this part
 */
async function generateArticlePart(openai, openaiConfig, keyword, wordCount, promptTemplate, systemMessage, promptSettings, formatInstructions = "") {
  // Prepare prompt with variable replacement
  let prompt = applyPromptVariables(promptTemplate, {
    keyword: keyword,
    minWords: wordCount
  });
  
  // Add SEO guidelines if available
  if (promptSettings.seoGuidelines) {
    prompt += `\n\nFollow these additional SEO guidelines:\n${promptSettings.seoGuidelines}`;
  }
  
  // Add things to avoid if available - with stronger emphasis
  if (promptSettings.thingsToAvoid) {
    prompt += `\n\nIMPORTANT: DO NOT mention, include, or reference ANY of the following in your content. This is a strict requirement. DO NOT use ANY of these terms or concepts:\n${promptSettings.thingsToAvoid}`;
  }
  
  // Add format instructions if provided
  if (formatInstructions) {
    // For introduction, provide full format instructions for context but mention focus on intro
    if (prompt.includes("introduction for an article")) {
      prompt += `${formatInstructions}\n\nFocus on writing the introduction part while keeping the overall article format in mind.`;
    }
    // For body, provide full format instructions and emphasize following the structure
    else if (prompt.includes("main body content")) {
      prompt += `${formatInstructions}\n\nEnsure you follow this structure while creating the main body content.`;
    }
    // For conclusion, provide format instructions focused on conclusion part
    else if (prompt.includes("conclusion for an article")) {
      prompt += `${formatInstructions}\n\nFocus on writing the conclusion part according to this format.`;
    }
    // For any other part, just add the instructions
    else {
      prompt += formatInstructions;
    }
  }
  
  // Generate content for this part
  const response = await openai.chat.completions.create({
    model: openaiConfig.model,
    messages: [
      { role: "system", content: systemMessage },
      { role: "user", content: prompt }
    ],
    temperature: openaiConfig.temperature,
    max_tokens: Math.min(2000, openaiConfig.maxTokens),
  });
  
  let content = response.choices[0].message.content;
  
  // Post-process content to ensure "things to avoid" are really removed
  if (promptSettings.thingsToAvoid) {
    content = removeProhibitedContent(content, promptSettings.thingsToAvoid);
  }
  
  return content;
}

/**
 * Replace variables in prompt template
 * @param {string} template - Template with {variable} placeholders
 * @param {Object} variables - Object with variable values
 * @returns {string} Template with replaced variables
 */
function applyPromptVariables(template, variables) {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result;
}

/**
 * Count the number of words in a string
 * @param {string} text - The text to count words in
 * @returns {number} The word count
 */
function countWords(text) {
  return text.split(/\s+/).filter(word => word.length > 0).length;
}

module.exports = {
  generateArticleContent
};