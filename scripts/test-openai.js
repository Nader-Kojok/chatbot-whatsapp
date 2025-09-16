import OpenAI from "openai";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function generateHaiku() {
  try {
    console.log('Generating haiku about AI...');
    
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-3.5-turbo",
      messages: [
        {
          role: "user",
          content: "write a haiku about ai"
        }
      ],
      max_tokens: parseInt(process.env.OPENAI_MAX_TOKENS) || 100,
      temperature: parseFloat(process.env.OPENAI_TEMPERATURE) || 0.7
    });

    console.log('\n--- Generated Haiku ---');
    console.log(response.choices[0].message.content);
    console.log('--- End ---\n');
    
  } catch (error) {
    console.error("Error generating haiku:", error.message);
    
    if (error.code === 'invalid_api_key') {
      console.error('Please check your OPENAI_API_KEY in the .env file');
    }
  }
}

// Run the function
generateHaiku();