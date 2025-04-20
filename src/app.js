// src/app.js
//
// This is the main application file that:
// 1. Loads the configuration
// 2. Sets up the environment
// 3. Executes the workflow

// Import required modules
const { config, validateConfig } = require('./config');
const { readKeywordsFromExcel, updateExcelWithPublicationStatus, createSampleExcelFile } = require('./excel');
const { generateArticleContent } = require('./openai');
const { testWordPressConnection, publishToWordPress } = require('./wordpress');

/**
 * Sleep for a given number of milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} Promise that resolves after ms milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main function to run the automation
 */
async function runAutomation() {
  console.log('=========================================');
  console.log('WordPress Article Automation');
  console.log('=========================================');
  
  try {
    // Step 1: Validate configuration
    console.log('\nStep 1: Validating configuration...');
    if (!validateConfig()) {
      return;
    }
    console.log('✓ Configuration validated');
    
    // Create sample Excel file if it doesn't exist
    createSampleExcelFile(config.app.excelFile);
    
    // Step 2: Test WordPress connection
    console.log('\nStep 2: Testing WordPress connection...');
    const wpConnectionSuccess = await testWordPressConnection(config.wordpress);
    if (!wpConnectionSuccess) {
      console.error('WordPress connection failed. Please check your credentials and try again.');
      return;
    }
    
    // Step 3: Read keywords from Excel
    console.log('\nStep 3: Reading keywords from Excel...');
    const keywordRows = readKeywordsFromExcel(config.app.excelFile, config.app.keywordColumn);
    
    if (keywordRows.length === 0) {
      console.log('No pending keywords found in Excel file. Nothing to do.');
      return;
    }
    
    console.log(`Found ${keywordRows.length} keywords to process:`);
    keywordRows.forEach((row, index) => {
      console.log(`${index + 1}. ${row[config.app.keywordColumn]}`);
    });
    
    // Step 4: Process each keyword
    console.log('\nStep 4: Processing keywords...');
    let successCount = 0;
    let failureCount = 0;
    
    for (let i = 0; i < keywordRows.length; i++) {
      const keywordRow = keywordRows[i];
      const keyword = keywordRow[config.app.keywordColumn];
      
      console.log(`\nProcessing ${i + 1}/${keywordRows.length}: "${keyword}"`);
      
      try {
        // Step 4.1: Generate article content with prompt settings
        console.log('Generating article content...');
        
        // Prepare prompt settings
        const promptSettings = config.prompts.useMultiPartGeneration || config.prompts.toneVoice || 
                              config.prompts.seoGuidelines || config.prompts.thingsToAvoid || 
                              config.prompts.mainPrompt ? {
          useMultiPartGeneration: config.prompts.useMultiPartGeneration,
          mainPrompt: config.prompts.mainPrompt || config.app.contentTemplate,
          part1Prompt: config.prompts.part1Prompt,
          part2Prompt: config.prompts.part2Prompt,
          part3Prompt: config.prompts.part3Prompt,
          toneVoice: config.prompts.toneVoice,
          seoGuidelines: config.prompts.seoGuidelines,
          thingsToAvoid: config.prompts.thingsToAvoid
        } : null;
        
        // Generate article with custom prompt settings
        const article = await generateArticleContent(
          config.openai, 
          keyword, 
          config.app.minWords,
          promptSettings
        );
        
        // Step 4.2: Publish to WordPress
        console.log('Publishing to WordPress...');
        const publishData = await publishToWordPress(
          config.wordpress,
          article,
          keyword,
          config.app.publishStatus
        );
        
        // Step 4.3: Update Excel with publication status
        console.log('Updating Excel file...');
        updateExcelWithPublicationStatus(config.app.excelFile, keywordRow, publishData);
        
        console.log(`✓ Successfully processed keyword: ${keyword}`);
        successCount++;
        
        // Add a delay between processing keywords to avoid rate limiting
        if (i < keywordRows.length - 1) {
          console.log(`Waiting ${config.app.delayBetweenPosts / 1000} seconds before next keyword...`);
          await sleep(config.app.delayBetweenPosts);
        }
      } catch (error) {
        console.error(`✗ Failed to process keyword "${keyword}":`, error.message);
        failureCount++;
        
        // Continue with next keyword
        continue;
      }
    }
    
    // Step 5: Summary
    console.log('\n=========================================');
    console.log('Summary:');
    console.log(`Total keywords: ${keywordRows.length}`);
    console.log(`Successful: ${successCount}`);
    console.log(`Failed: ${failureCount}`);
    console.log('=========================================');
    
    console.log('\nAutomation completed!');
    
  } catch (error) {
    console.error('Automation failed:', error.message);
  }
}

// Run the automation
runAutomation();