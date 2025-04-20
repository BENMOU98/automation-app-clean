// src/recipe-extraction.js
//
// This module handles detecting and extracting recipe data from article content

/**
 * Detect if content contains a recipe and extract recipe data
 * @param {string} content - The article content
 * @param {string} keyword - The keyword used to generate the article
 * @returns {Object|null} - Recipe data or null if no recipe found
 */
function extractRecipeData(content, keyword) {
    // Check if content likely contains a recipe
    const recipeIndicators = [
      'ingredients', 'instructions', 'preparation', 'minutes', 
      'cook time', 'prep time', 'servings', 'recipe', 'tablespoon', 
      'teaspoon', 'cup', 'bake', 'fry', 'boil', 'simmer'
    ];
    
    // Count how many indicators are present
    let indicatorCount = 0;
    recipeIndicators.forEach(term => {
      if (content.toLowerCase().includes(term)) {
        indicatorCount++;
      }
    });
    
    // If less than 3 indicators are present, probably not a recipe
    if (indicatorCount < 3) return null;
    
    console.log("Recipe detected in content. Extracting recipe data...");
    
    // Extract recipe components
    const recipeData = {
      "Description": extractDescription(content),
      "Ingredients": extractIngredients(content),
      "Instructions": extractInstructions(content),
      "Notes": extractNotes(content),
      "Details": {
        "Prep Time": extractTime(content, 'prep'),
        "Cook Time": extractTime(content, 'cook'),
        "Total Time": extractTime(content, 'total'),
        "Yield": extractYield(content),
        "Category": determineCategory(content, keyword),
        "Method": determineMethod(content),
        "Cuisine": determineCuisine(content, keyword),
        "Diet": determineDiet(content)
      },
      "Keywords": keyword + extractKeywords(content),
      "Nutrition": extractNutrition(content)
    };
    
    return recipeData;
  }
  
  /**
   * Extract a brief description from the content
   */
  function extractDescription(content) {
    // Look for the first paragraph after the introduction
    const paragraphs = content.match(/<p>(.*?)<\/p>/g);
    if (paragraphs && paragraphs.length > 0) {
      // Get the first or second paragraph, depending on length
      let description = paragraphs[0].replace(/<\/?p>/g, '');
      if (description.length < 50 && paragraphs.length > 1) {
        description = paragraphs[1].replace(/<\/?p>/g, '');
      }
      
      // Limit to a reasonable length if it's too long
      if (description.length > 300) {
        description = description.substring(0, 297) + '...';
      }
      
      return description;
    }
    return "A delicious and easy recipe that everyone will love.";
  }
  
  /**
   * Extract ingredients list from content
   */
  function extractIngredients(content) {
    // Look for ingredient list patterns
    let ingredients = "";
    
    // Try to find an unordered list after an ingredients heading
    const ingredientsSection = content.match(/(?:<h[2-3][^>]*>(?:[^<]*ingredients|ingredients[^<]*)<\/h[2-3]>)([\s\S]*?)(?:<h[2-3]|<\/body)/i);
    
    if (ingredientsSection && ingredientsSection[1]) {
      // Try to find an unordered list in the ingredients section
      const ulMatch = ingredientsSection[1].match(/<ul>([\s\S]*?)<\/ul>/i);
      if (ulMatch && ulMatch[1]) {
        ingredients = "<ul>" + ulMatch[1] + "</ul>";
      } else {
        // If no unordered list is found, look for paragraphs or lines
        const lines = ingredientsSection[1].split(/<br\s*\/?>/);
        if (lines.length > 2) {
          ingredients = "<ul>";
          lines.forEach(line => {
            line = line.trim();
            if (line && !line.startsWith('<') && !line.endsWith('>') && line.length > 3) {
              ingredients += "<li>" + line + "</li>";
            }
          });
          ingredients += "</ul>";
        }
      }
    }
    
    // If still empty, try to construct from list items anywhere in the content
    if (!ingredients || ingredients === "<ul></ul>") {
      const allLists = content.match(/<ul>([\s\S]*?)<\/ul>/g);
      if (allLists) {
        // Find the list that's most likely to be ingredients
        for (const list of allLists) {
          if (list.toLowerCase().includes("cup") || 
              list.toLowerCase().includes("teaspoon") || 
              list.toLowerCase().includes("tablespoon") ||
              list.toLowerCase().includes("ounce") ||
              list.toLowerCase().includes("pound")) {
            ingredients = list;
            break;
          }
        }
      }
    }
    
    // If still empty, provide a placeholder
    if (!ingredients || ingredients === "<ul></ul>") {
      ingredients = "<ul><li>Ingredient 1</li><li>Ingredient 2</li><li>Ingredient 3</li></ul>";
    }
    
    return ingredients;
  }
  
  /**
   * Extract instructions from content
   */
  function extractInstructions(content) {
    // Look for instructions patterns
    let instructions = "";
    
    // Try to find an ordered list after an instructions/directions/method heading
    const instructionsSection = content.match(/(?:<h[2-3][^>]*>(?:[^<]*instructions|directions|method|steps|how to[^<]*)<\/h[2-3]>)([\s\S]*?)(?:<h[2-3]|<\/body)/i);
    
    if (instructionsSection && instructionsSection[1]) {
      // Try to find an ordered list in the instructions section
      const olMatch = instructionsSection[1].match(/<ol>([\s\S]*?)<\/ol>/i);
      if (olMatch && olMatch[1]) {
        instructions = "<ol>" + olMatch[1] + "</ol>";
      } else {
        // If no ordered list is found, look for paragraphs or numbered items
        const paragraphs = instructionsSection[1].match(/<p>(.*?)<\/p>/g);
        if (paragraphs && paragraphs.length > 1) {
          instructions = "<ol>";
          paragraphs.forEach(p => {
            const text = p.replace(/<\/?p>/g, '').trim();
            if (text && text.length > 5) {
              // Remove any leading numbers
              const cleanText = text.replace(/^\d+[\.\)\-]+\s*/, '');
              instructions += "<li>" + cleanText + "</li>";
            }
          });
          instructions += "</ol>";
        }
      }
    }
    
    // If still empty, try to construct from any ordered list in the content
    if (!instructions || instructions === "<ol></ol>") {
      const allOrderedLists = content.match(/<ol>([\s\S]*?)<\/ol>/g);
      if (allOrderedLists && allOrderedLists.length > 0) {
        // Use the longest ordered list as it's likely to be instructions
        let longestList = "";
        for (const list of allOrderedLists) {
          if (list.length > longestList.length) {
            longestList = list;
          }
        }
        instructions = longestList;
      }
    }
    
    // If still empty, provide a placeholder
    if (!instructions || instructions === "<ol></ol>") {
      instructions = "<ol><li>Step 1</li><li>Step 2</li><li>Step 3</li></ol>";
    }
    
    return instructions;
  }
  
  /**
   * Extract notes from content
   */
  function extractNotes(content) {
    // Look for notes, tips or additional information
    let notes = "";
    
    // Try to find notes section
    const notesSection = content.match(/(?:<h[2-3][^>]*>(?:[^<]*notes|tips|additional|advice[^<]*)<\/h[2-3]>)([\s\S]*?)(?:<h[2-3]|<\/body)/i);
    
    if (notesSection && notesSection[1]) {
      // Check if it has a list
      const ulMatch = notesSection[1].match(/<ul>([\s\S]*?)<\/ul>/i);
      if (ulMatch && ulMatch[1]) {
        notes = "<ul>" + ulMatch[1] + "</ul>";
      } else {
        // If no list, convert paragraphs to list items
        const paragraphs = notesSection[1].match(/<p>(.*?)<\/p>/g);
        if (paragraphs && paragraphs.length > 0) {
          notes = "<ul>";
          paragraphs.forEach(p => {
            const text = p.replace(/<\/?p>/g, '').trim();
            if (text && text.length > 5) {
              notes += "<li>" + text + "</li>";
            }
          });
          notes += "</ul>";
        }
      }
    }
    
    // If no notes found, leave empty
    if (!notes) {
      notes = "<ul><li>For best results, let the dish rest for 5 minutes before serving.</li></ul>";
    }
    
    return notes;
  }
  
  /**
   * Extract time information
   */
  function extractTime(content, timeType) {
    const lowerContent = content.toLowerCase();
    let timeMatch;
    
    switch(timeType) {
      case 'prep':
        timeMatch = lowerContent.match(/prep(?:aration)?\s+time:?\s*(\d+)(?:\s+to\s+(\d+))?\s+(minutes|hours)/i);
        break;
      case 'cook':
        timeMatch = lowerContent.match(/cook(?:ing)?\s+time:?\s*(\d+)(?:\s+to\s+(\d+))?\s+(minutes|hours)/i);
        break;
      case 'total':
        timeMatch = lowerContent.match(/total\s+time:?\s*(\d+)(?:\s+to\s+(\d+))?\s+(minutes|hours)/i);
        break;
    }
    
    if (timeMatch) {
      let time = timeMatch[1];
      const unit = timeMatch[3].toLowerCase();
      
      // Format the time properly
      return `${time} ${unit}`;
    }
    
    // Default values if not found
    switch(timeType) {
      case 'prep':
        return "15 minutes";
      case 'cook':
        return "30 minutes";
      case 'total':
        return "45 minutes";
      default:
        return "";
    }
  }
  
  /**
   * Extract yield/servings information
   */
  function extractYield(content) {
    const lowerContent = content.toLowerCase();
    
    // Look for servings or yield information
    const servingsMatch = lowerContent.match(/(?:serves|servings|yield|makes):\s*(\d+)(?:\s*-\s*(\d+))?/i);
    
    if (servingsMatch) {
      if (servingsMatch[2]) {
        return `${servingsMatch[1]}-${servingsMatch[2]} servings`;
      }
      return `${servingsMatch[1]} servings`;
    }
    
    return "4 servings";
  }
  
  /**
   * Determine recipe category
   */
  function determineCategory(content, keyword) {
    const lowerContent = content.toLowerCase();
    const lowerKeyword = keyword.toLowerCase();
    
    // Check for breakfast
    if (lowerContent.includes("breakfast") || 
        lowerKeyword.includes("breakfast") || 
        lowerContent.includes("morning meal")) {
      return "Breakfast";
    }
    
    // Check for appetizer
    if (lowerContent.includes("appetizer") || 
        lowerKeyword.includes("appetizer") || 
        lowerContent.includes("starter") ||
        lowerContent.includes("hors d'oeuvre")) {
      return "Appetizer";
    }
    
    // Check for main course
    if (lowerContent.includes("main course") || 
        lowerContent.includes("dinner") || 
        lowerContent.includes("entrée") ||
        lowerContent.includes("entree")) {
      return "Main Course";
    }
    
    // Check for dessert
    if (lowerContent.includes("dessert") || 
        lowerKeyword.includes("dessert") || 
        lowerContent.includes("sweet") ||
        lowerContent.includes("cake") ||
        lowerContent.includes("cookie") ||
        lowerContent.includes("pie")) {
      return "Dessert";
    }
    
    // Check for side dish
    if (lowerContent.includes("side dish") || 
        lowerKeyword.includes("side") || 
        lowerContent.includes("accompaniment")) {
      return "Side Dish";
    }
    
    // Check for soup
    if (lowerContent.includes("soup") || 
        lowerKeyword.includes("soup") || 
        lowerContent.includes("stew") ||
        lowerContent.includes("broth")) {
      return "Soup";
    }
    
    // Check for salad
    if (lowerContent.includes("salad") || 
        lowerKeyword.includes("salad")) {
      return "Salad";
    }
    
    // Check for drink
    if (lowerContent.includes("drink") || 
        lowerContent.includes("beverage") || 
        lowerContent.includes("cocktail") ||
        lowerContent.includes("smoothie")) {
      return "Drink";
    }
    
    // Default to Main Course if no other category is identified
    return "Main Course";
  }
  
  /**
   * Determine cooking method
   */
  function determineMethod(content) {
    const lowerContent = content.toLowerCase();
    
    if (lowerContent.includes("bake") || lowerContent.includes("roast") || lowerContent.includes("oven")) {
      return "Baking";
    }
    
    if (lowerContent.includes("boil") || lowerContent.includes("blanch")) {
      return "Boiling";
    }
    
    if (lowerContent.includes("grill") || lowerContent.includes("barbecue") || lowerContent.includes("bbq")) {
      return "Grilling";
    }
    
    if (lowerContent.includes("slow cooker") || lowerContent.includes("crockpot")) {
      return "Slow Cooking";
    }
    
    if (lowerContent.includes("pressure cooker") || lowerContent.includes("instant pot")) {
      return "Pressure Cooking";
    }
    
    if (lowerContent.includes("steam")) {
      return "Steaming";
    }
    
    if (lowerContent.includes("fry") || lowerContent.includes("sauté") || lowerContent.includes("saute")) {
      return "Frying";
    }
    
    if (lowerContent.includes("no cook") || lowerContent.includes("no-cook") || lowerContent.includes("raw")) {
      return "No-Cook";
    }
    
    return "Cooking";
  }
  
  /**
   * Determine cuisine type
   */
  function determineCuisine(content, keyword) {
    const lowerContent = content.toLowerCase();
    const lowerKeyword = keyword.toLowerCase();
    
    const cuisines = [
      { name: "Italian", terms: ["italian", "pasta", "pizza", "risotto", "lasagna"] },
      { name: "Mexican", terms: ["mexican", "taco", "burrito", "enchilada", "quesadilla", "salsa"] },
      { name: "Chinese", terms: ["chinese", "stir fry", "stir-fry", "wok", "dim sum", "dumpling"] },
      { name: "Indian", terms: ["indian", "curry", "masala", "tandoori", "naan"] },
      { name: "French", terms: ["french", "ratatouille", "croissant", "soufflé", "souffle"] },
      { name: "Thai", terms: ["thai", "pad thai", "curry", "tom yum"] },
      { name: "Japanese", terms: ["japanese", "sushi", "teriyaki", "miso", "tempura"] },
      { name: "Mediterranean", terms: ["mediterranean", "greek", "hummus", "falafel", "olive oil"] },
      { name: "American", terms: ["american", "burger", "hot dog", "mac and cheese", "barbecue"] }
    ];
    
    for (const cuisine of cuisines) {
      for (const term of cuisine.terms) {
        if (lowerContent.includes(term) || lowerKeyword.includes(term)) {
          return cuisine.name;
        }
      }
    }
    
    return "American";
  }
  
  /**
   * Determine diet type
   */
  function determineDiet(content) {
    const lowerContent = content.toLowerCase();
    
    const dietPatterns = [
      { name: "Vegan", terms: ["vegan", "plant-based", "no animal products"] },
      { name: "Vegetarian", terms: ["vegetarian", "no meat", "meatless"] },
      { name: "Gluten Free", terms: ["gluten-free", "gluten free", "without gluten"] },
      { name: "Low Calorie", terms: ["low calorie", "low-calorie", "diet", "light"] },
      { name: "Low Fat", terms: ["low fat", "low-fat", "fat free"] },
      { name: "Low Salt", terms: ["low salt", "low-salt", "low sodium"] },
      { name: "Diabetic", terms: ["diabetic", "diabetes", "low sugar", "sugar-free"] },
      { name: "Kosher", terms: ["kosher", "jewish dietary laws"] },
      { name: "Halal", terms: ["halal", "islamic dietary laws"] }
    ];
    
    for (const diet of dietPatterns) {
      for (const term of diet.terms) {
        if (lowerContent.includes(term)) {
          return diet.name;
        }
      }
    }
    
    return "";
  }
  
  /**
   * Extract keywords for recipe
   */
  function extractKeywords(content) {
    // Start with an empty string
    let keywordsStr = "";
    
    // Extract likely keywords from content headers and emphasized text
    const headers = content.match(/<h[2-3][^>]*>(.*?)<\/h[2-3]>/g);
    if (headers) {
      headers.forEach(header => {
        const text = header.replace(/<\/?h[2-3][^>]*>/g, '').trim();
        if (text && !text.match(/ingredients|instructions|steps|notes|tips/i)) {
          keywordsStr += ", " + text;
        }
      });
    }
    
    // Add some common recipe keywords
    const commonKeywords = [
      "homemade", "easy", "delicious", "quick", "healthy", 
      "family", "dinner", "recipe", "best", "traditional"
    ];
    
    const lowerContent = content.toLowerCase();
    commonKeywords.forEach(keyword => {
      if (lowerContent.includes(keyword) && !keywordsStr.includes(keyword)) {
        keywordsStr += ", " + keyword;
      }
    });
    
    // Clean up the keywords
    keywordsStr = keywordsStr.replace(/^,\s*/, '');
    
    return keywordsStr;
  }
  
  /**
   * Extract nutrition information
   */
  function extractNutrition(content) {
    const nutrition = {
      "Serving Size": "",
      "Calories": "",
      "Sugar": "",
      "Sodium": "",
      "Fat": "",
      "Saturated Fat": "",
      "Unsaturated Fat": "",
      "Trans Fat": "",
      "Carbohydrates": "",
      "Fiber": "",
      "Protein": "",
      "Cholesterol": ""
    };
    
    // Look for nutrition section
    const nutritionSection = content.match(/(?:<h[2-3][^>]*>(?:[^<]*nutrition|nutritional|nutrients[^<]*)<\/h[2-3]>)([\s\S]*?)(?:<h[2-3]|<\/body)/i);
    
    if (nutritionSection && nutritionSection[1]) {
      const section = nutritionSection[1].toLowerCase();
      
      // Look for common nutrition patterns
      const caloriesMatch = section.match(/calories:?\s*(\d+)/i);
      if (caloriesMatch) nutrition["Calories"] = caloriesMatch[1];
      
      const fatMatch = section.match(/fat:?\s*(\d+\.?\d*)\s*(g|grams)/i);
      if (fatMatch) nutrition["Fat"] = fatMatch[1] + "g";
      
      const carbsMatch = section.match(/carb(?:ohydrate)?s:?\s*(\d+\.?\d*)\s*(g|grams)/i);
      if (carbsMatch) nutrition["Carbohydrates"] = carbsMatch[1] + "g";
      
      const proteinMatch = section.match(/protein:?\s*(\d+\.?\d*)\s*(g|grams)/i);
      if (proteinMatch) nutrition["Protein"] = proteinMatch[1] + "g";
      
      const sugarMatch = section.match(/sugar:?\s*(\d+\.?\d*)\s*(g|grams)/i);
      if (sugarMatch) nutrition["Sugar"] = sugarMatch[1] + "g";
      
      const fiberMatch = section.match(/fiber:?\s*(\d+\.?\d*)\s*(g|grams)/i);
      if (fiberMatch) nutrition["Fiber"] = fiberMatch[1] + "g";
      
      const sodiumMatch = section.match(/sodium:?\s*(\d+\.?\d*)\s*(mg|milligrams)/i);
      if (sodiumMatch) nutrition["Sodium"] = sodiumMatch[1] + "mg";
      
      const cholesterolMatch = section.match(/cholesterol:?\s*(\d+\.?\d*)\s*(mg|milligrams)/i);
      if (cholesterolMatch) nutrition["Cholesterol"] = cholesterolMatch[1] + "mg";
    }
    
    // Fill in defaults for empty values
    if (!nutrition["Serving Size"]) nutrition["Serving Size"] = "1 serving";
    if (!nutrition["Calories"]) nutrition["Calories"] = "250";
    if (!nutrition["Fat"]) nutrition["Fat"] = "10g";
    if (!nutrition["Carbohydrates"]) nutrition["Carbohydrates"] = "30g";
    if (!nutrition["Protein"]) nutrition["Protein"] = "15g";
    
    return nutrition;
  }
  
  // Export the recipe extraction function
  module.exports = {
    extractRecipeData
  };